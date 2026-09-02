import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { suprimirCorreo } from '@/lib/likida/agentes/enviador';
import { logger } from '@/lib/logger';
import { cuerpoAcotado } from '../_cuerpo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// EL CIRCUITO DE ENTREGA (0124 — auditoría externa 2): `provider_message_id`
// demuestra que Resend ACEPTÓ; este webhook escribe lo que pasó DESPUÉS —
// entregado, rebotado o queja — sobre la pieza que salió de la cola. Con
// eso, la pantalla deja de vender "aceptado" como si fuera "entregado".
//
// FIRMA SVIX VERIFICADA A MANO (sin dependencia nueva): Resend firma
// `${svix-id}.${svix-timestamp}.${cuerpo}` con HMAC-SHA256 sobre el secreto
// base64 (tras el prefijo whsec_). Sin secreto configurado: 500 — Resend
// reintenta y nadie procesa eventos sin firma. Timestamp a ±5 min contra
// replay. Un evento de un provider_message_id desconocido se registra y se
// contesta 200 (pudo ser un correo de otro flujo — no es error del webhook).
// ═══════════════════════════════════════════════════════════════════════════

const TOLERANCIA_S = 300;

/** Un evento de entrega de Resend son cientos de bytes; 64 KB ya es holgado. */
const MAX_CUERPO_BYTES = 64 * 1024;

const ESTADO_POR_EVENTO: Record<string, 'entregado' | 'rebotado' | 'queja'> = {
  'email.delivered': 'entregado',
  'email.bounced': 'rebotado',
  'email.complained': 'queja',
};

