import { llaveUnidad, normalizarNombre } from './formatos';
import { resolverCaseta, type CasetaCatalogo } from './casetas';
import type { ViajeFuente, PosicionConViaje } from './viajes_fuente';

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

export type EstadoVinculo = 'ligado' | 'ambiguo' | 'sin_viaje' | 'sin_unidad' | 'conflicto';

export interface VinculoCruce {
  id: string | number;
  estado: EstadoVinculo;
  /** Solo con `ligado`. */
  viajeId: string | null;
  /** Viajes que cumplen la ventana: 1 con `ligado`, ≥2 con `ambiguo`. */
  candidatos: string[];
  via: 'unidad_ventana' | 'icident';
  /** Por ventana: los viajes no traen hora, siempre por día. Por Icident: por posición de la unidad en la caseta. */
  precision: 'por_dia' | 'por_posicion';
  /** `Icident` que respaldó el vínculo (o el que contradijo a la ventana en un `conflicto`). */
  icident?: string | null;
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

// ═══════════════════════════════════════════════════════════════════════════
// VINCULACIÓN POR `Icident` (T-A2-20): ruta preferente. Una posición de la
// misma unidad, en una caseta equivalente y dentro de ±`ventanaMin` del cruce,
// trae el `Icident` (número de despacho = viaje). Tiene precedencia sobre
// unidad+ventana; si se contradicen queda `conflicto` visible, sin decidir.
// Puro: sin red ni base de datos.
// ═══════════════════════════════════════════════════════════════════════════

export interface CruceIcident extends CruceAVincular {
  /** Nombre de la caseta tal como viene en el archivo del proveedor. */
  caseta: string | null | undefined;
  /** Hora del cruce 'HH:MM' o 'HH:MM:SS'; sin hora no hay coincidencia por posición. */
  hora: string | null | undefined;
}

export interface OpcionesIcident extends OpcionesVincular {
  /** Tolerancia en minutos entre el cruce y la posición. Por omisión 30. */
  ventanaMin?: number;
  /** Equivalencias de caseta/POI (alias de T-A2-05). Sin catálogo: nombres normalizados iguales. */
  catalogo?: readonly CasetaCatalogo[];
  /** Sustituye la comparación caseta↔POI (tiene prioridad sobre `catalogo`). */
  casetaEquivalente?: (caseta: string, puntoInteres: string) => boolean;
}

// eslint-disable-next-line security/detect-unsafe-regex -- patrón anclado de formato fijo, sin cuantificadores anidados ni retroceso exponencial; la entrada es un valor corto de una celda o campo
const HORA = /^(\d{2}):(\d{2})(?::\d{2})?$/;

function minutosDe(fecha: string, hora: string): number | null {
  const d = diaNumero(fecha);
  const m = HORA.exec(hora);
  if (d === null || !m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return d * 1440 + h * 60 + mi;
}

function minutosDePosicion(fh: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(fh);
  return m ? minutosDe(m[1], m[2]) : null;
}

function comparadorCaseta(o: OpcionesIcident): (a: string, b: string) => boolean {
  if (o.casetaEquivalente) return o.casetaEquivalente;
  const cat = o.catalogo;
  return (a, b) => {
    const na = normalizarNombre(a), nb = normalizarNombre(b);
    if (na !== '' && na === nb) return true;
    if (!cat || cat.length === 0) return false;
    const ra = resolverCaseta(a, cat), rb = resolverCaseta(b, cat);
    return ra.tipo === 'unica' && rb.tipo === 'unica' && ra.caseta.id === rb.caseta.id;
  };
}

interface PosIndexada { min: number; icident: string; poi: string }

/**
 * Liga por `Icident` y cae a unidad+ventana cuando no hay posición que lo respalde.
 * Devuelve un resultado por cruce, en el orden de entrada.
 */
export function vincularPorIcident(
  cruces: readonly CruceIcident[],
  viajes: readonly ViajeFuente[],
  posiciones: readonly PosicionConViaje[],
  opciones: OpcionesIcident = {},
): VinculoCruce[] {
  const ventanaMin = Math.max(0, Math.trunc(opciones.ventanaMin ?? 30));
  const equivalente = comparadorCaseta(opciones);
  const porVentana = vincularCruces(cruces, viajes, opciones);

  const viajesDeIcident = new Map<string, string[]>();
  for (const v of viajes) {
    if (!v.icident) continue;
    const l = viajesDeIcident.get(v.icident) ?? [];
    l.push(v.id);
    viajesDeIcident.set(v.icident, l);
  }
  const posPorUnidad = new Map<string, PosIndexada[]>();
  for (const p of posiciones) {
    const k = llaveUnidadVinculo(p.unidad);
    const min = minutosDePosicion(p.fechaHoraLocal);
    if (!k || min === null || !p.icident) continue;
    const l = posPorUnidad.get(k) ?? [];
    l.push({ min, icident: p.icident, poi: p.puntoInteres });
    posPorUnidad.set(k, l);
  }

  return cruces.map((c, i): VinculoCruce => {
    const base = porVentana[i];
    const k = llaveUnidadVinculo(c.unidadArchivo);
    const min = c.hora ? minutosDe(c.fecha, c.hora) : null;
    if (!k || min === null || !c.caseta) return base;

    const icidents = new Set<string>();
    for (const p of posPorUnidad.get(k) ?? []) {
      if (Math.abs(p.min - min) <= ventanaMin && equivalente(c.caseta, p.poi)) icidents.add(p.icident);
    }
    if (icidents.size === 0) return base; // sin posiciones que lo respalden: cae a unidad+ventana

    const propios = { via: 'icident', precision: 'por_posicion' } as const;
    if (icidents.size > 1) {
      const cand = [...new Set([...icidents].flatMap((x) => viajesDeIcident.get(x) ?? []))];
      return { id: c.id, estado: 'ambiguo', viajeId: null, candidatos: cand, motivo: 'varios_icident', icident: null, ...propios };
    }
    const icident = [...icidents][0];
    const viajesIc = viajesDeIcident.get(icident) ?? [];
    if (viajesIc.length !== 1) {
      // Icident sin viaje conocido (o repetido): no se inventa; queda la ventana, con el motivo a la vista.
      return { ...base, motivo: base.motivo ?? (viajesIc.length === 0 ? 'icident_sin_viaje' : 'icident_repetido'), icident };
    }
    const viajeIc = viajesIc[0];
    const enVentana = base.candidatos;
    const contradice = enVentana.length > 0 && !enVentana.includes(viajeIc);
    if (contradice) {
      return { id: c.id, estado: 'conflicto', viajeId: null, candidatos: [viajeIc, ...enVentana], motivo: 'icident_contradice_ventana', icident, ...propios };
    }
    return { id: c.id, estado: 'ligado', viajeId: viajeIc, candidatos: [viajeIc], motivo: null, icident, ...propios };
  });
}
