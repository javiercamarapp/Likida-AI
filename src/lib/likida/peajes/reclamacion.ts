import { haversineM, coordenadasValidas } from './geo';
import { dentroDeGeocerca } from '../conductor/geo';
import type { Muestra } from './cruce_gps';
import { numero } from '@/lib/formato';
import { evaluarCurso, type CursoAplicable, type EvaluacionCurso } from './cursos';

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
//   · Cuatro motivos, cada uno con su evidencia a la vista:
//       gps_lejos_de_caseta          (alta)  dos posiciones consecutivas que
//                                    envuelven la hora del pase ubican a la unidad
//                                    a más de radio + margen de la caseta
//                                    (veredicto `no_coincide` del cruce por caseta).
//       unidad_en_zona_no_autorizada (alta)  la posición más cercana a la hora del
//                                    pase está DENTRO de una geocerca de patio o
//                                    restringida de la flota (punto en su POLÍGONO
//                                    si lo tiene): una unidad parada en su patio no
//                                    cruza una caseta. Si la geocerca solo es un
//                                    círculo que sustituye a un polígono (aproximada),
//                                    la confianza baja a «media», nunca «alta».
//       doble_cobro                  (media) el mismo TAG cobrado dos veces en la
//                                    misma caseta con ≤ 10 min de diferencia. Puede
//                                    ser un retorno real: por eso es «media».
//       fuera_de_curso               (media) la unidad (o el convenio de su viaje) tiene un
//                                    CURSO —la ruta que la flota autoriza— y el pase NO
//                                    está dentro: la caseta no figura en sus casetas
//                                    autorizadas, o la posición GPS a la hora del pase
//                                    cae fuera del buffer de su corredor. «Media» porque
//                                    el curso lo declara la flota y un desvío autorizado
//                                    de último momento también explica el cruce. Sin curso
//                                    aplicable, o con un dato que no alcanza, NO se reclama
//                                    (ver `cursos.ts`).
//   · «Reclamable» NO significa «el cobro es indebido»: significa «hay evidencia
//     suficiente para PEDIR la revisión». La decisión de reclamar es de la
//     persona; el reporte lo dice en su leyenda.
//   · Los CURSOS salen de la tabla de la flota (`peaje_curso`, 0665): por casetas
//     autorizadas de un convenio A→B o de una unidad. El corredor (polilínea +
//     buffer) espera el formato real del cliente: no se inventan corredores.
//   · Cada línea recibe a lo más UN motivo, el más fuerte: GPS > zona > curso > doble cobro.
//
// PURO: sin base, sin red.
// ═══════════════════════════════════════════════════════════════════════════

export type MotivoReclamacion = 'gps_lejos_de_caseta' | 'unidad_en_zona_no_autorizada' | 'fuera_de_curso' | 'doble_cobro';
export type ConfianzaReclamacion = 'alta' | 'media';

export const ETIQUETA_MOTIVO_RECLAMACION: Record<MotivoReclamacion, string> = {
  gps_lejos_de_caseta: 'GPS lejos de la caseta',
  unidad_en_zona_no_autorizada: 'Unidad en zona no autorizada',
  fuera_de_curso: 'Cruce fuera de curso',
  doble_cobro: 'Posible doble cobro',
};

/** Diferencia máxima entre dos cobros del mismo TAG en la misma caseta para sospechar un doble cobro. */
export const VENTANA_DOBLE_COBRO_MIN = 10;
/** Cuántas posiciones se enseñan como evidencia de cada cruce. */
export const MAX_EVIDENCIA = 3;
/** Para decir «estaba en el patio» la posición más cercana a la hora del pase no puede estar más lejos en el tiempo que esto. */
export const MAX_DESFASE_ZONA_MIN = 10;

const MIN = 60_000;

