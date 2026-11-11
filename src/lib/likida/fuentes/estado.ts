// ═══════════════════════════════════════════════════════════════════════════
// ESTADO POR FUENTE DE DATOS (F19 «Confianza del dato») — módulo PURO.
//
// Una sola pieza para las tres propuestas de «estado por fuente» (VEXA A4,
// ALTERMA #4, LANDINGS #5): Conexiones del dashboard, la Salud del admin y la
// campana leen ESTA función, no tres copias que se desincronizan.
//
// Cuatro estados que ve la persona (más «sin dato», que NO es un estado de la
// fuente sino de la lectura):
//
//   al_dia        (FASES: `listo`)      llegó algo dentro de su cadencia.
//   atrasada      (FASES: `pendiente`)  pasó 1.5 veces su cadencia sin señal.
//   caida         (FASES: `con_falla`)  pasó 3 veces su cadencia, o la fuente
//                                       reportó una falla y no hay señal buena
//                                       posterior (el umbral de 3x es el de
//                                       VEXA A4, `confianza-modelo.mjs`).
//   sin_conectar  (FASES: `pendiente` de «sin configurar») nada se ha
//                                       conectado: NO es una falla.
//
//   estado === null (FASES: `no_verificable`) = no se pudo leer, o la muestra
//   es demasiado chica para afirmar silencio. NUNCA se pinta como «al día»
//   (regla número uno del repo: lectura caída = «sin dato», jamás un verde).
//
// LA CADENCIA vive aquí, en el código (sin migración). Cada una es un SUPUESTO
// declarado sobre cada cuánto debería hablar la fuente de una flota chica
// (~24 viajes al mes), no una medición: si un cliente real demuestra otra
// cosa, se cambia esta tabla y su prueba, no se afina por flota a mano.
// ═══════════════════════════════════════════════════════════════════════════

export type IdFuente = 'whatsapp' | 'tms' | 'gps' | 'peajes' | 'correo' | 'sat';

export type EstadoFuente = 'al_dia' | 'atrasada' | 'caida' | 'sin_conectar';

export const IDS_FUENTE: readonly IdFuente[] = ['whatsapp', 'tms', 'gps', 'peajes', 'correo', 'sat'];

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

export interface CadenciaFuente {
  /** Cada cuánto debería llegar una señal de esta fuente. */
  esperadaMs: number;
}

// El texto de cada fuente (nombre y qué señal se lee) vive en el diccionario `fuentes`
// (`fuentes.nombre.<id>`, `fuentes.senal.<id>`): este módulo no escribe copy.
export const CADENCIA_FUENTES: Record<IdFuente, CadenciaFuente> = {
  whatsapp: { esperadaMs: DIA_MS }, // último comprobante recibido por WhatsApp
  tms: { esperadaMs: HORA_MS }, // última lectura correcta del sistema de la flota
  gps: { esperadaMs: 15 * 60_000 }, // última posición recibida
  peajes: { esperadaMs: 3 * DIA_MS }, // último archivo de peajes procesado
  correo: { esperadaMs: 7 * DIA_MS }, // último archivo recibido por el buzón de facturas
  sat: { esperadaMs: 7 * DIA_MS }, // última descarga de paquete del SAT
};

/** Pasado este múltiplo de la cadencia sin señal, la fuente está atrasada. */
export const FACTOR_ATRASADA = 1.5;
/** Pasado este múltiplo, está caída (VEXA A4: alerta a 3 veces la cadencia). */
export const FACTOR_CAIDA = 3;
/** Eventos mínimos en 30 días para poder afirmar silencio. Con menos, «sin medir» (volumen bajo, CRITICA-2 O10). */
export const MUESTRA_MINIMA_30D = 3;

export interface EntradaFuente {
  id: IdFuente;
  /** `caida` = la lectura de la base falló: no se sabe nada de la fuente. */
  lectura: 'medida' | 'caida';
  /** ¿La flota (o el sistema) conectó esta fuente? Sin configurar no es una falla. */
  configurada: boolean;
  /** Epoch ms de la última señal BUENA, o `null` si nunca llegó una. */
  ultimaSenalMs: number | null;
  /** Falla que reportó la propia fuente y que no se ha superado con una señal buena; `null` si no hay. */
  falla?: string | null;
  /** Eventos en los últimos 30 días; `undefined`/`null` = no aplica o no se leyó. */
  muestra30d?: number | null;
  /** Cadencia propia (el admin evalúa relojes con la suya); por omisión la de `CADENCIA_FUENTES`. */
  cadenciaMs?: number;
}

export type TonoFuente = 'ok' | 'warn' | 'bad' | 'neutral';

/** Por qué la fuente quedó en ese estado. El diccionario `fuentes` tiene `fuentes.detalle.<motivo>` en es y en. */
export type MotivoFuente =
  | 'lectura_caida' | 'no_configurada' | 'sin_senal' | 'sin_senal_con_falla'
  | 'al_dia' | 'falla_sin_recuperar' | 'muestra_chica' | 'caida_por_silencio' | 'atrasada_por_silencio';

