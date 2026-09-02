import { NextResponse } from 'next/server';
import { bodyExcede } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { calcomConfig, registrarEventoComercial, verificarFirmaCalcom } from '@/lib/admin/calcom';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY = 256 * 1024;
const ESTADO_POR_EVENTO: Record<string, string> = {
  BOOKING_CREATED: 'appointment',
  BOOKING_RESCHEDULED: 'rescheduled',
  BOOKING_CANCELLED: 'cancelled',
  BOOKING_NO_SHOW: 'no-show',
};

type CalcomEvent = {
  triggerEvent?: string;
  id?: string;
  bookingId?: string | number;
  payload?: Record<string, unknown>;
};

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 320) : null;
}

function bookingId(evt: CalcomEvent): string | null {
  const p = evt.payload ?? {};
  const value = evt.bookingId ?? evt.id ?? p.bookingId ?? p.id ?? p.uid;
  return value === undefined || value === null ? null : String(value);
}

function emailDelEvento(evt: CalcomEvent): string | null {
  const p = evt.payload ?? {};
  const attendees = Array.isArray(p.attendees) ? p.attendees : [];
  const first = attendees[0] as Record<string, unknown> | undefined;
  return texto(p.email) ?? texto(first?.email) ?? texto((p.booking as Record<string, unknown> | undefined)?.email);
}

export async function POST(req: Request) {
  const config = calcomConfig();
  if (!config.webhookSecret) return new NextResponse('Cal.com webhook no configurado', { status: 503 });
  if (bodyExcede(req, MAX_BODY)) return new NextResponse('Payload too large', { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return new NextResponse('Payload too large', { status: 413 });
  const firma = req.headers.get('x-cal-signature-256')
    ?? req.headers.get('x-cal-webhook-signature')
    ?? req.headers.get('cal-signature')
    ?? req.headers.get('x-cal-signature');
  if (!verificarFirmaCalcom(raw, firma, config.webhookSecret)) {
    logger.warn('calcom.webhook.firma_invalida', {});
    return new NextResponse('Firma inválida', { status: 401 });
  }

  let evt: CalcomEvent;
  try { evt = JSON.parse(raw) as CalcomEvent; } catch { return new NextResponse('JSON inválido', { status: 400 }); }
  const tipo = texto(evt.triggerEvent)?.toUpperCase();
  const externo = bookingId(evt);
  if (!tipo || !externo) return new NextResponse('Evento Cal.com incompleto', { status: 400 });
  const clave = `calcom:${tipo}:${externo}`;
  const estado = ESTADO_POR_EVENTO[tipo];

  try {
    // Lookup is inside the retryable path too: a transient CRM read failure
    // must be a loud 500, never an unhandled rejection or a false 2xx.
    const prospecto = await encontrarProspecto(emailDelEvento(evt));
    const resultado = await registrarEventoComercial({
      claveIdempotencia: clave, fuente: 'calcom', tipo, externoId: externo,
      prospectoId: prospecto?.id ?? null, payload: evt.payload ?? {},
    });
    if (resultado === 'repetido') return NextResponse.json({ ok: true, repetido: true });
    if (prospecto && estado) {
      const cambios: Record<string, unknown> = { estado, updated_at: new Date().toISOString() };
      // A cancelled/rescheduled booking is not a won deal; keep cerrado_en
      // coherent with the database constraint.
      if (estado !== 'won') cambios.cerrado_en = null;
      const { error } = await supabaseAdmin().from('prospecto').update(cambios)
        .eq('id', prospecto.id);
      // AUDITORÍA 24, BE-17: el libro se sellaba ANTES de aplicar. Si el
      // `UPDATE` fallaba, contestábamos 500, Cal.com reintentaba y la clave ya
      // escrita lo devolvía como `repetido` con 200: el evento quedaba
      // registrado y NUNCA aplicado. Un BOOKING_CANCELLED así deja al
      // prospecto en `appointment` para siempre y el vendedor le habla el día
      // de una cita que ya no existe. Se suelta la reclamación antes de
      // relanzar, para que el reintento sí entre. No se reordena (aplicar y
      // sellar después re-aplicaría un CREATED reentregado DESPUÉS de un
      // CANCELLED, resucitando el estado viejo): se compensa.
      if (error) {
        await soltarReclamacion(clave, tipo, externo);
        throw new Error(`prospecto: ${error.message}`);
      }
    }
    return NextResponse.json({ ok: true, prospectoId: prospecto?.id ?? null });
  } catch (error) {
    logger.error('calcom.webhook.fallo', { tipo, externo, err: String(error) });
    return new NextResponse('Error al aplicar evento', { status: 500 });
  }
}

async function encontrarProspecto(email: string | null): Promise<{ id: string } | null> {
  if (!email) return null;
  const { data, error } = await supabaseAdmin().from('prospecto').select('id')
    .eq('correo', email.toLowerCase()).is('duplicado_de', null).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`prospecto lookup: ${error.message}`);
  return data as { id: string } | null;
}

/**
 * Borra el renglón del libro que acabamos de escribir (AUDITORÍA 24, BE-17).
 *
 * Se llama SOLO cuando la escritura del libro fue nuestra (`'nuevo'`) y lo que
 * venía después falló: sin esto, la clave escrita convierte el reintento de
 * Cal.com en un `repetido` que contesta 200 sin haber aplicado nada.
 *
 * Si el borrado también falla no hay nada más que hacer desde aquí —el 500
 * sale igual—, pero se nombra: es la única señal de que ese evento se quedó
 * sellado sin aplicar y hay que correr `reconciliarReservasCalcom`.
 */
async function soltarReclamacion(clave: string, tipo: string, externo: string): Promise<void> {
  const { error } = await supabaseAdmin().from('comercial_evento').delete().eq('clave_idempotencia', clave);
  if (error) {
    logger.error('calcom.webhook.reclamacion_atorada', { tipo, externo, clave, err: error.message });
  }
}
