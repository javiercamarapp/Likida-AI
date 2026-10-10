import { haversineM, distanciaPuntoSegmentoM, coordenadasValidas } from './geo';
import { resolverCaseta, type CasetaCatalogo } from './casetas';

// ═══════════════════════════════════════════════════════════════════════════
// EL CRUCE POR CASETA — ¿la unidad estuvo en la caseta a la hora del cobro?
//
// Es el escalón espacial que `evidencia_gps.ts` dejó declarado como pendiente
// («no existe catálogo con lat/lng de plazas»): con el catálogo `peaje_caseta`
// (cargado por CSV, nunca sembrado), la hora del cobro (0375) y las posiciones
// de `posicion`, se mide la distancia Haversine entre la trayectoria de la
// unidad y la caseta alrededor del instante del cobro.
//
// ── LA DOCTRINA, EN TRES VEREDICTOS ────────────────────────────────────────
//
//   confirma     una posición cae dentro del radio de la caseta, o un tramo de
//                trayectoria entre dos posiciones cercanas en el tiempo pasa por
//                su radio. Es evidencia A FAVOR.
//   no_coincide  SOLO con datos suficientes para afirmarlo: dos posiciones
//                consecutivas que ENVUELVEN el instante del cobro, a poca
//                distancia temporal (≤ 6 min), cuya trayectoria queda a más de
//                radio + margen de la caseta. Aun así NO es una acusación: el
//                consumidor lo manda a «por verificar» (tag prestado, reloj del
//                proveedor desfasado, caseta mal ubicada en el catálogo).
//   sin_datos    todo lo demás, con su motivo exacto. Que el dato no alcance no
//                es evidencia en contra de nadie.
//
// FAIL-CLOSED: ante la duda, sin_datos. Este módulo es PURO.
// ═══════════════════════════════════════════════════════════════════════════

export const VENTANA_GPS_MIN = 20;
/** Dos posiciones separadas más que esto no se unen en un tramo para CONFIRMAR. */
export const MAX_HUECO_CONFIRMA_MIN = 15;
/** Para AFIRMAR que no coincide el hueco debe ser mucho menor: una curva de
 *  carretera entre dos muestras lejanas puede pasar por la caseta sin tocar la cuerda. */
export const MAX_HUECO_NO_COINCIDE_MIN = 6;
/** Tolerancia entre el reloj del proveedor y el del GPS al buscar el tramo. */
export const HOLGURA_RELOJ_MIN = 5;
export const MARGEN_LEJOS_M = 1000;

export interface Muestra { lat: number; lng: number; t: number }
export interface CasetaGeo { id: string; lat: number; lng: number; radioM: number }

export type MotivoSinDatos =
  | 'sin_hora'
  | 'sin_fecha'
  | 'sin_unidad'
  | 'sin_caseta'
  | 'caseta_ambigua'
  | 'sin_posiciones_ventana'
  | 'muestras_insuficientes';

export type VeredictoGps =
  | { veredicto: 'confirma'; distanciaM: number; via: 'muestra' | 'trayectoria'; muestras: number }
  | { veredicto: 'no_coincide'; distanciaM: number; muestras: number }
  | { veredicto: 'sin_datos'; motivo: MotivoSinDatos; distanciaM: number | null; muestras: number };

const MIN = 60_000;

export function sinDatos(motivo: MotivoSinDatos, muestras = 0, distanciaM: number | null = null): VeredictoGps {
  return { veredicto: 'sin_datos', motivo, distanciaM, muestras };
}

const redondear1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Evalúa UNA línea. `muestras` son las posiciones de la unidad dentro de la
 * ventana alrededor de `cruceMs` (en cualquier orden; se ordenan aquí).
 * Las muestras con coordenadas inválidas se ignoran.
 */
