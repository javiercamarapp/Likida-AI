import { haversineM, coordenadasValidas } from './geo';
import type { Muestra } from './cruce_gps';
import { numero } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// EL REPORTE DE RECLAMACIÓN DE PEAJES — «pásame los cruces que le puedo pedir
// al proveedor que me descuente».
//
// La bitácora conciliada lista TODAS las líneas con su estado; esta pieza toma
// de ahí solo las que tienen una razón EXPLICABLE Y CON EVIDENCIA para pedir un
// descuento, y arma por cada una lo que el proveedor va a pedir: fecha, caseta,
// TAG, unidad, monto, POR QUÉ está fuera de lo que la flota hizo y la evidencia
// de GPS que lo respalda.
//
// ── LA DOCTRINA (la misma del cruce por caseta) ─────────────────────────────
//
//   · Una línea entra al reporte SOLO con evidencia positiva en contra del
//     cobro. «No hay datos» NO es evidencia: una línea sin GPS, sin hora o sin
//     TAG dado de alta no se reclama (queda en `sinEvidencia`, contada, para que
//     la persona sepa qué dato falta, no para acusar).
//   · Tres motivos, cada uno con su evidencia a la vista:
//       gps_lejos_de_caseta          (alta)  dos posiciones consecutivas que
//                                    envuelven la hora del pase ubican a la unidad
//                                    a más de radio + margen de la caseta
//                                    (veredicto `no_coincide` del cruce por caseta).
//       unidad_en_zona_no_autorizada (alta)  la posición más cercana a la hora del
//                                    pase está DENTRO de una geocerca de patio o
//                                    restringida de la flota: una unidad parada en
//                                    su patio no cruza una caseta.
//       doble_cobro                  (media) el mismo TAG cobrado dos veces en la
//                                    misma caseta con ≤ 10 min de diferencia. Puede
//                                    ser un retorno real: por eso es «media».
//   · «Reclamable» NO significa «el cobro es indebido»: significa «hay evidencia
//     suficiente para PEDIR la revisión». La decisión de reclamar es de la
//     persona; el reporte lo dice en su leyenda.
//   · Los CURSOS (rutas autorizadas por unidad) quedan fuera hasta que el cliente
//     entregue su tabla de cursos/geocercas: no se inventan corredores.
//
// PURO: sin base, sin red.
// ═══════════════════════════════════════════════════════════════════════════

export type MotivoReclamacion = 'gps_lejos_de_caseta' | 'unidad_en_zona_no_autorizada' | 'doble_cobro';
export type ConfianzaReclamacion = 'alta' | 'media';

export const ETIQUETA_MOTIVO_RECLAMACION: Record<MotivoReclamacion, string> = {
  gps_lejos_de_caseta: 'GPS lejos de la caseta',
  unidad_en_zona_no_autorizada: 'Unidad en zona no autorizada',
  doble_cobro: 'Posible doble cobro',
};

/** Diferencia máxima entre dos cobros del mismo TAG en la misma caseta para sospechar un doble cobro. */
export const VENTANA_DOBLE_COBRO_MIN = 10;
/** Cuántas posiciones se enseñan como evidencia de cada cruce. */
export const MAX_EVIDENCIA = 3;
/** Para decir «estaba en el patio» la posición más cercana a la hora del pase no puede estar más lejos en el tiempo que esto. */
export const MAX_DESFASE_ZONA_MIN = 10;

const MIN = 60_000;

export interface ZonaEntrada { nombre: string; tipo: string; lat: number; lng: number; radioM: number }
export interface CasetaEntrada { lat: number; lng: number; radioM: number }

/** Una línea del desglose, lista para evaluar (la arma la capa de datos). */
export interface LineaReclamable {
  indice: number;
  fecha: string;
  hora: string;
  caseta: string;
  casetaCatalogo: string;
  tag: string;
  unidad: string;
  monto: number;
  /** Instante del pase (ms UTC), o null si el archivo no trae hora. */
  cruceMs: number | null;
  gps: 'confirma' | 'no coincide' | 'sin datos' | 'sin evaluar';
  gpsDistanciaM: number | null;
  gpsNota: string;
  casetaGeo: CasetaEntrada | null;
  /** Posiciones de la unidad alrededor del pase (solo se traen para las candidatas). */
  muestras: readonly Muestra[];
}

export interface EvidenciaMuestra {
  /** ISO UTC de la posición. */
  en: string;
  lat: number;
  lng: number;
  /** Minutos respecto a la hora del pase (negativo = antes). */
  minutosDelPase: number;
  /** Distancia de esa posición a la caseta (m), o null si la caseta no tiene coordenadas. */
  distanciaCasetaM: number | null;
}

export interface CruceReclamable {
  indice: number;
  fecha: string;
  hora: string;
  caseta: string;
  casetaCatalogo: string;
  tag: string;
  unidad: string;
  monto: number;
  motivo: MotivoReclamacion;
  confianza: ConfianzaReclamacion;
  /** La frase para el proveedor: por qué este cruce está fuera de lo que la flota hizo. */
  porQue: string;
  /** Distancia medida unidad↔caseta (m), si existe. */
  distanciaM: number | null;
  radioCasetaM: number | null;
  evidencia: EvidenciaMuestra[];
  zona: { nombre: string; tipo: string } | null;
  /** Línea (1-based, como en la bitácora) del primer cobro, solo en `doble_cobro`. */
  duplicadoDeLinea: number | null;
}

