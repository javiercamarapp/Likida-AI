// ═══════════════════════════════════════════════════════════════════════════
// ESTATUS DE IMPORTACIÓN POR CAJA (T-A4-36, migración 0799).
//
// Lo que pidió el cliente (levantamiento 9df88631 ~16:56 y ~17:26): saber si la caja ya está en patio / pendiente de
// cruce / en ruta, y si ya tiene sus documentos (listo / pendiente de requisito). Hoy una persona lo escribe a mano en el
// programa («no siempre» lo tiene al día). Mientras no haya acceso a Track & Trace, el estatus se DERIVA de las columnas
// TRANSITO y CCP del programa de despacho; este archivo es ese mapeo y la regla de qué fuente manda.
//
//   TRANSITO  PATIO NLD → patio · PEND CRUCE → pend_cruce · EN RUTA → en_ruta
//             PATIO EXT → patio   («Patio Nuevo Laredo no solamente es Patio Nuevo Laredo… se pone en patio también»)
//             OK, N/A, vacío, valores raros → desconocido (nunca se adivina)
//   CCP       LISTO → listo · PEND REQUE CCP → pend_requisito
//             todo lo demás (DESPACHADO, PEND CCP, FALTA DE COMPLEMENTO, vacío, raros) → desconocido
//
// Cuál fuente manda para una caja: la de `observado_en` MAYOR; una fuente más vieja nunca pisa a una más nueva. En un
// empate exacto gana la más confiable (manual > track_trace > programa) para que el resultado no dependa del orden.
// Código puro: sin red, sin base de datos, sin credenciales.
// ═══════════════════════════════════════════════════════════════════════════
import type { Ccp, Transito } from '../programa/normalizar';

export const ESTADOS_IMPORTACION = ['patio', 'pend_cruce', 'en_ruta', 'desconocido'] as const;
export type EstadoImportacion = (typeof ESTADOS_IMPORTACION)[number];

export const DOCS_IMPORTACION = ['listo', 'pend_requisito', 'desconocido'] as const;
export type DocsImportacion = (typeof DOCS_IMPORTACION)[number];

export const FUENTES_IMPORTACION = ['programa', 'track_trace', 'manual'] as const;
export type FuenteImportacion = (typeof FUENTES_IMPORTACION)[number];

/** Una fila de `vigia_estatus_importacion` (lo último que UNA fuente dijo de una caja). */
export interface EstatusImportacion {
  caja: string;
  unidad: string | null;
  estado: EstadoImportacion;
  docs: DocsImportacion;
  fuente: FuenteImportacion;
  /** Cuándo lo vio la fuente (ISO 8601 con zona). */
  observadoEn: string;
  /** Fila del programa de la que salió, si viene de una. */
  filaId: string | null;
}

const TRANSITO_A_ESTADO: Record<Transito, EstadoImportacion> = {
  patio_nld: 'patio',
  patio_otro: 'patio',
  pend_cruce: 'pend_cruce',
  en_ruta: 'en_ruta',
  ok: 'desconocido',
  na: 'desconocido',
  vacio: 'desconocido',
  desconocido: 'desconocido',
};

const CCP_A_DOCS: Record<Ccp, DocsImportacion> = {
  listo: 'listo',
  pend_reque: 'pend_requisito',
  despachado: 'desconocido',
  pend_ccp: 'desconocido',
  falta_complemento: 'desconocido',
  vacio: 'desconocido',
  desconocido: 'desconocido',
};

/** TRANSITO del programa → estado de la caja. Un valor fuera del catálogo (o `undefined`) es `desconocido`. */
export function estadoDesdeTransito(transito: Transito | string | null | undefined): EstadoImportacion {
  if (typeof transito !== 'string') return 'desconocido';
  return Object.prototype.hasOwnProperty.call(TRANSITO_A_ESTADO, transito)
    ? TRANSITO_A_ESTADO[transito as Transito]
    : 'desconocido';
}

/** CCP del programa → si la caja tiene sus documentos. Un valor fuera del catálogo (o `undefined`) es `desconocido`. */
export function docsDesdeCcp(ccp: Ccp | string | null | undefined): DocsImportacion {
  if (typeof ccp !== 'string') return 'desconocido';
  return Object.prototype.hasOwnProperty.call(CCP_A_DOCS, ccp) ? CCP_A_DOCS[ccp as Ccp] : 'desconocido';
}

/** Confianza para desempatar dos fuentes con el mismo `observado_en` (mayor = gana). */
const PESO_FUENTE: Record<FuenteImportacion, number> = { programa: 0, track_trace: 1, manual: 2 };

/** Milisegundos de una fecha ISO; `null` si no es una fecha válida. */
function instante(iso: string): number | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * Entre lo que ya se sabe de una caja y un dato nuevo, ¿cuál manda? El nuevo solo gana si su `observado_en` es MAYOR;
 * un `observado_en` ilegible nunca gana. Empate exacto: la fuente más confiable (manual > track_trace > programa); si
 * es la misma fuente, se conserva lo que ya había.
 */
export function quienManda(actual: EstatusImportacion, nuevo: EstatusImportacion): EstatusImportacion {
  const tn = instante(nuevo.observadoEn);
  if (tn === null) return actual;
  const ta = instante(actual.observadoEn);
  if (ta === null) return nuevo;
  if (tn > ta) return nuevo;
  if (tn < ta) return actual;
  return PESO_FUENTE[nuevo.fuente] > PESO_FUENTE[actual.fuente] ? nuevo : actual;
}

const clavCaja = (caja: string): string => caja.trim().toLowerCase();

/**
 * Estatus vigente de cada caja a partir de lo que dijo cada fuente: por caja (sin importar mayúsculas ni espacios en
 * los extremos) manda `quienManda`. El resultado no depende del orden de entrada. Cajas en blanco se descartan.
 */
export function estatusVigente(registros: readonly EstatusImportacion[]): Map<string, EstatusImportacion> {
  const por = new Map<string, EstatusImportacion>();
  for (const r of registros) {
    const k = clavCaja(r.caja);
    if (k === '') continue;
    const previo = por.get(k);
    por.set(k, previo ? quienManda(previo, r) : r);
  }
  return por;
}

export type ComparacionFuentes = 'coinciden' | 'difieren' | 'sin_comparar';

/**
 * ¿El programa y Track & Trace dicen lo mismo de una caja? Solo se compara lo que ambos saben: un `desconocido` de
 * cualquiera de los dos no cuenta como desacuerdo. Sin una de las dos fuentes → `sin_comparar`.
 */
export function compararProgramaConTrackTrace(
  programa: EstatusImportacion | undefined,
  trackTrace: EstatusImportacion | undefined,
): ComparacionFuentes {
  if (!programa || !trackTrace) return 'sin_comparar';
  const chocaEstado =
    programa.estado !== 'desconocido' && trackTrace.estado !== 'desconocido' && programa.estado !== trackTrace.estado;
  const chocaDocs =
    programa.docs !== 'desconocido' && trackTrace.docs !== 'desconocido' && programa.docs !== trackTrace.docs;
  return chocaEstado || chocaDocs ? 'difieren' : 'coinciden';
}
