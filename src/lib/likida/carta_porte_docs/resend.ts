// El descargador REAL de adjuntos de Resend para el correo de Carta Porte. Vive aparte de
// correo_entrante.ts para que la lógica del canal se pruebe sin red; este archivo se prueba con
// `fetch` simulado. Mismas reglas que el buzón de facturas: la `download_url` caduca (se pide justo
// antes de usarla), cada llamada tiene timeout y el tamaño se comprueba DECLARADO y REAL.

import { MAX_ADJUNTO_BYTES, type DescargaAdjunto } from './correo_entrante';

/** El presupuesto por descarga: nunca más de 8 s ni más de lo que queda del reloj de la función. */
const TOPE_DESCARGA_MS = 8_000;

export function descargadorResend(llave: string, restanteMs: () => number): (emailId: string, adjuntoId: string) => Promise<DescargaAdjunto> {
  return async (emailId, adjuntoId) => {
    const plazo = (): number => Math.max(0, Math.min(TOPE_DESCARGA_MS, restanteMs()));
    try {
      if (plazo() === 0) return { ok: false, transitorio: true };
      const meta = await fetch(`https://api.resend.com/emails/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(adjuntoId)}`, {
        headers: { Authorization: `Bearer ${llave}` }, signal: AbortSignal.timeout(plazo()),
      });
      // Un adjunto que Resend no tiene (404) no aparece por reintentar; lo demás (5xx, 429, red) sí es transitorio.
      if (meta.status === 404) return { ok: false, transitorio: false };
      if (!meta.ok) return { ok: false, transitorio: true };
      const { download_url: url } = (await meta.json()) as { download_url?: string };
      if (!url || !/^https:\/\//.test(url)) return { ok: false, transitorio: true };
      if (plazo() === 0) return { ok: false, transitorio: true };
      const bin = await fetch(url, { signal: AbortSignal.timeout(plazo()) });
      if (!bin.ok) return { ok: false, transitorio: true };
      const declarado = Number(bin.headers.get('content-length') || 0);
      if (declarado > MAX_ADJUNTO_BYTES) return { ok: false, transitorio: false };
      const bytes = new Uint8Array(await bin.arrayBuffer());
      if (bytes.length > MAX_ADJUNTO_BYTES) return { ok: false, transitorio: false };
      return { ok: true, bytes };
    } catch {
      return { ok: false, transitorio: true };
    }
  };
}
