import { llaveUnidad } from './formatos';
import type { ViajeFuente } from './viajes_fuente';

// ═══════════════════════════════════════════════════════════════════════════
// VINCULACIÓN CRUCE → VIAJE POR UNIDAD + VENTANA DE DÍAS (T-A2-19).
// Ruta de respaldo mientras la fuente de viajes no entrega `Icident`.
// Puro: sin base de datos ni red. Los viajes solo traen fecha (nunca hora),
// así que todo resultado es «por día», nunca «exacto».
// ═══════════════════════════════════════════════════════════════════════════

export interface CruceAVincular {
  /** Identificador del cruce dentro del lote (índice de fila o id). */
  id: string | number;
  /** Unidad tal como viene en el archivo del proveedor. */
  unidadArchivo: string | null | undefined;
  /** Fecha del cruce, YYYY-MM-DD. */
  fecha: string;
}

export type EstadoVinculo = 'ligado' | 'ambiguo' | 'sin_viaje' | 'sin_unidad';

export interface VinculoCruce {
  id: string | number;
  estado: EstadoVinculo;
  /** Solo con `ligado`. */
  viajeId: string | null;
  /** Viajes que cumplen la ventana: 1 con `ligado`, ≥2 con `ambiguo`. */
  candidatos: string[];
  via: 'unidad_ventana';
  /** Los viajes no traen hora: la vinculación es siempre por día. */
  precision: 'por_dia';
  /** Motivo cuando no hay unidad utilizable o la fecha es inválida. */
  motivo: string | null;
}

export interface OpcionesVincular {
  /** Días de holgura antes del inicio y después del fin del viaje. */
  margenDias?: number;
  /** Para un viaje abierto (fin nulo): ventana hasta `inicio + N`. No se infiere más. */
  diasViajeAbierto?: number;
}

/** Textos que no identifican una unidad concreta (no se fuerzan a ninguna). */
const NO_IDENTIFICA = new Set(['camioneta', 'camion', 'unidad', 'na', 'null', 'sinunidad', 'noaplica', 'nodisponible']);

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function diaNumero(ymd: string): number | null {
  if (!FECHA.test(ymd)) return null;
  const t = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== ymd) return null;
  return Math.round(t / 86_400_000);
}

/** Llave de unidad comparable, o null si el texto no identifica una unidad. */
export function llaveUnidadVinculo(v: string | null | undefined): string | null {
  const k = llaveUnidad(v ?? '');
  if (k === '' || NO_IDENTIFICA.has(k)) return null;
  return k;
}

interface VentanaViaje { id: string; desde: number; hasta: number }

/**
 * Liga cada cruce con el viaje de su unidad cuya ventana [inicio−margen, fin+margen]
 * contiene la fecha. Exactamente uno → `ligado`; ≥2 → `ambiguo` (no se elige);
 * ninguno → `sin_viaje`; unidad vacía o genérica → `sin_unidad`.
 * Devuelve un resultado por cruce, en el mismo orden de entrada.
 */
export function vincularCruces(
  cruces: readonly CruceAVincular[],
  viajes: readonly ViajeFuente[],
  opciones: OpcionesVincular = {},
): VinculoCruce[] {
  const margen = Math.max(0, Math.trunc(opciones.margenDias ?? 1));
  const abierto = Math.max(0, Math.trunc(opciones.diasViajeAbierto ?? 0));

  const porUnidad = new Map<string, VentanaViaje[]>();
  for (const v of viajes) {
    const k = llaveUnidadVinculo(v.unidadNumero);
    const ini = diaNumero(v.inicio);
    if (!k || ini === null) continue;
    const fin = v.fin === null ? ini + abierto : diaNumero(v.fin);
    if (fin === null || fin < ini) continue;
    const lista = porUnidad.get(k) ?? [];
    lista.push({ id: v.id, desde: ini - margen, hasta: fin + margen });
    porUnidad.set(k, lista);
  }

  const base = { via: 'unidad_ventana', precision: 'por_dia' } as const;
  return cruces.map((c): VinculoCruce => {
    const k = llaveUnidadVinculo(c.unidadArchivo);
    if (!k) return { id: c.id, estado: 'sin_unidad', viajeId: null, candidatos: [], motivo: 'unidad_no_identificada', ...base };
    const dia = diaNumero(c.fecha);
    if (dia === null) return { id: c.id, estado: 'sin_viaje', viajeId: null, candidatos: [], motivo: 'fecha_invalida', ...base };
    const candidatos = (porUnidad.get(k) ?? []).filter((w) => dia >= w.desde && dia <= w.hasta).map((w) => w.id);
    if (candidatos.length === 1) return { id: c.id, estado: 'ligado', viajeId: candidatos[0], candidatos, motivo: null, ...base };
    if (candidatos.length > 1) return { id: c.id, estado: 'ambiguo', viajeId: null, candidatos, motivo: null, ...base };
    return { id: c.id, estado: 'sin_viaje', viajeId: null, candidatos: [], motivo: null, ...base };
  });
}
