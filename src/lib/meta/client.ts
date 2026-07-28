// ═══════════════════════════════════════════════════════════════════════════
// Meta WhatsApp Cloud API — envío de mensajes y descarga de media entrante.
// Verificación HMAC del webhook (timing-safe).
// ═══════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';
import { logger } from '@/lib/logger';

const GRAPH = 'https://graph.facebook.com/v21.0';
const DOWNLOAD_TIMEOUT_MS = 15_000;

function token(): string {
  const t = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!t) throw new Error('WHATSAPP_ACCESS_TOKEN no configurado');
  return t;
}
function phoneNumberId(): string {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!id) throw new Error('WHATSAPP_PHONE_NUMBER_ID no configurado');
  return id;
}

/** Verifica el token del GET de configuración del webhook (timing-safe). */
export function verifyWebhookChallenge(mode: string | null, verifyToken: string | null): boolean {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN ?? '';
  if (mode !== 'subscribe' || !expected || !verifyToken) return false;
  const a = Buffer.from(verifyToken);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Valida la firma HMAC-SHA256 del POST (X-Hub-Signature-256). */
export function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * El número al que WhatsApp acepta que le escribas, que NO es el que te manda.
 *
 * Medido contra la Graph API el 28-jul-2026, mismo destinatario, mismo token:
 *
 *   to: 5219993700779  →  (#131030) Recipient phone number not in allowed list
 *   to: 529993700779   →  aceptado, y contesta wa_id 5219993700779
 *
 * O sea: Meta ENTREGA los mensajes entrantes con el "1" mexicano en el `wa_id`,
 * y RECHAZA los salientes que lo lleven. Como el código contestaba al mismo
 * `from` que recibía, la respuesta rebotaba SIEMPRE — a todos los operadores
 * mexicanos, que son todo el mercado.
 *
 * Y rebotaba callando: `sendText` solo escribe en el log y no lanza, así que la
 * liquidación se daba por terminada con éxito mientras el operador no recibía
 * nada. El 200 del webhook y el `agent.run` en verde decían que todo iba bien.
 *
 * El "1" es una herencia de la numeración mexicana que WhatsApp dejó de usar
 * para enviar en 2020 pero sigue emitiendo en los `wa_id`. Se quita solo cuando
 * la forma es exactamente 52 + 1 + diez dígitos: ninguna otra lada se toca.
 */
export function destinatarioWhatsApp(telefono: string): string {
  const d = telefono.replace(/[^\d]/g, '');
  const mx = /^521(\d{10})$/.exec(d);
  return mx ? `52${mx[1]}` : d;
}

export async function sendText(to: string, body: string): Promise<void> {
  const res = await fetch(`${GRAPH}/${phoneNumberId()}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: destinatarioWhatsApp(to), type: 'text', text: { body } }),
  });
  if (!res.ok) { logger.error('wa.sendText', { status: res.status, body: await res.text().catch(() => '') }); return; }
  // El ÉXITO también deja rastro. Sin esta línea, "se envió" y "nunca se llamó"
  // se ven igual en los logs —los dos, en blanco— y distinguirlos costó veinte
  // minutos de la primera prueba real. El id del mensaje es lo que permite
  // rastrearlo después en Meta.
  logger.info('wa.sendText.ok', { id: await idDeRespuesta(res) });
}

/** El wamid que devuelve Meta, para poder seguir el mensaje del lado de ellos. */
async function idDeRespuesta(res: Response): Promise<string | undefined> {
  try {
    const j = (await res.json()) as { messages?: { id?: string }[] };
    return j.messages?.[0]?.id;
  } catch { return undefined; }
}

/** Envía un documento (PDF de liquidación) por link público o media id. */
export async function sendDocument(to: string, link: string, filename: string, caption?: string): Promise<void> {
  const res = await fetch(`${GRAPH}/${phoneNumberId()}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: destinatarioWhatsApp(to),   // el PDF rebotaba igual que el texto
      type: 'document',
      document: { link, filename, caption },
    }),
  });
  if (!res.ok) { logger.error('wa.sendDocument', { status: res.status, body: await res.text().catch(() => '') }); return; }
  // Igual que en `sendText`: el envío del PDF es EL entregable, y su éxito no
  // dejaba ninguna huella. Meta acepta el mensaje y descarga el `link` después,
  // por su cuenta; sin el wamid no hay forma de preguntarle qué pasó con él.
  logger.info('wa.sendDocument.ok', { id: await idDeRespuesta(res), filename });
}

/**
 * Un `!res.ok` de la descarga de media, dicho en voz alta.
 *
 * Los cuatro `if (!res.ok) return null` de las dos descargas estaban FUERA del
 * `catch`, así que devolvían `null` sin una sola línea. Con el token de WhatsApp
 * vencido —que fue exactamente lo que pasó el 28-jul a las 12:00— TODAS las
 * fotos de TODOS los operadores fallan en silencio absoluto, y el producto le
 * responde al operador que reenvíe la foto: un remedio que no puede funcionar
 * nunca, porque el problema no está en su foto.
 *
 * Es la misma lección que `fc760c3` (el éxito también deja rastro), viva treinta
 * líneas más abajo del comentario que la documenta.
 */
async function avisarFalloMedia(paso: string, mediaId: string, res: Response): Promise<void> {
  logger.error('wa.media_no_descargada', {
    paso, mediaId, status: res.status,
    // El cuerpo de Meta es lo que distingue un token vencido (401/190) de un
    // media caducado (404): sin él, los dos se ven igual y llevan a arreglos
    // distintos.
    body: await res.text().catch(() => ''),
  });
}

/** Descarga un media entrante de Meta como TEXTO (para el XML del CFDI). */
export async function downloadMediaAsText(mediaId: string): Promise<string | null> {
  try {
    const meta = await fetch(`${GRAPH}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token()}` },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!meta.ok) { await avisarFalloMedia('metadatos', mediaId, meta); return null; }
    const { url } = (await meta.json()) as { url: string };
    const bin = await fetch(url, {
      headers: { Authorization: `Bearer ${token()}` },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!bin.ok) { await avisarFalloMedia('contenido', mediaId, bin); return null; }
    return await bin.text();
  } catch (e) {
    logger.warn('wa.downloadMediaText', { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** Descarga un media entrante de Meta y lo devuelve como data-URL para el OCR. */
export async function downloadMediaAsDataUrl(mediaId: string): Promise<string | null> {
  try {
    const meta = await fetch(`${GRAPH}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token()}` },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!meta.ok) { await avisarFalloMedia('metadatos', mediaId, meta); return null; }
    const { url, mime_type } = (await meta.json()) as { url: string; mime_type: string };
    const bin = await fetch(url, {
      headers: { Authorization: `Bearer ${token()}` },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!bin.ok) { await avisarFalloMedia('contenido', mediaId, bin); return null; }
    const buf = Buffer.from(await bin.arrayBuffer());
    return `data:${mime_type || 'image/jpeg'};base64,${buf.toString('base64')}`;
  } catch (e) {
    logger.warn('wa.downloadMedia', { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