function firmaValida(cuerpo: string, id: string | null, ts: string | null, firmas: string | null, secreto: string): boolean {
  if (!id || !ts || !firmas) return false;
  const edad = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(edad) || edad > TOLERANCIA_S) return false;
  const llave = Buffer.from(secreto.replace(/^whsec_/, ''), 'base64');
  const esperada = crypto.createHmac('sha256', llave).update(`${id}.${ts}.${cuerpo}`).digest('base64');
  // El header trae "v1,<firma>" (posiblemente varias, separadas por espacio).
  return firmas.split(' ').some((f) => {
    const [, sig] = f.split(',');
    if (!sig) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(esperada);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

export async function POST(req: Request) {
  // Variable PROPIA (17-ago): Resend firma cada webhook con SU secreto — el
  // de correo entrante (RESEND_WEBHOOK_SECRET) es OTRO webhook con OTRO
  // secreto, y compartir el nombre hacía imposible que ambos verificaran.
  const secreto = process.env.RESEND_EVENTOS_WEBHOOK_SECRET;
  if (!secreto) {
    logger.error('correo.eventos.sin_secreto', {});
    return NextResponse.json({ error: 'RESEND_WEBHOOK_SECRET no está configurado.' }, { status: 500 });
  }

  // AUDITORÍA 24, BE-21: era `await req.text()` y el tope se medía DESPUÉS.
  // Un POST `chunked` de 200 MB sin cabeceras svix —o sea, sin haber
  // demostrado nada— entraba entero a memoria antes del 413. `cuerpoAcotado`
  // corta MIENTRAS lee, como ya hacía correo/entrante.
  const cuerpo = await cuerpoAcotado(req, MAX_CUERPO_BYTES);
  if (cuerpo === null) {
    logger.warn('correo.eventos.cuerpo_excede', { maxBytes: MAX_CUERPO_BYTES });
    return new NextResponse('Payload too large', { status: 413 });
  }
  if (!firmaValida(cuerpo, req.headers.get('svix-id'), req.headers.get('svix-timestamp'), req.headers.get('svix-signature'), secreto)) {
    return new NextResponse('Invalid signature', { status: 401 });
  }

  let evento: {
    type?: string;
    data?: {
      email_id?: string;
      to?: unknown;
      /** Campos donde el payload de un rebote PUEDE identificar la dirección
       *  exacta que rebotó (c5-12) — se leen todos los candidatos conocidos. */
      bounce?: { email?: unknown; recipient?: unknown } | null;
      email?: unknown;
      recipient?: unknown;
    };
  };
  try {
    evento = JSON.parse(cuerpo);
  } catch {
    return new NextResponse('Bad JSON', { status: 400 });
  }

  const estado = evento.type ? ESTADO_POR_EVENTO[evento.type] : undefined;
  const emailId = evento.data?.email_id;
  if (!estado || !emailId) {
    // Evento que no rastrea entrega (email.sent, email.opened…): acuse sin
    // efecto — no es error, es un tipo que este circuito no necesita.
    return NextResponse.json({ ignorado: evento.type ?? 'sin tipo' });
  }

  // Un rebote/queja PISA a un "entregado" anterior, nunca al revés: el orden
  // de los webhooks no está garantizado y la mala noticia es la que opera
  // (un rebotado detiene reintentos; el estado final malo no debe taparse).
  //
  // AUDITORÍA 18, A4: esto se expresaba con `.neq('entrega_estado', 'rebotado')`
  // y, para la mala noticia, `.neq('entrega_estado', '~nunca~')`. La columna
  // NACE NULL (0124: «aceptado sin noticia de entrega todavía») y en SQL
  // `NULL <> 'x'` es NULL, no true: el UPDATE afectaba 0 filas y el webhook
  // contestaba `sinPieza` para TODA pieza que nunca había recibido un evento —
  // o sea para todas. El circuito entero de la 0124 era código muerto.
  //
  // Ahora se dice en positivo: un "entregado" solo escribe si la columna está
  // vacía o ya dice entregado (`IS NULL OR = 'entregado'`); la mala noticia
  // escribe siempre. Sin `<>` sobre una columna anulable.
  let consulta = supabaseAdmin()
    .from('cola_aprobacion')
    .update({ entrega_estado: estado, entrega_evento_en: new Date().toISOString() })
    .eq('provider_message_id', emailId);
  if (estado === 'entregado') {
    consulta = consulta.or('entrega_estado.is.null,entrega_estado.eq.entregado');
  }
  const { data, error } = await consulta.select('id');
  if (error) {
    logger.error('correo.eventos.sin_escribir', { emailId, estado, err: error.message });
    // 500 para que Resend reintente: el evento es la única fuente de este dato.
    return NextResponse.json({ error: 'no se pudo escribir el evento' }, { status: 500 });
  }
  if (!Array.isArray(data) || data.length === 0) {
    logger.info('correo.eventos.sin_pieza', { emailId, estado });
    return NextResponse.json({ sinPieza: true });
  }
  if (estado !== 'entregado') {
    logger.warn('correo.eventos.mala_noticia', { pieza: (data[0] as { id: string }).id, estado, emailId });
    // LA BAJA AUTOMÁTICA (0217): un rebote o una queja suprimen para siempre
    // — insistirle a un buzón que rebotó (o que nos marcó spam) quema la
    // reputación del dominio. Best-effort deliberado: el evento ya quedó
    // escrito arriba, y perderlo por no poder anotar la baja sería el peor
    // intercambio.
    //
    // AUDITORÍA FABLE CICLO 5 (c5-12): antes un rebote suprimía TODO el `to`
    // — un info@ muerto en copia vetaba para siempre al correo principal
    // válido y a las demás copias que sí entregaron. Ahora:
    //   · REBOTE: solo la(s) dirección(es) que el payload identifica; si no
    //     identifica ninguna y el envío tenía UN destinatario, ese (no hay
    //     ambigüedad); con varios sin identificar, NINGUNA se suprime y se
    //     grita para que un humano decida — suprimir a ciegas mata la
    //     campaña a una empresa viva.
    //   · QUEJA: el barrido completo se conserva — quien marca spam no
    //     quiere NADA nuestro en ningún buzón de su empresa.
    const to = evento.data?.to;
    const correos = (Array.isArray(to) ? to : typeof to === 'string' ? [to] : [])
      .filter((c): c is string => typeof c === 'string');
    if (estado === 'queja') {
      for (const c of correos) await suprimirCorreo(c, 'queja de spam (webhook Resend)');
    } else {
      const candidatos = [evento.data?.bounce?.email, evento.data?.bounce?.recipient, evento.data?.email, evento.data?.recipient]
        .filter((c): c is string => typeof c === 'string' && c.includes('@'));
      const rebotadas = candidatos.length > 0 ? candidatos
        : correos.length === 1 ? correos : [];
      if (rebotadas.length === 0 && correos.length > 1) {
        logger.warn('correo.eventos.rebote_sin_direccion', { emailId, destinatarios: correos.length });
      }
      for (const c of rebotadas) await suprimirCorreo(c, 'rebote (webhook Resend)');
    }
  }
  return NextResponse.json({ pieza: (data[0] as { id: string }).id, estado });
}
