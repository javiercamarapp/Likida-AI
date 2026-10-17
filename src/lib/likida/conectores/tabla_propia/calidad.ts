import type { PosicionTablaPropia } from './contrato';
import { ZONA_POR_OMISION, localAUtc } from './tiempo';
import { llaveEconomico } from './validar';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-15 — Lo que se puede decir de una tabla GPS «combinada» sin saber nada
// de quién es: qué tan tarde llegan sus puntos (latencia de la fuente) y si de
// verdad trae POSICIONES CONTINUAS o solo EVENTOS en puntos de interés.
// Funciones puras sobre las filas ya leídas: nada se guarda por fila (la
// latencia sale agregada, p95 por día) y el punto de interés solo se cuenta.
// ═══════════════════════════════════════════════════════════════════════════

export interface UmbralesCalidad {
  /** Minutos hacia atrás desde «ahora» en los que se mide la continuidad (por omisión, la última hora). */
  ventanaMin: number;
  /** Si menos de este % de las unidades en tránsito trae ≥ `posicionesMinimas` en la ventana, se avisa. */
  porcentajeMinimo: number;
  /** Cuántas posiciones en la ventana cuentan como «continuo» (≥ 2: una sola es un evento suelto). */
  posicionesMinimas: number;
  /** Con menos unidades que esto no hay muestra para opinar: no se avisa (ni se dice que está bien). */
  unidadesMinimas: number;
}

/** Umbrales SINTÉTICOS (no vienen del cliente): se ajustan cuando llegue la semana de datos reales. */
export const UMBRALES_CALIDAD_POR_OMISION: UmbralesCalidad = { ventanaMin: 60, porcentajeMinimo: 70, posicionesMinimas: 2, unidadesMinimas: 3 };

export const AVISO_SOLO_EVENTOS =
  'La tabla parece traer solo eventos, no posiciones continuas: la detección por geocerca y la señal de vida no son confiables.';

/** Percentil 95 por rango más cercano (nearest-rank) de una lista de números; null si está vacía. */
export function percentil95(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.max(0, Math.ceil(0.95 * orden.length) - 1)];
}

/** Segundos entre que se midió el punto y que llegó a SU sistema (con la zona de la flota); null si la fila no trae «recibido». */
export function latenciaSegundos(f: Pick<PosicionTablaPropia, 'fechaHoraLocal' | 'fechaRecibidaLocal'>, zona: string): number | null {
  if (!f.fechaRecibidaLocal) return null;
  return Math.round((localAUtc(f.fechaRecibidaLocal, zona).getTime() - localAUtc(f.fechaHoraLocal, zona).getTime()) / 1_000);
}

export interface LatenciaAgregada {
  /** Cuántas filas aportaron una latencia válida (≥ 0). */
  muestras: number;
  p95Segundos: number | null;
  /** p95 por día LOCAL de la medida («AAAA-MM-DD»): lo que se anota en el latido del cron, sin columna por fila. */
  p95PorDia: Record<string, { muestras: number; p95Segundos: number }>;
  /** Filas cuyo «recibido» es ANTERIOR a la medida: casi siempre una zona horaria mal declarada; no entran al p95. */
  recibidoAntesDeMedido: number;
}