export interface ZonaEntrada {
  nombre: string; tipo: string; lat: number; lng: number; radioM: number;
  /** 0630: polígono nativo de la zona; con él «dentro» es punto en polígono (un patio alargado ya no abarca la carretera de junto). */
  poligono?: readonly { lat: number; lng: number }[] | null;
  /** 0630: el círculo SUSTITUYE a un polígono del cliente que no se guardó: la acusación con él baja a confianza «media», nunca «alta». */
  aproximada?: boolean;
}
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
  /** La caseta del catálogo a la que se resolvió el pase (null = sin resolver); la necesita la evaluación del curso. */
  casetaId?: string | null;
  /** Los cursos que le aplican a la unidad o al convenio de su viaje (0665). Ausente o vacío = sin curso declarado. */
  cursos?: readonly CursoAplicable[];
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
  /** Solo en `fuera_de_curso`: los cursos que aplicaban y no autorizan el pase. */
  cursos: Array<{ nombre: string; tipo: 'casetas' | 'corredor' }>;
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
  /** Líneas sin curso declarado para su unidad o convenio: no se evalúan por curso (no es un hallazgo). */
  sinCurso: number;
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
  'Unidad en zona no autorizada: la posición más cercana a la hora del pase cae dentro de una geocerca de patio o restringida de la flota (dentro de su polígono cuando está cargado; si solo hay un círculo aproximado, la confianza es media).',
  'Posible doble cobro: el mismo TAG cobrado dos veces en la misma caseta con 10 minutos o menos de diferencia. Confianza media: puede ser un retorno real.',
  'La hora es la hora local de México tal como la trae el archivo del proveedor; el reloj del proveedor y el del GPS pueden diferir unos minutos.',
  'Cruce fuera de curso: la unidad (o el convenio de su viaje) tiene un curso —la ruta que la flota autoriza— y el pase no está dentro: la caseta no figura entre las casetas autorizadas del curso, o la posición GPS a la hora del pase cae fuera del buffer de su corredor. Confianza media: el curso lo declara la flota y un desvío autorizado de último momento también explica el cruce.',
  'Los cursos salen de la tabla que la flota cargó (casetas autorizadas por convenio A→B o por unidad). Una línea sin curso declarado, con la caseta sin resolver en el catálogo o (en un corredor) sin una posición cercana al pase NO se reclama por curso: se cuenta aparte. El corredor (polilínea y buffer) está listo con datos sintéticos; el formato real del cliente está pendiente.',
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

/**
 * La zona (patio o restringida) donde estaba la unidad a la hora del pase, si la posición MÁS cercana en el tiempo cae dentro.
 * «Dentro» lo decide el helper único (`dentroDeGeocerca`, 0630): polígono nativo si lo hay, círculo si no. Si la zona es un
 * círculo que SUSTITUYE a un polígono (`aproximada`), se devuelve marcada: la acusación con ella nunca queda «alta». Entre varias
 * zonas que contengan el punto gana la exacta sobre la aproximada.
 */
function zonaDelPase(l: LineaReclamable, zonas: readonly ZonaEntrada[]): { zona: ZonaEntrada; aproximada: boolean } | null {
  if (l.cruceMs === null || zonas.length === 0) return null;
  const cruce = l.cruceMs;
  const cercana = [...l.muestras]
    .filter((m) => Number.isFinite(m.t) && coordenadasValidas(m))
    .sort((a, b) => Math.abs(a.t - cruce) - Math.abs(b.t - cruce))[0];
  if (!cercana || Math.abs(cercana.t - cruce) > MAX_DESFASE_ZONA_MIN * MIN) return null;
  // La caseta misma no es una zona no autorizada: si la posición está dentro del radio de la caseta, no se reclama por zona.
  if (l.casetaGeo && haversineM(cercana, l.casetaGeo) <= l.casetaGeo.radioM) return null;
  let aproximada: { zona: ZonaEntrada; aproximada: boolean } | null = null;
  for (const z of zonas) {
    if (z.tipo !== 'patio' && z.tipo !== 'restringida') continue;
    const d = dentroDeGeocerca(cercana, z);
    if (!d.dentro) continue;
    if (!d.aproximada) return { zona: z, aproximada: false };
    aproximada ??= { zona: z, aproximada: true };
  }
  return aproximada;
}