export interface EvaluacionFuente {
  id: IdFuente;
  /** `null` = no verificable («sin dato»). Nunca se interpreta como al día. */
  estado: EstadoFuente | null;
  tono: TonoFuente;
  motivo: MotivoFuente;
  /** Edad de la última señal, o `null` si no hay. */
  haceMs: number | null;
  cadenciaMs: number;
  /** La falla que reportó la propia fuente (dato, tal cual), si aplica. */
  falla: string | null;
  /** Eventos en 30 días, si se leyó. */
  muestra30d: number | null;
  /** `true` solo si hay que hacer algo (atrasada o caída). Sin conectar y sin dato no cuentan. */
  requiereAccion: boolean;
}

const TONO: Record<EstadoFuente, TonoFuente> = { al_dia: 'ok', atrasada: 'warn', caida: 'bad', sin_conectar: 'neutral' };

function evaluacion(
  e: EntradaFuente,
  estado: EstadoFuente | null,
  motivo: MotivoFuente,
  haceMs: number | null,
  cadenciaMs: number,
): EvaluacionFuente {
  return {
    id: e.id,
    estado,
    tono: estado === null ? 'neutral' : TONO[estado],
    motivo,
    haceMs,
    cadenciaMs,
    falla: e.falla ?? null,
    muestra30d: typeof e.muestra30d === 'number' ? e.muestra30d : null,
    requiereAccion: estado === 'atrasada' || estado === 'caida',
  };
}

/**
 * Pura. Juzga una fuente con lo ya leído. El orden de las reglas importa:
 *   1. lectura caída            → sin dato (jamás verde, jamás «sin conectar»).
 *   2. no configurada           → sin conectar (NO es falla).
 *   3. configurada, sin señal   → atrasada (todavía no ha llegado nada); caída si además reportó falla.
 *   4. señal dentro de 1.5x     → al día (una señal reciente es evidencia positiva).
 *   5. falla reportada y sin señal buena posterior → caída si ya pasó una cadencia, atrasada si no.
 *   6. muestra chica            → sin dato (con 24 viajes al mes, un silencio no prueba nada).
 *   7. 1.5x–3x atrasada; >3x caída.
 */
export function evaluarFuente(e: EntradaFuente, ahoraMs: number): EvaluacionFuente {
  const cadenciaMs = e.cadenciaMs ?? CADENCIA_FUENTES[e.id].esperadaMs;

  if (e.lectura === 'caida') return evaluacion(e, null, 'lectura_caida', null, cadenciaMs);
  if (!e.configurada) return evaluacion(e, 'sin_conectar', 'no_configurada', null, cadenciaMs);
  if (e.ultimaSenalMs === null) {
    return e.falla
      ? evaluacion(e, 'caida', 'sin_senal_con_falla', null, cadenciaMs)
      : evaluacion(e, 'atrasada', 'sin_senal', null, cadenciaMs);
  }

  const haceMs = Math.max(0, ahoraMs - e.ultimaSenalMs);
  const factor = haceMs / cadenciaMs;

  if (factor <= FACTOR_ATRASADA && !e.falla) return evaluacion(e, 'al_dia', 'al_dia', haceMs, cadenciaMs);
  if (e.falla) return evaluacion(e, factor > 1 ? 'caida' : 'atrasada', 'falla_sin_recuperar', haceMs, cadenciaMs);
  if (typeof e.muestra30d === 'number' && e.muestra30d < MUESTRA_MINIMA_30D) {
    return evaluacion(e, null, 'muestra_chica', haceMs, cadenciaMs);
  }
  return factor > FACTOR_CAIDA
    ? evaluacion(e, 'caida', 'caida_por_silencio', haceMs, cadenciaMs)
    : evaluacion(e, 'atrasada', 'atrasada_por_silencio', haceMs, cadenciaMs);
}

export function evaluarFuentes(entradas: ReadonlyArray<EntradaFuente>, ahoraMs: number): EvaluacionFuente[] {
  return entradas.map((e) => evaluarFuente(e, ahoraMs));
}

export interface ResumenFuentes {
  total: number;
  /** Conectadas (cualquier estado distinto de sin conectar). */
  conectadas: number;
  alDia: number;
  /** Las que piden acción: atrasadas y caídas. */
  requierenAccion: EvaluacionFuente[];
  /** Sin dato: no se cuentan como al día NI como falla. */
  sinDato: number;
}

/** Pura. Los números del pie del sidebar y de la campana salen de aquí, nunca marcados a mano. */
export function resumirFuentes(evals: ReadonlyArray<EvaluacionFuente>): ResumenFuentes {
  return {
    total: evals.length,
    conectadas: evals.filter((x) => x.estado !== 'sin_conectar').length,
    alDia: evals.filter((x) => x.estado === 'al_dia').length,
    requierenAccion: evals.filter((x) => x.requiereAccion),
    sinDato: evals.filter((x) => x.estado === null).length,
  };
}

/** Cuántas fuentes piden acción: lo que suma a la campana. */
export function contarRequiereAccionFuentes(evals: ReadonlyArray<EvaluacionFuente>): number {
  return resumirFuentes(evals).requierenAccion.length;
}
