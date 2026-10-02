import { validarFotoParaIngreso } from '../proveedores';

// ═══════════════════════════════════════════════════════════════════════════
// FACTURA QUE LLEGA SOLO EN PDF (buzón, Agente 9).
//
// Hasta la 0530 un correo con solo PDF se contaba y se ignoraba. Ahora se LEE, y
// lo leído NUNCA se presenta como dato duro:
//
//   1. Capa de texto del PDF (los CFDI digitales traen texto seleccionable): se
//      busca el folio fiscal (UUID), el total y los RFC. Un UUID ambiguo (varios
//      distintos) no se adivina: pasa a visión.
//   2. Si el texto no alcanza (PDF escaneado, o sin UUID/total), las primeras
//      páginas se rinden a imagen y se leen con el lector de visión que ya usa el
//      resto del producto (`extraerComprobante`: decodifica el QR del CFDI —que
//      trae UUID, RFC y total— y verifica con el modelo). Es el MISMO lector y las
//      mismas puertas (`validarFotoParaIngreso`) que la vía de foto.
//   3. A toda lectura se le asigna una CONFIANZA. Debajo de `UMBRAL_REVISION` la
//      factura entra marcada `requiere_revision`: una persona la coteja contra el
//      PDF antes de aprobar (y la aprobación humana existe de todos modos).
//
// Puro salvo por los puertos: el texto, las imágenes y la visión entran por
// `PuertosPdf` (adaptadores reales en pdf_adaptador.ts; dobles en las pruebas).
// ═══════════════════════════════════════════════════════════════════════════

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
/** Debajo de esto la lectura exige revisión humana. */
export const UMBRAL_REVISION = 0.8;

export interface DatosPdfFactura {
  uuid: string;
  total: number;
  subTotal: number | null;
  rfcEmisor: string | null;
  rfcReceptor: string | null;
  fecha: string | null;
  confianza: number;
  fuente: 'pdf_texto' | 'pdf_vision';
  /** Qué de la lectura merece una mirada (se copia al motivo de revisión). */
  notas: string[];
}

export type MotivoPdfFallido =
  | 'no_es_pdf' | 'demasiado_grande' | 'corrupto' | 'protegido'
  | 'ilegible' | 'sin_uuid' | 'sin_total' | 'sin_imagenes' | 'transitorio';

export type ResultadoPdf = { ok: true; datos: DatosPdfFactura } | { ok: false; motivo: MotivoPdfFallido };

export interface LecturaVision {
  legible: boolean;
  uuid: string | null;
  monto: number;
  subTotal: number | null;
  rfcEmisor: string | null;
  rfcReceptor: string | null;
  fecha: string | null;
  confianza: number | null;
}

export interface PuertosPdf {
  /** El texto de las primeras páginas. `corrupto` también cubre «no es un PDF que se pueda abrir». */
  leerTexto(bytes: Uint8Array): Promise<{ ok: true; texto: string } | { ok: false; motivo: 'corrupto' | 'protegido' }>;
  /** Las primeras páginas como data-URL de imagen. Vacío = no se pudo rendir. */
  imagenes(bytes: Uint8Array): Promise<string[]>;
  /** El lector de visión. LANZA si el proveedor falló (transitorio) o se agotó el presupuesto. */
  vision(imagenes: string[], signal: AbortSignal): Promise<LecturaVision>;
}

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const RFC = '[A-ZÑ&]{3,4}\\d{6}[A-Z0-9]{3}';

export function esPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

/** Los UUID distintos del texto, en minúsculas (el CFDI los guarda así en la base). */
export function uuidsEnTexto(texto: string): string[] {
  return [...new Set((texto.match(UUID_RE) ?? []).map((u) => u.toLowerCase()))];
}