/** La frase para el proveedor cuando el pase está fuera de curso (casetas autorizadas o corredor). */
function porQueFueraDeCurso(l: LineaReclamable, e: Extract<EvaluacionCurso, { estado: 'fuera' }>): string {
  const cuando = `${nombreUnidad(l)} cruzó ${nombreCaseta(l)}${l.fecha ? ` el ${l.fecha}` : ''}${l.hora ? ` a las ${l.hora.slice(0, 5)}` : ''}`;
  const partes: string[] = [];
  for (const c of e.cursos) {
    if (c.tipo === 'casetas') {
      partes.push(`esa caseta no está en su curso autorizado «${c.nombre}»${c.casetaNombres.length > 0 ? ` (casetas autorizadas: ${c.casetaNombres.join(' → ')})` : ''}`);
    }
  }
  if (e.corredor) {
    partes.push(`a la hora del pase su posición GPS estaba a ${metros(e.corredor.distanciaM)} del corredor «${e.corredor.nombre}», más allá de su buffer de ${metros(e.corredor.bufferM)}`);
  }
  return `${cuando}, fuera de su curso: ${partes.join('; y ')}.`;
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
  let confirmadas = 0, sinDatos = 0, sinEvaluar = 0, sinCurso = 0;
  for (const l of lineas) {
    const base = {
      indice: l.indice, fecha: l.fecha, hora: l.hora, caseta: l.caseta, casetaCatalogo: l.casetaCatalogo,
      tag: l.tag, unidad: l.unidad, monto: l.monto, radioCasetaM: l.casetaGeo?.radioM ?? null, cursos: [] as CruceReclamable['cursos'],
    };

    if (l.gps === 'no coincide') {
      const distancia = l.gpsDistanciaM;
      const evidencia = evidenciaDe(l);
      const hallada = zonaDelPase(l, zonas);
      const zona = hallada?.zona ?? null;
      cruces.push({
        ...base, motivo: 'gps_lejos_de_caseta', confianza: 'alta',
        porQue: `${nombreUnidad(l)} no estaba en ${nombreCaseta(l)} a la hora del pase${l.hora ? ` (${l.hora.slice(0, 5)})` : ''}: `
          + `su trayectoria GPS pasó a ${distancia !== null ? metros(distancia) : 'más de 1 km'} de la caseta${l.casetaGeo ? ` (radio de la caseta: ${metros(l.casetaGeo.radioM)})` : ''}.`
          + (zona ? (hallada?.aproximada ? ` A esa hora estaba cerca de «${zona.nombre}» (zona de forma aproximada).` : ` A esa hora estaba en «${zona.nombre}».`) : ''),
        distanciaM: distancia, evidencia, zona: zona ? { nombre: zona.nombre, tipo: zona.tipo } : null, duplicadoDeLinea: null,
      });
      continue;
    }

    const hallada = l.gps === 'confirma' ? null : zonaDelPase(l, zonas);
    if (hallada) {
      const { zona, aproximada } = hallada;
      cruces.push({
        ...base, motivo: 'unidad_en_zona_no_autorizada', confianza: aproximada ? 'media' : 'alta',
        porQue: aproximada
          ? `${nombreUnidad(l)} estaba en el área aproximada de «${zona.nombre}» (${zona.tipo === 'patio' ? 'patio' : 'zona restringida'} de la flota) a la hora del pase en ${nombreCaseta(l)}. La forma exacta de esa geocerca no está cargada y se midió con el círculo que la contiene, así que puede ser una unidad que iba por la vía de junto: confirma antes de reclamar.`
          : `${nombreUnidad(l)} estaba dentro de «${zona.nombre}» (${zona.tipo === 'patio' ? 'patio' : 'zona restringida'} de la flota) a la hora del pase en ${nombreCaseta(l)}: no pudo cruzar la caseta.`,
        distanciaM: l.gpsDistanciaM, evidencia: evidenciaDe(l), zona: { nombre: zona.nombre, tipo: zona.tipo }, duplicadoDeLinea: null,
      });
      continue;
    }

    const curso: EvaluacionCurso = evaluarCurso({ fecha: l.fecha, casetaId: l.casetaId ?? null, cruceMs: l.cruceMs, muestras: l.muestras, cursos: l.cursos ?? [] });
    if (curso.estado === 'fuera') {
      cruces.push({
        ...base, motivo: 'fuera_de_curso', confianza: 'media',
        porQue: porQueFueraDeCurso(l, curso),
        distanciaM: curso.corredor ? curso.corredor.distanciaM : null, evidencia: evidenciaDe(l), zona: null, duplicadoDeLinea: null,
        cursos: curso.cursos.map((c) => ({ nombre: c.nombre, tipo: c.tipo })),
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

    if (curso.estado === 'sin_curso') sinCurso++;
    if (l.gps === 'confirma') confirmadas++;
    else if (l.gps === 'sin datos') sinDatos++;
    else sinEvaluar++;
  }

  const porMotivo: ResumenReclamacion['porMotivo'] = {
    gps_lejos_de_caseta: { n: 0, monto: 0 }, unidad_en_zona_no_autorizada: { n: 0, monto: 0 }, fuera_de_curso: { n: 0, monto: 0 }, doble_cobro: { n: 0, monto: 0 },
  };
  let monto = 0;
  for (const c of cruces) {
    porMotivo[c.motivo].n++;
    porMotivo[c.motivo].monto = Math.round((porMotivo[c.motivo].monto + c.monto) * 100) / 100;
    monto = Math.round((monto + c.monto) * 100) / 100;
  }
  return {
    cruces,
    resumen: { lineas: lineas.length, reclamables: cruces.length, montoReclamable: monto, porMotivo, confirmadas, sinDatos, sinEvaluar, sinCurso },
  };
}

