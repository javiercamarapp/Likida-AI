import { calcularDetencion, resolverPolitica, type Detencion, type OrigenPolitica, type PoliticaDetencion } from '../estadias/motor';
import { estaResuelto, type HitoFila, type Lugar, type TipoHito } from './tipos';
import type { ResultadoValidacion } from './validacion';

// ═══════════════════════════════════════════════════════════════════════════
// ESTADÍAS EN ANDÉN — cuánto tiempo estuvo la unidad en cada parada. Puro.
//
// El motor de estadías de la 0207 mide la ventana puerta a puerta del VIAJE
// (llegada_en → regreso_en, los tres sellos de la 0090). Aquí se mide por PARADA,
// con los hitos de la 0380:
//
//   carga     = salida_carga     − llegada_carga
//   descarga  = salida_descarga  − llegada_descarga
//
// ── LA HORA ES LA DEL MENSAJE, Y CADA FILA DICE DE DÓNDE SALIÓ ──────────────
// El chofer puede avisar tarde, así que la hora del hito es la de SU MENSAJE
// (Meta), no la del evento físico, y una captura de oficina trae la hora que el
// jefe declaró. El export lo marca (`fuenteLlegada`/`fuenteSalida`), junto con la
// validación contra la ubicación y la evidencia fotográfica: el paquete que la
// flota le enseña a su cliente para cobrar una estadía trae la hora exacta Y con
// qué se sostiene, no solo un número.
//
// ── EL DINERO ES UNA PROPUESTA, Y FAIL-CLOSED ───────────────────────────────
// Reusa `calcularDetencion` de la 0207: sin horas libres pactadas no hay
// «excedido», sin tarifa no hay monto, dentro de las horas libres no hay cobro.
// SUPUESTO declarado: las horas libres del pacto se aplican POR PARADA. El agente
// prepara el renglón; el contralor decide y factura (jamás se emite un CFDI aquí).
// ═══════════════════════════════════════════════════════════════════════════

export type FaseEstancia =
  /** Llegó y no ha avisado la salida, con el viaje vivo: el reloj CORRE. */
  | 'en_curso'
  /** Llegada y salida registradas. */
  | 'cerrada'
  /** El viaje terminó sin salida registrada: la duración no es medible y no se inventa. */
  | 'sin_salida'
  /** La salida es anterior a la llegada (un hito capturado mal): se dice, no se calculan minutos negativos. */
  | 'incoherente'
  /** Hay salida pero la llegada se omitió o nunca se avisó: no hay desde cuándo medir. */
  | 'sin_llegada';

export interface PuntoEstancia {
  hitoId: string;
  /** La hora del hito (la del mensaje, o la capturada por oficina). */
  en: string;
  /** Cuándo la recibió Likida. */
  recibidoEn: string | null;
  fuente: 'chofer' | 'oficina' | 'sistema';
  validacion: ResultadoValidacion | null;
  evidencias: number;
}

export interface Estancia {
  viajeId: string;
  lugar: Lugar;
  fase: FaseEstancia;
  llegada: PuntoEstancia | null;
  salida: PuntoEstancia | null;
  /** Minutos en el andén: cerrados (llegada→salida) o corriendo (llegada→ahora). null cuando no son medibles. */
  minutos: number | null;
}

const TIPOS: Record<Lugar, { llegada: TipoHito; salida: TipoHito }> = {
  carga: { llegada: 'llegada_carga', salida: 'salida_carga' },
  descarga: { llegada: 'llegada_descarga', salida: 'salida_descarga' },
};

export interface ContextoEstancias {
  /** Veredicto vigente por hito (el del ciclo actual). */
  validaciones: ReadonlyMap<string, ResultadoValidacion>;
  /** Cuántas evidencias vivas (con archivo) tiene cada hito en su ciclo actual. */
  evidencias: ReadonlyMap<string, number>;
}

const VIVOS: ReadonlySet<string> = new Set(['abierto', 'en_cuadre']);

function punto(h: HitoFila, ctx: ContextoEstancias): PuntoEstancia | null {
  if (!estaResuelto(h)) return null;
  const en = h.mensajeEn ?? h.recibidoEn;
  if (!en) return null;
  return {
    hitoId: h.id, en, recibidoEn: h.recibidoEn,
    fuente: h.fuente === 'oficina' ? 'oficina' : h.fuente === 'sistema' ? 'sistema' : 'chofer',
    validacion: ctx.validaciones.get(h.id) ?? (h.estado === 'validado' ? 'validado' : null),
    evidencias: ctx.evidencias.get(h.id) ?? 0,
  };
}