export interface ResumenReclamacion {
  lineas: number;
  reclamables: number;
  montoReclamable: number;
  porMotivo: Record<MotivoReclamacion, { n: number; monto: number }>;
  /** Líneas sin evidencia positiva (confirmadas por GPS o sin datos): NO se reclaman, se cuentan. */
  confirmadas: number;
  sinDatos: number;
  sinEvaluar: number;
}

export interface ReporteReclamacion {
  desgloseId: string;
  proveedor: string | null;
  periodoDesde: string | null;
  periodoHasta: string | null;
  cruces: CruceReclamable[];
  resumen: ResumenReclamacion;
  leyendas: readonly string[];
}

export const LEYENDAS_RECLAMACION: readonly string[] = [
  'Reporte de cruces para pedir al proveedor de peaje la revisión de un cobro. Lo prepara Likida con el desglose del proveedor, el catálogo de TAGs y casetas de la flota y las posiciones GPS de las unidades. La decisión de reclamar es de la flota.',
  'Solo entran las líneas con evidencia a favor de la reclamación. «Sin datos» (sin hora, TAG sin dar de alta, caseta sin coordenadas, sin posiciones) NO es evidencia en contra de nadie y no se reclama: se cuenta aparte para saber qué dato falta.',
  'GPS lejos de la caseta: dos posiciones consecutivas de la unidad, una antes y otra después de la hora del pase, a menos de 6 minutos entre sí, la ubican a más de radio + margen de la caseta (distancia Haversine contra las coordenadas del catálogo).',
  'Unidad en zona no autorizada: la posición más cercana a la hora del pase cae dentro de una geocerca de patio o restringida de la flota.',
  'Posible doble cobro: el mismo TAG cobrado dos veces en la misma caseta con 10 minutos o menos de diferencia. Confianza media: puede ser un retorno real.',
  'La hora es la hora local de México tal como la trae el archivo del proveedor; el reloj del proveedor y el del GPS pueden diferir unos minutos.',
  'Pendiente de datos de la flota: las rutas autorizadas por unidad («cursos») no se evalúan hasta contar con su tabla; un cruce fuera de curso pero cerca de su caseta no aparece aquí.',
];

const redondear1 = (n: number) => Math.round(n * 10) / 10;
const metros = (n: number) => `${numero(Math.round(n))} m`;

const normCaseta = (l: { casetaCatalogo: string; caseta: string }) =>
  (l.casetaCatalogo || l.caseta).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Las posiciones más cercanas en el tiempo a la hora del pase (hasta `MAX_EVIDENCIA`), en orden cronológico. */
function evidenciaDe(l: LineaReclamable): EvidenciaMuestra[] {
  if (l.cruceMs === null) return [];
  const cruce = l.cruceMs;
  return [...l.muestras]
    .filter((m) => Number.isFinite(m.t) && coordenadasValidas(m))
    .sort((a, b) => Math.abs(a.t - cruce) - Math.abs(b.t - cruce))
    .slice(0, MAX_EVIDENCIA)
    .sort((a, b) => a.t - b.t)
    .map((m) => ({
      en: new Date(m.t).toISOString(),
      lat: Math.round(m.lat * 1e6) / 1e6,
      lng: Math.round(m.lng * 1e6) / 1e6,
      minutosDelPase: Math.round(((m.t - cruce) / MIN) * 10) / 10,
      distanciaCasetaM: l.casetaGeo ? redondear1(haversineM(m, l.casetaGeo)) : null,
    }));
}

/** La zona (patio o restringida) donde estaba la unidad a la hora del pase, si la posición MÁS cercana en el tiempo cae dentro. */
function zonaDelPase(l: LineaReclamable, zonas: readonly ZonaEntrada[]): ZonaEntrada | null {
  if (l.cruceMs === null || zonas.length === 0) return null;
  const cruce = l.cruceMs;
  const cercana = [...l.muestras]
    .filter((m) => Number.isFinite(m.t) && coordenadasValidas(m))
    .sort((a, b) => Math.abs(a.t - cruce) - Math.abs(b.t - cruce))[0];
  if (!cercana || Math.abs(cercana.t - cruce) > MAX_DESFASE_ZONA_MIN * MIN) return null;
  // La caseta misma no es una zona no autorizada: si la posición está dentro del radio de la caseta, no se reclama por zona.
  if (l.casetaGeo && haversineM(cercana, l.casetaGeo) <= l.casetaGeo.radioM) return null;
  for (const z of zonas) {
    if (z.tipo !== 'patio' && z.tipo !== 'restringida') continue;
    const d = haversineM(cercana, z);
    if (Number.isFinite(d) && d <= z.radioM) return z;
  }
  return null;
}

const nombreUnidad = (l: LineaReclamable) => (l.unidad ? `la unidad ${l.unidad}` : 'la unidad del TAG');
const nombreCaseta = (l: LineaReclamable) => l.casetaCatalogo || l.caseta || 'la caseta';

