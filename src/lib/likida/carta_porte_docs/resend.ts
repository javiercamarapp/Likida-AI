// El descargador REAL de adjuntos de Resend para el correo de Carta Porte. Vive aparte de
// correo_entrante.ts para que la lógica del canal se pruebe sin red; este archivo se prueba con
// `httpsPublico` simulado. Mismas reglas que el buzón de facturas: la `download_url` caduca (se pide
// justo antes de usarla), cada llamada tiene timeout y el tamaño se comprueba DECLARADO y REAL.
//
// AUDITORÍA ADVERSARIAL MEDIO (A3) — SSRF EN LA `download_url` DE RESEND.
//
// Las dos peticiones a Resend (los metadatos del adjunto y, con la `download_url` que esos
// metadatos entregan, el binario) usaban `fetch()` directo — el MISMO patrón que tenía
// `correo/entrante/route.ts` antes del fix de la auditoría A9 (ver `bajarAdjuntoResend` ahí). Esta
// función la usa ESE route.ts (`descargadorResend`) para los canales de carta porte y peajes, así
// que seguía siendo el único punto de A3 sin la defensa en profundidad del resto del repo: DNS
// validado CONTRA la IP que de verdad abre el socket, sin credenciales en la URL y sin seguir
// redirects a ciegas. El riesgo real era acotado (el webhook que entrega la URL ya pasó
// verificación HMAC/Svix), pero la `download_url` la fabrica Resend — sigue siendo una URL dinámica
// que esta función no controla — y el mismo estándar aplica.
import { httpsPublico } from '@/lib/http/https_publico';
import { MAX_ADJUNTO_BYTES, type DescargaAdjunto } from './correo_entrante';

/** El presupuesto por descarga: nunca más de 8 s ni más de lo que queda del reloj de la función. */
const TOPE_DESCARGA_MS = 8_000;

export function descargadorResend(llave: string, restanteMs: () => number): (emailId: string, adjuntoId: string) => Promise<DescargaAdjunto> {
  return async (emailId, adjuntoId) => {
    const plazo = (): number => Math.max(0, Math.min(TOPE_DESCARGA_MS, restanteMs()));
    // Capturado por `aceptar` ANTES de que `httpsPublico` corte la descarga por tope excedido —
    // así el catch de abajo puede distinguir "se pasó de tamaño" (permanente) de "falló la red"
    // (transitorio) sin inventar una cifra para el caso chunked sin `content-length` (ahí queda en 0).
    let declarado = 0;
    try {
      if (plazo() === 0) return { ok: false, transitorio: true };
      const meta = await httpsPublico({
        url: `https://api.resend.com/emails/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(adjuntoId)}`,
        metodo: 'GET',
        encabezados: { Authorization: `Bearer ${llave}` },
      }, plazo());
      // Un adjunto que Resend no tiene (404) no aparece por reintentar; lo demás (5xx, 429, red) sí es transitorio.
      if (meta.estado === 404) return { ok: false, transitorio: false };
      if (meta.estado < 200 || meta.estado >= 300) return { ok: false, transitorio: true };
      const { download_url: url } = JSON.parse(meta.cuerpo) as { download_url?: string };
      if (!url || !/^https:\/\//.test(url)) return { ok: false, transitorio: true };
      if (plazo() === 0) return { ok: false, transitorio: true };
      const bin = await httpsPublico({
        url,
        metodo: 'GET',
        // El mismo tope que ya comprobaban `correo_entrante.ts` y `ccp_respuesta.ts` (8 MiB) — coincide
        // con el techo GLOBAL de `httpsPublico`, así que no hace falta `maxBytesAbsoluto` para subirlo.
        maxBytes: MAX_ADJUNTO_BYTES,
        aceptar: (_estado, encabezados) => {
          declarado = Number(encabezados['content-length'] ?? '') || 0;
          return true;
        },
      }, plazo());
      if (bin.estado < 200 || bin.estado >= 300) return { ok: false, transitorio: true };
      return { ok: true, bytes: bin.bytes };
    } catch (e) {
      // `httpsPublico` lanza tanto por red/timeout/DNS no público (transitorio) como por tope de
      // tamaño excedido (permanente: el reintento trae el mismo archivo).
      const msg = e instanceof Error ? e.message : '';
      if (declarado > MAX_ADJUNTO_BYTES || /supera el límite/.test(msg)) return { ok: false, transitorio: false };
      return { ok: false, transitorio: true };
    }
  };
}