/** Las dos estancias (carga y descarga) de un viaje a partir de sus hitos. Una parada sin ningún hito no produce fila. */
export function calcularEstancias(
  viaje: { id: string; estatus: string }, hitos: readonly HitoFila[], ahora: Date, ctx: ContextoEstancias,
): Estancia[] {
  const salida: Estancia[] = [];
  for (const lugar of ['carga', 'descarga'] as const) {
    const hl = hitos.find((h) => h.tipo === TIPOS[lugar].llegada);
    const hs = hitos.find((h) => h.tipo === TIPOS[lugar].salida);
    const llegada = hl ? punto(hl, ctx) : null;
    const salidaP = hs ? punto(hs, ctx) : null;
    if (!llegada && !salidaP) continue;

    const base = { viajeId: viaje.id, lugar, llegada, salida: salidaP };
    if (!llegada) { salida.push({ ...base, fase: 'sin_llegada', minutos: null }); continue; }
    const tl = Date.parse(llegada.en);
    if (Number.isNaN(tl)) { salida.push({ ...base, fase: 'sin_salida', minutos: null }); continue; }
    if (salidaP) {
      const ts = Date.parse(salidaP.en);
      if (Number.isNaN(ts)) { salida.push({ ...base, fase: 'sin_salida', minutos: null }); continue; }
      if (ts < tl) { salida.push({ ...base, fase: 'incoherente', minutos: null }); continue; }
      salida.push({ ...base, fase: 'cerrada', minutos: Math.floor((ts - tl) / 60_000) });
      continue;
    }
    if (VIVOS.has(viaje.estatus)) {
      // Una llegada «en el futuro» (reloj movido) corre en cero, no en negativo.
      salida.push({ ...base, fase: 'en_curso', minutos: Math.max(0, Math.floor((ahora.getTime() - tl) / 60_000)) });
    } else {
      salida.push({ ...base, fase: 'sin_salida', minutos: null });
    }
  }
  return salida;
}

// ── Alertas por exceso ──────────────────────────────────────────────────────

export interface UmbralesEstadia {
  estadiaAlertaCargaMin: number | null;
  estadiaAlertaDescargaMin: number | null;
}

export const umbralDe = (c: UmbralesEstadia, lugar: Lugar): number | null =>
  lugar === 'carga' ? c.estadiaAlertaCargaMin : c.estadiaAlertaDescargaMin;

/** ¿Esta estancia EN CURSO ya rebasó el umbral configurado? Solo cuenta lo que sigue corriendo. */
export function excedeUmbral(e: Estancia, c: UmbralesEstadia): boolean {
  const umbral = umbralDe(c, e.lugar);
  return umbral !== null && e.fase === 'en_curso' && e.minutos !== null && e.minutos >= umbral;
}

// ── Valorar y exportar ──────────────────────────────────────────────────────

export interface ViajeParaCobro {
  id: string;
  folio: string | null;
  estatus: string;
  operadorNombre: string | null;
  clienteId: string | null;
  clienteNombre: string | null;
  terminalNombre: string | null;
  origenSitio: string | null;
  destinoSitio: string | null;
  origen: string | null;
  destino: string | null;
}

export interface FilaEstadia {
  viaje: ViajeParaCobro;
  estancia: Estancia;
  origenPolitica: OrigenPolitica;
  detencion: Detencion;
  sitio: string | null;
}

/** Valora cada estancia con el pacto de detención del cliente (gana) o el de la flota. */
export function valorarEstancias(
  viaje: ViajeParaCobro, estancias: readonly Estancia[],
  politicas: { porCliente: ReadonlyMap<string, PoliticaDetencion>; flota: PoliticaDetencion | null },
): FilaEstadia[] {
  const { politica, origen } = resolverPolitica(viaje.clienteId, politicas.porCliente, politicas.flota);
  return estancias.map((estancia) => ({
    viaje, estancia, origenPolitica: origen,
    // Una estancia que sigue corriendo se VALORA con los minutos de hoy, pero el export la rotula `en_curso`: no es cobrable aún.
    detencion: calcularDetencion(estancia.minutos, politica),
    sitio: (estancia.lugar === 'carga' ? viaje.origenSitio : viaje.destinoSitio) ?? (estancia.lugar === 'carga' ? viaje.origen : viaje.destino),
  }));
}

export interface ResumenEstadias {
  paradas: number;
  cerradas: number;
  enCurso: number;
  minutosCerradas: number;
  /** Suma de minutos EXCEDENTES de las paradas cerradas con pacto. null = ninguna tenía pacto. */
  minutosExcedentes: number | null;
  /** Suma propuesta (solo cerradas, solo con pacto y tarifa) por moneda: nunca se mezclan monedas. */
  montoPropuesto: Record<string, number>;
  sinPacto: number;
}