export function evaluarCruceGps(cruceMs: number, caseta: CasetaGeo, muestrasCrudas: readonly Muestra[]): VeredictoGps {
  const muestras = muestrasCrudas
    .filter((m) => Number.isFinite(m.t) && coordenadasValidas(m))
    .sort((a, b) => a.t - b.t);
  if (muestras.length === 0) return sinDatos('sin_posiciones_ventana');

  const radio = caseta.radioM;
  const distMuestra = muestras.map((m) => haversineM(m, caseta));
  const minMuestra = Math.min(...distMuestra);

  // 1) Una posición dentro del radio confirma.
  if (minMuestra <= radio) {
    return { veredicto: 'confirma', distanciaM: redondear1(minMuestra), via: 'muestra', muestras: muestras.length };
  }

  // 2) Un tramo entre dos posiciones cercanas en el tiempo que pase por el radio.
  let minTramo = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < muestras.length; i++) {
    const a = muestras[i];
    const b = muestras[i + 1];
    const hueco = b.t - a.t;
    if (hueco > MAX_HUECO_CONFIRMA_MIN * MIN) continue;
    // El tramo debe estar en el tiempo del cobro (con la holgura del reloj).
    if (b.t < cruceMs - HOLGURA_RELOJ_MIN * MIN || a.t > cruceMs + HOLGURA_RELOJ_MIN * MIN) continue;
    const d = distanciaPuntoSegmentoM(caseta, a, b);
    if (d < minTramo) minTramo = d;
    if (d <= radio) {
      return { veredicto: 'confirma', distanciaM: redondear1(d), via: 'trayectoria', muestras: muestras.length };
    }
  }

  // 3) ¿Datos suficientes para afirmar que NO coincide? Dos posiciones
  //    consecutivas que envuelven el cobro, poco separadas en el tiempo, con la
  //    trayectoria (y ambos extremos) a más de radio + margen.
  for (let i = 0; i + 1 < muestras.length; i++) {
    const a = muestras[i];
    const b = muestras[i + 1];
    if (!(a.t <= cruceMs && b.t >= cruceMs)) continue;
    if (b.t - a.t > MAX_HUECO_NO_COINCIDE_MIN * MIN) continue;
    const cuerda = haversineM(a, b);
    const margen = Math.max(MARGEN_LEJOS_M, 0.3 * cuerda);
    const dTramo = distanciaPuntoSegmentoM(caseta, a, b);
    if (dTramo > radio + margen && distMuestra[i] > radio + margen && distMuestra[i + 1] > radio + margen) {
      return { veredicto: 'no_coincide', distanciaM: redondear1(dTramo), muestras: muestras.length };
    }
  }

  // 4) Hay posiciones pero no alcanzan para concluir: no se acusa. Se reporta la
  //    distancia mínima medida, que es un hecho, junto al motivo.
  const mejor = Number.isFinite(minTramo) ? Math.min(minTramo, minMuestra) : minMuestra;
  return sinDatos('muestras_insuficientes', muestras.length, redondear1(mejor));
}

// ── La planeación: qué línea se puede evaluar y cuál no (con su motivo) ──────

export interface LineaParaGps {
  id: string;
  fecha: string | null;
  /** ISO UTC del cobro (desglose_peaje_linea.cruce_en). */
  cruceEn: string | null;
  /** Nombre de la caseta tal como lo trae el proveedor. */
  caseta: string | null;
  /** Unidad a evaluar: la del TAG, o la del viaje que cuadró. null = no se sabe. */
  unidadId: string | null;
}

export type PlanGps =
  | { listo: true; lineaId: string; unidadId: string; caseta: CasetaGeo; casetaId: string; cruceMs: number; desde: string; hasta: string }
  | { listo: false; lineaId: string; casetaId: string | null; veredicto: VeredictoGps };

/**
 * Para cada línea: o queda lista para consultar posiciones (con su ventana), o
 * se resuelve YA a `sin_datos` con el motivo exacto. Orden de las comprobaciones:
 * fecha → hora → unidad → caseta. PURA.
 */
export function planificarGps(lineas: readonly LineaParaGps[], catalogo: readonly CasetaCatalogo[]): PlanGps[] {
  return lineas.map((l): PlanGps => {
    if (!l.fecha) return { listo: false, lineaId: l.id, casetaId: null, veredicto: sinDatos('sin_fecha') };
    const cruceMs = l.cruceEn ? Date.parse(l.cruceEn) : Number.NaN;
    if (!Number.isFinite(cruceMs)) return { listo: false, lineaId: l.id, casetaId: null, veredicto: sinDatos('sin_hora') };
    const res = resolverCaseta(l.caseta, catalogo);
    const casetaId = res.tipo === 'unica' ? res.caseta.id : null;
    if (!l.unidadId) return { listo: false, lineaId: l.id, casetaId, veredicto: sinDatos('sin_unidad') };
    if (res.tipo === 'ninguna') return { listo: false, lineaId: l.id, casetaId: null, veredicto: sinDatos('sin_caseta') };
    if (res.tipo === 'ambigua') return { listo: false, lineaId: l.id, casetaId: null, veredicto: sinDatos('caseta_ambigua') };
    const c = res.caseta;
    return {
      listo: true, lineaId: l.id, unidadId: l.unidadId, casetaId: c.id, cruceMs,
      caseta: { id: c.id, lat: c.lat, lng: c.lng, radioM: c.radioM },
      desde: new Date(cruceMs - VENTANA_GPS_MIN * MIN).toISOString(),
      hasta: new Date(cruceMs + VENTANA_GPS_MIN * MIN).toISOString(),
    };
  });
}