export function latenciaAgregada(filas: readonly PosicionTablaPropia[], zona: string = ZONA_POR_OMISION): LatenciaAgregada {
  const todas: number[] = []; const porDia = new Map<string, number[]>(); let antes = 0;
  for (const f of filas) {
    const s = latenciaSegundos(f, zona);
    if (s === null) continue;
    if (s < 0) { antes += 1; continue; }
    todas.push(s);
    const dia = f.fechaHoraLocal.slice(0, 10);
    porDia.set(dia, [...(porDia.get(dia) ?? []), s]);
  }
  const p95PorDia: LatenciaAgregada['p95PorDia'] = {};
  for (const [dia, v] of [...porDia.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) p95PorDia[dia] = { muestras: v.length, p95Segundos: percentil95(v) as number };
  return { muestras: todas.length, p95Segundos: percentil95(todas), p95PorDia, recibidoAntesDeMedido: antes };
}

export interface CalidadContinuidad {
  /** false = no hay unidades suficientes para opinar (sin aviso). */
  suficiente: boolean;
  unidadesEnTransito: number;
  conPosicionesSuficientes: number;
  /** % (0–100) de las unidades en tránsito con ≥ `posicionesMinimas` en la ventana; null si no hay muestra. */
  porcentaje: number | null;
  /** El aviso literal de «solo eventos», o null si la tabla parece continua (o no hay muestra). */
  aviso: string | null;
}

/**
 * ¿La tabla trae posiciones continuas? En la última hora (configurable), qué parte de las unidades en tránsito trae al menos
 * 2 posiciones. «En tránsito» = las que mandaron algo en la ventana, salvo que quien llama dé su lista (p. ej. las de un
 * viaje abierto): una unidad en tránsito SIN ninguna posición cuenta como falla.
 */
export function evaluarContinuidad(
  filas: readonly PosicionTablaPropia[], zona: string, ahoraMs: number,
  opciones: { umbrales?: Partial<UmbralesCalidad>; unidadesEnTransito?: readonly string[] } = {},
): CalidadContinuidad {
  const u = { ...UMBRALES_CALIDAD_POR_OMISION, ...opciones.umbrales };
  const desde = ahoraMs - u.ventanaMin * 60_000;
  const cuenta = new Map<string, number>();
  for (const f of filas) {
    const t = localAUtc(f.fechaHoraLocal, zona).getTime();
    if (t <= desde || t > ahoraMs) continue;
    const k = llaveEconomico(f.unidad);
    if (k !== '') cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
  }
  const transito = opciones.unidadesEnTransito
    ? [...new Set(opciones.unidadesEnTransito.map(llaveEconomico).filter((k) => k !== ''))]
    : [...cuenta.keys()];
  if (transito.length < u.unidadesMinimas) return { suficiente: false, unidadesEnTransito: transito.length, conPosicionesSuficientes: 0, porcentaje: null, aviso: null };
  const buenas = transito.filter((k) => (cuenta.get(k) ?? 0) >= u.posicionesMinimas).length;
  const porcentaje = Math.round((buenas / transito.length) * 1_000) / 10;
  return { suficiente: true, unidadesEnTransito: transito.length, conPosicionesSuficientes: buenas, porcentaje, aviso: porcentaje < u.porcentajeMinimo ? AVISO_SOLO_EVENTOS : null };
}

export interface ResumenTablaCombinada {
  /** «n posiciones con punto de interés» — el punto de interés se lee y se cuenta, no se guarda. */
  conPuntoInteres: number;
  latencia: LatenciaAgregada;
  continuidad: CalidadContinuidad;
  /** T-A5-37: cadencia observada (recepción vs registro) de la tabla; alimenta `poleoMin` de la configuración del Conductor. */
  cadencia: Record<string, CadenciaObservada>;
  /** Frases para el estado del conector y la pantalla de conexiones (vacío si no hay nada que decir). */
  frases: string[];
}

const minutos = (s: number): string => (s < 90 ? `${s} s` : `${Math.round(s / 60)} min`);

export function resumirTablaCombinada(
  filas: readonly PosicionTablaPropia[], zona: string, ahoraMs: number,
  opciones: { umbrales?: Partial<UmbralesCalidad>; unidadesEnTransito?: readonly string[] } = {},
): ResumenTablaCombinada {
  const conPuntoInteres = filas.filter((f) => f.puntoInteres).length;
  const latencia = latenciaAgregada(filas, zona);
  const continuidad = evaluarContinuidad(filas, zona, ahoraMs, opciones);
  const frases: string[] = [];
  if (conPuntoInteres > 0) frases.push(`${conPuntoInteres} posicion${conPuntoInteres === 1 ? '' : 'es'} con punto de interés.`);
  if (latencia.p95Segundos !== null) frases.push(`Latencia de la fuente (p95): ${minutos(latencia.p95Segundos)}.`);
  if (latencia.recibidoAntesDeMedido > 0) frases.push(`${latencia.recibidoAntesDeMedido} fila(s) traen «recibido» anterior a la medida: revisa la zona horaria declarada.`);
  if (continuidad.aviso) frases.push(continuidad.aviso);
  const cadencia = cadenciaObservada(filas, zona);
  const tabla = cadencia.tabla_propia;
  if (tabla && tabla.recepcionMin !== null) {
    frases.push(`Cadencia de la fuente: recibe cada ~${Math.round(tabla.recepcionMin)} min${tabla.registroMin !== null ? ` (registra cada ~${Math.round(tabla.registroMin)} min)` : ''}.`);
  }
  return { conPuntoInteres, latencia, continuidad, cadencia, frases };
}

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-37 — Cadencia OBSERVADA por proveedor. La telemática del cliente registra cada minuto pero a veces RECIBIMOS cada ~15
// (la otra plataforma, cada ~2): ambas cadencias se miden aquí para que quien configura `poleoMin` parta de un dato y no de un
// supuesto. «Recepción» = minutos entre momentos distintos de llegada (el búfer entregado de golpe es UNA recepción);
// «registro» = minutos entre mediciones consecutivas de la misma unidad. Mediana por unidad y luego mediana entre unidades.
// Puras: no se guarda nada por fila ni por unidad.
// ═══════════════════════════════════════════════════════════════════════════

export interface CadenciaObservada {
  /** Unidades con al menos dos instantes distintos que aportaron a la cifra. */
  unidades: number;
  /** Minutos (mediana) entre recepciones distintas; null si la tabla no trae «recibido» o no hay muestra. */
  recepcionMin: number | null;
  /** Minutos (mediana) entre mediciones consecutivas de una unidad; null si no hay muestra. */
  registroMin: number | null;
}

const mediana = (v: readonly number[]): number | null => {
  if (v.length === 0) return null;
  const o = [...v].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 === 1 ? o[m] : (o[m - 1] + o[m]) / 2;
};

/** Mediana de los saltos positivos entre instantes DISTINTOS (ms) de una lista, en minutos; null si no hay dos instantes distintos. */
function saltoMedianoMin(instantes: readonly number[]): number | null {
  const orden = [...new Set(instantes)].sort((a, b) => a - b);
  const saltos: number[] = [];
  for (let i = 1; i < orden.length; i += 1) saltos.push((orden[i] - orden[i - 1]) / 60_000);
  return mediana(saltos);
}

/**
 * La cadencia observada por clave (por omisión una sola: la tabla entera; quien llama puede dar `claveDe` para separar por
 * proveedor). El resultado alimenta `poleoMin`/`poleoPorClaveMin` de la configuración del Conductor.
 */
export function cadenciaObservada(
  filas: readonly PosicionTablaPropia[], zona: string = ZONA_POR_OMISION,
  claveDe: (f: PosicionTablaPropia) => string = () => 'tabla_propia',
): Record<string, CadenciaObservada> {
  type Acum = { registro: number[]; recepcion: number[] };
  const porClave = new Map<string, Map<string, Acum>>();
  for (const f of filas) {
    const u = llaveEconomico(f.unidad);
    if (u === '') continue;
    const clave = claveDe(f);
    const unidades = porClave.get(clave) ?? new Map<string, Acum>();
    const a = unidades.get(u) ?? { registro: [], recepcion: [] };
    a.registro.push(localAUtc(f.fechaHoraLocal, zona).getTime());
    if (f.fechaRecibidaLocal) a.recepcion.push(localAUtc(f.fechaRecibidaLocal, zona).getTime());
    unidades.set(u, a);
    porClave.set(clave, unidades);
  }
  const salida: Record<string, CadenciaObservada> = {};
  for (const [clave, unidades] of porClave) {
    const reg: number[] = []; const rec: number[] = []; let contadas = 0;
    for (const a of unidades.values()) {
      const r = saltoMedianoMin(a.registro); const c = saltoMedianoMin(a.recepcion);
      if (r !== null) { reg.push(r); contadas += 1; }
      if (c !== null) rec.push(c);
    }
    salida[clave] = { unidades: contadas, recepcionMin: mediana(rec), registroMin: mediana(reg) };
  }
  return salida;
}

/** El `poleoMin` que sugiere una cadencia de recepción observada: entero de 1 a 60; null si no hay dato (no se inventa uno). */
export function poleoSugeridoMin(c: Pick<CadenciaObservada, 'recepcionMin'>): number | null {
  if (c.recepcionMin === null || !Number.isFinite(c.recepcionMin) || c.recepcionMin <= 0) return null;
  return Math.min(60, Math.max(1, Math.round(c.recepcionMin)));
}
