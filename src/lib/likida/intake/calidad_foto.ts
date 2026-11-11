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

// ═══════════════════════════════════════════════════════════════════════════
// PREVALIDACIÓN COMPLETA DE LA FOTO ANTES DEL OCR (F19, BITACORAS #5).
//
// Objetivo: que el operador repita una foto mala EN EL MOMENTO (con el motivo y
// cómo tomarla), no días después cuando el OCR falló o el contralor la rechazó.
// Siete motivos, en este orden (el primero que aplica gana):
//   tipo       no es una foto (PDF, ZIP, XML/HTML, GIF). Lo desconocido NO se rechaza: falla abierto.
//   diminuta   pesa casi nada: no hay contenido que leer.
//   pequena    menos de 800 px de ancho (`PX_ANCHO_MIN_LEGIBLE`).
//   oscura     luminancia media < `UMBRAL_LUMINANCIA_OSCURA`.
//   quemada    reflejo o exceso de luz: mucho blanco saturado y casi nada de tinta.
//   borrosa    varianza del laplaciano bajo `UMBRAL_VARIANZA_LAPLACIANO`.
//   recortada  la tinta llega a los dos bordes laterales: el papel se salió del encuadre.
//
// TODOS LOS UMBRALES SON SUPUESTOS declarados, calibrados con las fotos
// sintéticas de `calidad_foto_prevalidacion.test.ts` (ticket dibujado, con
// variantes oscura, quemada, desenfocada y recortada). No son una calibración
// fotométrica con fotos reales de campo; hasta tenerlas, la salida de seguridad
// es el tope: pasado `MAX_REPETICIONES_FOTO_DIA` rechazos en el día, la foto
// SIGUE AL OCR con marca (nunca se atora al operador).
//
// FALLA ABIERTO: si la prevalidación misma lanza o no puede decodificar, la
// foto sigue al OCR. Una prevalidación estricta que pierde comprobantes sería
// peor que no tenerla.
// ═══════════════════════════════════════════════════════════════════════════

/** Ancho al que se reduce la foto para medirla: la medida no depende de la resolución de la cámara. */
export const ANCHO_MEDICION_PX = 512;
/** Bytes por debajo de los cuales no hay foto que leer. SUPUESTO. */
export const BYTES_MINIMOS_FOTO = 8 * 1024;
/** Share de píxeles ≥ 250 a partir del cual hay exceso de luz (con casi nada de tinta). SUPUESTO. */
export const UMBRAL_SATURADA = 0.35;
/** Share de píxeles oscuros (< 110) por debajo del cual el texto se perdió. SUPUESTO. */
export const UMBRAL_TINTA_MINIMA = 0.01;
/** Varianza del laplaciano (a 512 px de ancho) por debajo de la cual la foto está desenfocada. SUPUESTO. */
export const UMBRAL_VARIANZA_LAPLACIANO = 60;
/** Rechazos por operador y día antes de dejar pasar la foto al OCR con marca. */
export const MAX_REPETICIONES_FOTO_DIA = 2;

export type MotivoFoto = 'tipo' | 'diminuta' | 'pequena' | 'oscura' | 'quemada' | 'borrosa' | 'recortada';

export interface MedidasFoto {
  anchoPx: number;
  bytes: number;
  luminanciaMedia: number;
  /** Share (0–1) de píxeles ≥ 250. */
  saturada: number;
  /** Share (0–1) de píxeles < 110. */
  tinta: number;
  varianzaLaplaciano: number;
  /** Densidad de tinta en el borde izquierdo / derecho / centro. */
  tintaBordeIzq: number;
  tintaBordeDer: number;
  tintaCentro: number;
}

/** Una imagen en grises, fila por fila. */
export interface Grises { ancho: number; alto: number; datos: Uint8Array }

/**
 * Tipo por bytes mágicos (no por el nombre ni por el encabezado `data:`, que el remitente controla).
 *   · `foto`        JPEG, PNG, WebP o HEIC/HEIF.
 *   · `no_foto`     PDF, ZIP, XML/HTML o GIF: algo que NO es una foto del papel. Es el único caso que se rechaza por tipo.
 *   · `desconocido` cualquier otra cosa: NO se rechaza (falla abierto); si no se puede decodificar, la foto sigue al OCR.
 */
