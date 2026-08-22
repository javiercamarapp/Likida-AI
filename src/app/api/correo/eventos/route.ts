import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

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

  const cuerpo = await req.text();
  if (cuerpo.length > 64 * 1024) return new NextResponse('Payload too large', { status: 413 });
  if (!firmaValida(cuerpo, req.headers.get('svix-id'), req.headers.get('svix-timestamp'), req.headers.get('svix-signature'), secreto)) {
    return new NextResponse('Invalid signature', { status: 401 });
  }

  let evento: { type?: string; data?: { email_id?: string; to?: unknown } };
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
  }
  return NextResponse.json({ pieza: (data[0] as { id: string }).id, estado });
}
