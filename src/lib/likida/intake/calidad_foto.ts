// ═══════════════════════════════════════════════════════════════════════════
// CALIDAD DE LA FOTO (T-A5-54, fase 2 parcial) — SOLO server-side.
//
// `decidirFotoDocumento`/`motivoIlegible` (conductor/documentos_cierre.ts) ya
// tenían la lógica pura 100% probada de «pedir repetir una foto chica/oscura/
// borrosa», pero el único punto de producción que las alimentaba
// (`registrarFotoDocumentoCierreDelChofer` en processor.ts) nunca mandaba
// `metadatos`: sin ellas, `motivoIlegible(undefined)` siempre da `null` y la
// foto se acepta como legible siempre, sin excepción.
//
// Este módulo cierra ESE hueco con lo que ya se tiene en la mano en ese punto
// del flujo de WhatsApp: el `dataUrl` ya descargado de Meta. `sharp` ya es
// dependencia del repo (`cfdi_imagen.ts` la usa sobre el mismo tipo de JPEG de
// hasta 6 MB para códigos/QR), así que no es una llamada nueva costosa — es
// una lectura de la imagen que YA se bajó, no una petición extra a Meta ni a
// un analizador externo.
//
// Separado de `documentos_cierre.ts` a propósito: ese archivo se declara
// puro (sin I/O) en su cabecera, y `sharp` tira módulos de Node (ver el
// comentario de `cfdi_imagen.ts`).
//
// LO QUE SE DERIVA Y LO QUE NO:
//   · `anchoPx`: el ancho real en píxeles (lectura de cabecera de `sharp`,
//     no decodifica la imagen completa) — la señal de «foto chica» que T-A5-54
//     pide, con el dato REAL en vez del proxy más burdo (bytes del archivo:
//     un JPEG muy comprimido de una foto borrosa puede pesar menos que uno
//     nítido del mismo tamaño, así que el tamaño en bytes por sí solo hubiera
//     sido un proxy peor que el ancho real, que aquí sí se puede medir).
//   · `oscura`: la luminancia media (promedio de las medias R/G/B de
//     `sharp().stats()`) contra un umbral — SUPUESTO declarado, no una
//     medición fotométrica calibrada.
//   · `borrosa`: NO se deriva todavía. Un detector real (varianza de
//     Laplaciano u otro) es una pieza aparte que esta entrega no construye;
//     se deja `null` a propósito en vez de inventar una heurística sin
//     probar — mejor dos señales reales que tres, una de ellas inventada.
// ═══════════════════════════════════════════════════════════════════════════

import sharp from 'sharp';
import { logger } from '@/lib/logger';
import type { MetadatosFoto } from '@/lib/likida/conductor/documentos_cierre';

/** Luminancia media (0–255) por debajo de la cual se considera «oscura». SUPUESTO, no una medición fotométrica calibrada. */
export const UMBRAL_LUMINANCIA_OSCURA = 60;

function bufferDeDataUrl(dataUrl: string): Buffer {
  const coma = dataUrl.indexOf(',');
  const b64 = coma >= 0 ? dataUrl.slice(coma + 1) : dataUrl;
  return Buffer.from(b64, 'base64');
}

/**
 * Mide lo que se puede medir de la foto YA descargada, para alimentar
 * `motivoIlegible`/`decidirFotoDocumento`. Nunca lanza: una imagen que
 * `sharp` no puede leer (formato raro, archivo corrupto) devuelve `null` —
 * sin metadatos, la contingencia de T-A5-54 sigue su comportamiento de
 * siempre (acepta como legible), nunca bloquea el viaje por esto.
 */
export async function metadatosDeFoto(dataUrl: string): Promise<MetadatosFoto | null> {
  try {
    const buf = bufferDeDataUrl(dataUrl);
    const [metadata, stats] = await Promise.all([sharp(buf).metadata(), sharp(buf).stats()]);
    const anchoPx = typeof metadata.width === 'number' && Number.isFinite(metadata.width) ? metadata.width : null;
    const canales = stats.channels.slice(0, 3); // R, G, B (o gris si viene en escala de grises)
    const oscura = canales.length > 0 ? canales.reduce((acc, c) => acc + c.mean, 0) / canales.length < UMBRAL_LUMINANCIA_OSCURA : null;
    return { anchoPx, oscura, borrosa: null };
  } catch (err) {
    logger.warn('intake.metadatos_foto_fallo', { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