function dinero(s: string): number | null {
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export interface LecturaTexto {
  uuids: string[];
  total: number | null;
  subTotal: number | null;
  rfcEmisor: string | null;
  rfcReceptor: string | null;
  fecha: string | null;
}

/** Lo que el texto del PDF dice. Heurística declarada: por eso la confianza máxima es 0.9. */
export function extraerDeTexto(texto: string): LecturaTexto {
  const plano = texto.replace(/[ \t]+/g, ' ');
  const totales = [...plano.matchAll(/(?<![a-z])total(?!es)[^\d\n]{0,25}\$?\s*([\d,]+\.\d{2})/gi)];
  const sub = /sub\s*total[^\d\n]{0,25}\$?\s*([\d,]+\.\d{2})/i.exec(plano);
  const emisor = new RegExp(`RFC\\s*(?:del\\s*)?emisor[^A-ZÑ&\\d]{0,15}(${RFC})`, 'i').exec(plano);
  const receptor = new RegExp(`RFC\\s*(?:del\\s*)?receptor[^A-ZÑ&\\d]{0,15}(${RFC})`, 'i').exec(plano);
  const fecha = /(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}/.exec(plano);
  return {
    uuids: uuidsEnTexto(texto),
    // El último «Total» del documento es el del comprobante (los anteriores suelen ser parciales por concepto).
    total: totales.length > 0 ? dinero(totales[totales.length - 1][1]) : null,
    subTotal: sub ? dinero(sub[1]) : null,
    rfcEmisor: emisor ? emisor[1].toUpperCase() : null,
    rfcReceptor: receptor ? receptor[1].toUpperCase() : null,
    fecha: fecha ? fecha[1] : null,
  };
}

export function requiereRevision(confianza: number): boolean {
  return confianza < UMBRAL_REVISION;
}

/**
 * Lee un PDF de factura. `textoYaLeido` evita abrir el PDF dos veces cuando el llamador ya lo hizo para
 * emparejarlo con un XML. Nunca lanza: un fallo de visión es `transitorio` (el correo se reintenta).
 */
export async function leerPdfFactura(
  bytes: Uint8Array,
  puertos: PuertosPdf,
  opciones: { textoYaLeido?: string; signal: AbortSignal },
): Promise<ResultadoPdf> {
  if (!esPdf(bytes)) return { ok: false, motivo: 'no_es_pdf' };
  if (bytes.length > MAX_PDF_BYTES) return { ok: false, motivo: 'demasiado_grande' };

  let texto = opciones.textoYaLeido;
  if (texto === undefined) {
    const t = await puertos.leerTexto(bytes);
    if (!t.ok) return { ok: false, motivo: t.motivo };
    texto = t.texto;
  }

  const delTexto = extraerDeTexto(texto);
  if (delTexto.uuids.length === 1 && delTexto.total !== null && delTexto.total > 0) {
    const completa = Boolean(delTexto.rfcEmisor && delTexto.rfcReceptor);
    return {
      ok: true,
      datos: {
        uuid: delTexto.uuids[0], total: delTexto.total, subTotal: delTexto.subTotal,
        rfcEmisor: delTexto.rfcEmisor, rfcReceptor: delTexto.rfcReceptor, fecha: delTexto.fecha,
        // Texto con UUID único + total + los dos RFC: 0.9. Sin los RFC no se puede cotejar el receptor: 0.7.
        confianza: completa ? 0.9 : 0.7,
        fuente: 'pdf_texto',
        notas: completa ? [] : ['el PDF no trae los RFC en un formato legible'],
      },
    };
  }

  // El texto no alcanza: visión. (Un UUID ambiguo —varios distintos— también cae aquí: no se elige uno.)
  const imagenes = await puertos.imagenes(bytes);
  if (imagenes.length === 0) {
    return { ok: false, motivo: delTexto.uuids.length === 0 && delTexto.total === null ? 'ilegible' : 'sin_imagenes' };
  }
  let lectura: LecturaVision;
  try {
    lectura = await puertos.vision(imagenes, opciones.signal);
  } catch {
    return { ok: false, motivo: 'transitorio' };
  }
  const puerta = validarFotoParaIngreso(
    { cfdiUuid: lectura.uuid ?? undefined, monto: lectura.monto },
    lectura.legible,
  );
  if (!puerta.ok) return { ok: false, motivo: puerta.motivo };

  const uuid = (lectura.uuid as string).toLowerCase();
  const notas: string[] = [];
  let confianza = lectura.confianza ?? 0;
  // Si el texto y la visión discrepan en el folio fiscal, la lectura no es de fiar.
  if (delTexto.uuids.length > 0 && !delTexto.uuids.includes(uuid)) {
    confianza = Math.min(confianza, 0.5);
    notas.push('el folio leído por visión no coincide con el del texto del PDF');
  }
  if (delTexto.total !== null && Math.abs(delTexto.total - lectura.monto) > 0.01) {
    confianza = Math.min(confianza, 0.6);
    notas.push('el total leído por visión no coincide con el del texto del PDF');
  }
  if (lectura.confianza === null) notas.push('el lector no declaró su confianza');
  return {
    ok: true,
    datos: {
      uuid, total: lectura.monto, subTotal: lectura.subTotal, rfcEmisor: lectura.rfcEmisor,
      rfcReceptor: lectura.rfcReceptor, fecha: lectura.fecha, confianza, fuente: 'pdf_vision', notas,
    },
  };
}
