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

export async function sendText(to: string, body: string): Promise<void> {
  const res = await fetch(`${GRAPH}/${phoneNumberId()}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
  });
  if (!res.ok) logger.error('wa.sendText', { status: res.status, body: await res.text().catch(() => '') });
}

/** Envía un documento (PDF de liquidación) por link público o media id. */
export async function sendDocument(to: string, link: string, filename: string, caption?: string): Promise<void> {
  const res = await fetch(`${GRAPH}/${phoneNumberId()}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'document',
      document: { link, filename, caption },
    }),
  });
  if (!res.ok) logger.error('wa.sendDocument', { status: res.status });
}

/** Descarga un media entrante de Meta como TEXTO (para el XML del CFDI). */
export async function downloadMediaAsText(mediaId: string): Promise<string | null> {
  try {
    const meta = await fetch(`${GRAPH}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token()}` },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!meta.ok) return null;
    const { url } = (await meta.json()) as { url: string };
    const bin = await fetch(url, {
      headers: { Authorization: `Bearer ${token()}` },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!bin.ok) return null;
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
    if (!meta.ok) return null;
    const { url, mime_type } = (await meta.json()) as { url: string; mime_type: string };
    const bin = await fetch(url, {
      headers: { Authorization: `Bearer ${token()}` },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!bin.ok) return null;
    const buf = Buffer.from(await bin.arrayBuffer());
    return `data:${mime_type || 'image/jpeg'};base64,${buf.toString('base64')}`;
  } catch (e) {
    logger.warn('wa.downloadMedia', { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