export function clasificarTipoDeFoto(buf: Uint8Array): 'foto' | 'no_foto' | 'desconocido' {
  if (buf.length < 12) return 'desconocido';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'foto'; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'foto'; // PNG
  const ascii = (a: number, b: number) => String.fromCharCode(...buf.slice(a, b));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'foto';
  if (ascii(4, 8) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1)/.test(ascii(8, 12))) return 'foto';
  if (ascii(0, 4) === '%PDF' || ascii(0, 4) === 'GIF8' || (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04)) return 'no_foto';
  const cabeza = ascii(0, 12).trimStart().toLowerCase();
  if (cabeza.startsWith('<?xml') || cabeza.startsWith('<html') || cabeza.startsWith('<!doctype')) return 'no_foto';
  return 'desconocido';
}

/** Pura. Mide una imagen en grises. La varianza del laplaciano usa el kernel 4-vecinos [0 1 0; 1 -4 1; 0 1 0]. */
export function medirGrises(g: Grises): Omit<MedidasFoto, 'anchoPx' | 'bytes'> {
  const { ancho, alto, datos } = g;
  const n = ancho * alto;
  let suma = 0; let sat = 0; let tinta = 0;
  for (let i = 0; i < n; i += 1) {
    const v = datos[i];
    suma += v;
    if (v >= 250) sat += 1;
    if (v < 110) tinta += 1;
  }
  // Laplaciano (solo píxeles interiores).
  let sL = 0; let sL2 = 0; let nL = 0;
  for (let y = 1; y < alto - 1; y += 1) {
    for (let x = 1; x < ancho - 1; x += 1) {
      const i = y * ancho + x;
      const l = datos[i - 1] + datos[i + 1] + datos[i - ancho] + datos[i + ancho] - 4 * datos[i];
      sL += l; sL2 += l * l; nL += 1;
    }
  }
  const mediaL = nL > 0 ? sL / nL : 0;
  const varianza = nL > 0 ? sL2 / nL - mediaL * mediaL : 0;

  // Tinta en los bordes laterales vs. el centro (60 % central del ancho).
  const franja = Math.max(2, Math.round(ancho * 0.02));
  const centroDesde = Math.round(ancho * 0.2); const centroHasta = Math.round(ancho * 0.8);
  let tIzq = 0; let tDer = 0; let tCen = 0;
  for (let y = 0; y < alto; y += 1) {
    const fila = y * ancho;
    for (let x = 0; x < franja; x += 1) if (datos[fila + x] < 110) tIzq += 1;
    for (let x = ancho - franja; x < ancho; x += 1) if (datos[fila + x] < 110) tDer += 1;
    for (let x = centroDesde; x < centroHasta; x += 1) if (datos[fila + x] < 110) tCen += 1;
  }
  return {
    luminanciaMedia: n > 0 ? suma / n : 0,
    saturada: n > 0 ? sat / n : 0,
    tinta: n > 0 ? tinta / n : 0,
    varianzaLaplaciano: varianza,
    tintaBordeIzq: tIzq / Math.max(1, alto * franja),
    tintaBordeDer: tDer / Math.max(1, alto * franja),
    tintaCentro: tCen / Math.max(1, alto * (centroHasta - centroDesde)),
  };
}

/** Pura. El primer motivo que aplica a las medidas, o `null` si la foto sirve. */
export function motivoDeMedidas(m: MedidasFoto): MotivoFoto | null {
  if (m.bytes < BYTES_MINIMOS_FOTO) return 'diminuta';
  if (m.anchoPx < 800) return 'pequena';
  if (m.luminanciaMedia < UMBRAL_LUMINANCIA_OSCURA) return 'oscura';
  if (m.saturada >= UMBRAL_SATURADA && m.tinta < UMBRAL_TINTA_MINIMA) return 'quemada';
  if (m.varianzaLaplaciano < UMBRAL_VARIANZA_LAPLACIANO) return 'borrosa';
  // Recortada: hay texto en el centro y la tinta llega a los DOS bordes con densidad comparable.
  if (m.tintaCentro >= 0.02 && m.tintaBordeIzq >= 0.5 * m.tintaCentro && m.tintaBordeDer >= 0.5 * m.tintaCentro) return 'recortada';
  return null;
}