/**
 * Las líneas reclamables de un desglose, en el orden del archivo, y el resumen.
 * Cada línea recibe a lo más UN motivo (el más fuerte: GPS > zona > doble cobro).
 */
export function construirReclamacion(
  lineas: readonly LineaReclamable[],
  zonas: readonly ZonaEntrada[],
): { cruces: CruceReclamable[]; resumen: ResumenReclamacion } {
  // Doble cobro: por TAG + caseta, ordenado por instante; todo cobro posterior al primero dentro de la ventana es el «duplicado».
  const duplicadoDe = new Map<number, number>(); // índice de la línea duplicada → línea (1-based) del primer cobro
  const grupos = new Map<string, LineaReclamable[]>();
  for (const l of lineas) {
    if (!l.tag || l.cruceMs === null) continue;
    const k = `${l.tag}|${normCaseta(l)}`;
    const g = grupos.get(k) ?? [];
    g.push(l);
    grupos.set(k, g);
  }
  for (const g of grupos.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => (a.cruceMs as number) - (b.cruceMs as number) || a.indice - b.indice);
    let ancla = g[0];
    for (const l of g.slice(1)) {
      if ((l.cruceMs as number) - (ancla.cruceMs as number) <= VENTANA_DOBLE_COBRO_MIN * MIN) duplicadoDe.set(l.indice, ancla.indice + 1);
      else ancla = l;
    }
  }

  const cruces: CruceReclamable[] = [];
  let confirmadas = 0, sinDatos = 0, sinEvaluar = 0;
  for (const l of lineas) {
    const base = {
      indice: l.indice, fecha: l.fecha, hora: l.hora, caseta: l.caseta, casetaCatalogo: l.casetaCatalogo,
      tag: l.tag, unidad: l.unidad, monto: l.monto, radioCasetaM: l.casetaGeo?.radioM ?? null,
    };

    if (l.gps === 'no coincide') {
      const distancia = l.gpsDistanciaM;
      const evidencia = evidenciaDe(l);
      const zona = zonaDelPase(l, zonas);
      cruces.push({
        ...base, motivo: 'gps_lejos_de_caseta', confianza: 'alta',
        porQue: `${nombreUnidad(l)} no estaba en ${nombreCaseta(l)} a la hora del pase${l.hora ? ` (${l.hora.slice(0, 5)})` : ''}: `
          + `su trayectoria GPS pasó a ${distancia !== null ? metros(distancia) : 'más de 1 km'} de la caseta${l.casetaGeo ? ` (radio de la caseta: ${metros(l.casetaGeo.radioM)})` : ''}.`
          + (zona ? ` A esa hora estaba en «${zona.nombre}».` : ''),
        distanciaM: distancia, evidencia, zona: zona ? { nombre: zona.nombre, tipo: zona.tipo } : null, duplicadoDeLinea: null,
      });
      continue;
    }

    const zona = l.gps === 'confirma' ? null : zonaDelPase(l, zonas);
    if (zona) {
      cruces.push({
        ...base, motivo: 'unidad_en_zona_no_autorizada', confianza: 'alta',
        porQue: `${nombreUnidad(l)} estaba dentro de «${zona.nombre}» (${zona.tipo === 'patio' ? 'patio' : 'zona restringida'} de la flota) a la hora del pase en ${nombreCaseta(l)}: no pudo cruzar la caseta.`,
        distanciaM: l.gpsDistanciaM, evidencia: evidenciaDe(l), zona: { nombre: zona.nombre, tipo: zona.tipo }, duplicadoDeLinea: null,
      });
      continue;
    }

    const primero = duplicadoDe.get(l.indice);
    if (primero !== undefined) {
      cruces.push({
        ...base, motivo: 'doble_cobro', confianza: 'media',
        porQue: `El TAG ${l.tag} fue cobrado dos veces en ${nombreCaseta(l)} con ${VENTANA_DOBLE_COBRO_MIN} minutos o menos de diferencia (primer cobro: línea ${primero}). Se reclama el segundo.`,
        distanciaM: null, evidencia: [], zona: null, duplicadoDeLinea: primero,
      });
      continue;
    }

    if (l.gps === 'confirma') confirmadas++;
    else if (l.gps === 'sin datos') sinDatos++;
    else sinEvaluar++;
  }

  const porMotivo: ResumenReclamacion['porMotivo'] = {
    gps_lejos_de_caseta: { n: 0, monto: 0 }, unidad_en_zona_no_autorizada: { n: 0, monto: 0 }, doble_cobro: { n: 0, monto: 0 },
  };
  let monto = 0;
  for (const c of cruces) {
    porMotivo[c.motivo].n++;
    porMotivo[c.motivo].monto = Math.round((porMotivo[c.motivo].monto + c.monto) * 100) / 100;
    monto = Math.round((monto + c.monto) * 100) / 100;
  }
  return {
    cruces,
    resumen: { lineas: lineas.length, reclamables: cruces.length, montoReclamable: monto, porMotivo, confirmadas, sinDatos, sinEvaluar },
  };
}

