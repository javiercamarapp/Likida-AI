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
  return { conPuntoInteres, latencia, continuidad, frases };
}