export type VeredictoFoto = 'ok' | 'repetir' | 'pasa_con_marca' | 'falla_abierta';

export interface ResultadoPrevalidacion {
  veredicto: VeredictoFoto;
  motivo: MotivoFoto | null;
  medidas: MedidasFoto | null;
}

/**
 * Mide la foto YA descargada. NUNCA lanza: cualquier error interno devuelve `falla_abierta` (la foto sigue al OCR).
 * No decide cuántas veces se puede rechazar: eso es `decidirPrevalidacion`, que recibe el contador.
 */
export async function medirFotoParaPrevalidar(dataUrl: string): Promise<{ medidas: MedidasFoto | null; motivo: MotivoFoto | null; error: boolean }> {
  try {
    const buf = bufferDeDataUrl(dataUrl);
    if (clasificarTipoDeFoto(buf) === 'no_foto') return { medidas: null, motivo: 'tipo', error: false };
    const base = sharp(buf);
    const metadata = await base.metadata();
    const anchoPx = typeof metadata.width === 'number' ? metadata.width : 0;
    const { data, info } = await sharp(buf)
      .rotate()
      .resize({ width: ANCHO_MEDICION_PX, withoutEnlargement: true })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const medidas: MedidasFoto = { anchoPx, bytes: buf.length, ...medirGrises({ ancho: info.width, alto: info.height, datos: new Uint8Array(data) }) };
    return { medidas, motivo: motivoDeMedidas(medidas), error: false };
  } catch (err) {
    logger.warn('intake.prevalidacion_foto_fallo', { err: err instanceof Error ? err.message : String(err) });
    return { medidas: null, motivo: null, error: true };
  }
}

/**
 * Pura. Con el motivo medido y los rechazos ya dados HOY a ese operador, decide:
 *   · sin motivo                       → `ok`.
 *   · con motivo y rechazos < tope     → `repetir` (se le pide otra foto).
 *   · con motivo y rechazos ≥ tope     → `pasa_con_marca` (sigue al OCR, marcada para revisión humana).
 *   · la medición falló                → `falla_abierta` (sigue al OCR, sin marca de calidad).
 */
export function decidirPrevalidacion(e: { motivo: MotivoFoto | null; error: boolean; rechazosHoy: number; tope?: number }): VeredictoFoto {
  if (e.error) return 'falla_abierta';
  if (e.motivo === null) return 'ok';
  return e.rechazosHoy < (e.tope ?? MAX_REPETICIONES_FOTO_DIA) ? 'repetir' : 'pasa_con_marca';
}

/** Lo que se le dice al operador por WhatsApp: la razón y cómo tomar la foto. (Texto a choferes: no se traduce, PLAN-I18N §4.) */
export function mensajeRepetirFoto(motivo: MotivoFoto): string {
  const como: Record<MotivoFoto, string> = {
    tipo: 'Eso no parece una foto del ticket. Mándame una *foto* (no un archivo) del comprobante.',
    diminuta: 'La foto llegó casi vacía. Vuelve a tomarla y mándala otra vez.',
    pequena: 'La foto es muy chica para leerla. Acércate al ticket (que ocupe casi toda la pantalla) y mándala sin recortar ni comprimir.',
    oscura: 'La foto quedó muy oscura. Tómala con más luz, sin sombra encima del papel.',
    quemada: 'La foto tiene mucho reflejo o exceso de luz y el texto no se ve. Cambia el ángulo, sin flash directo, y vuelve a tomarla.',
    borrosa: 'La foto salió movida o sin enfocar. Apoya el celular, toca la pantalla sobre el texto para enfocar y vuelve a tomarla.',
    recortada: 'El ticket se salió del encuadre. Ponlo completo dentro de la foto, con un poco de margen en los lados, y vuelve a tomarla.',
  };
  return `Necesito otra foto. ${como[motivo]}`;
}