export function resumirEstadias(filas: readonly FilaEstadia[]): ResumenEstadias {
  const r: ResumenEstadias = { paradas: filas.length, cerradas: 0, enCurso: 0, minutosCerradas: 0, minutosExcedentes: null, montoPropuesto: {}, sinPacto: 0 };
  for (const f of filas) {
    if (f.estancia.fase === 'en_curso') r.enCurso++;
    if (f.estancia.fase !== 'cerrada') continue;
    r.cerradas++;
    r.minutosCerradas += f.estancia.minutos ?? 0;
    if (f.detencion.motivoSinMonto === 'sin_horas_libres_pactadas') r.sinPacto++;
    if (f.detencion.minutosExcedentes !== null) r.minutosExcedentes = (r.minutosExcedentes ?? 0) + f.detencion.minutosExcedentes;
    if (f.detencion.monto !== null && f.detencion.moneda) {
      r.montoPropuesto[f.detencion.moneda] = Math.round(((r.montoPropuesto[f.detencion.moneda] ?? 0) + f.detencion.monto) * 100) / 100;
    }
  }
  return r;
}

const FASE_TEXTO: Record<FaseEstancia, string> = {
  en_curso: 'en curso (no cobrable aún)', cerrada: 'cerrada', sin_salida: 'sin salida registrada', incoherente: 'horas incoherentes', sin_llegada: 'sin llegada registrada',
};
const FUENTE_TEXTO = { chofer: 'mensaje del chofer', oficina: 'captura de oficina', sistema: 'sistema' } as const;
const MOTIVO_TEXTO: Record<string, string> = {
  sin_minutos: 'sin minutos medibles', sin_horas_libres_pactadas: 'sin horas libres pactadas', dentro_de_horas_libres: 'dentro de las horas libres', sin_tarifa_pactada: 'sin tarifa pactada',
};

export const COLUMNAS_CSV_ESTADIAS = [
  'folio', 'viaje_id', 'chofer', 'cliente', 'patio', 'parada', 'sitio', 'estado',
  'llegada_hora_mx', 'llegada_fuente', 'llegada_validacion', 'llegada_evidencias',
  'salida_hora_mx', 'salida_fuente', 'salida_evidencias',
  'minutos_en_anden', 'horas_libres_pactadas', 'minutos_excedentes', 'horas_cobrables', 'monto_propuesto', 'moneda', 'motivo_sin_monto', 'pacto_aplicado',
] as const;

/** La hora de México legible y exacta (con segundos): es la que el cliente va a cruzar contra su caseta. */
export function horaExactaMx(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}:${g('second')}`;
}

/** Neutraliza la inyección de fórmulas de hoja de cálculo (=, +, -, @, tab, CR al inicio) y escapa para CSV. */
export function celdaCsv(v: string | number | null): string {
  if (v === null || v === undefined) return '';
  let t = String(v);
  if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const VALIDACION_TEXTO: Record<ResultadoValidacion, string> = { validado: 'validada', sin_coincidencia: 'sin coincidencia', sin_dato: 'sin dato' };

/** El CSV para cobro de estadías. UTF-8 con BOM para que Excel lea los acentos. */
export function csvEstadias(filas: readonly FilaEstadia[]): string {
  const lineas = [COLUMNAS_CSV_ESTADIAS.join(',')];
  for (const f of filas) {
    const { estancia: e, viaje: v, detencion: d } = f;
    const valores: Array<string | number | null> = [
      v.folio, v.id, v.operadorNombre, v.clienteNombre, v.terminalNombre, e.lugar, f.sitio, FASE_TEXTO[e.fase],
      horaExactaMx(e.llegada?.en ?? null), e.llegada ? FUENTE_TEXTO[e.llegada.fuente] : null,
      e.llegada?.validacion ? VALIDACION_TEXTO[e.llegada.validacion] : e.llegada ? 'sin veredicto' : null, e.llegada?.evidencias ?? null,
      horaExactaMx(e.salida?.en ?? null), e.salida ? FUENTE_TEXTO[e.salida.fuente] : null, e.salida?.evidencias ?? null,
      e.minutos, d.horasLibres, d.minutosExcedentes, d.horasCobrables,
      // Una parada que sigue corriendo no es un cobro: el monto queda en blanco hasta que cierre.
      e.fase === 'cerrada' ? d.monto : null, e.fase === 'cerrada' ? d.moneda : null,
      e.fase === 'cerrada' ? (d.motivoSinMonto ? MOTIVO_TEXTO[d.motivoSinMonto] ?? d.motivoSinMonto : null) : null,
      f.origenPolitica === 'cliente' ? 'pacto del cliente' : f.origenPolitica === 'flota' ? 'pacto de la flota' : 'sin pacto',
    ];
    lineas.push(valores.map(celdaCsv).join(','));
  }
  return `﻿${lineas.join('\r\n')}\r\n`;
}
