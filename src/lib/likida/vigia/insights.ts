// ═══════════════════════════════════════════════════════════════════════════
// INSIGHTS DEL VIGÍA (T-A4-41): horas ahorradas, avisos a tiempo, primera respuesta y mensajes priorizados.
//
// Todo son funciones PURAS sobre filas ya leídas de `vigia_aviso`, `vigia_evento` y `vigia_conversacion` (sin base, sin reloj, sin
// red). Reglas del cliente (cross-check, F4): «todo número con fuente» y «qué pasó · qué significa · qué hacer».
//
// GUARDIAS
//   · NO hay línea base real de minutos por aviso (pendiente B13: hoy solo «~4 h/día para la mayoría del equipo», sin desglose). Por eso
//     el ahorro se muestra SIEMPRE como un SUPUESTO rotulado y configurable, y NUNCA como porcentaje de ahorro.
//   · Sin datos no se inventa un cero: cada tarjeta dice «Aún no hay …».
//   · Ningún texto de mensaje ni teléfono entra aquí: solo fechas, estados, ids y niveles de prioridad.
// ═══════════════════════════════════════════════════════════════════════════

/** Supuesto de partida mientras no exista la línea base real (B13). Es un valor de ejemplo editable, NO una medición. */
export const MINUTOS_POR_AVISO_SUPUESTO = 5;

export interface AvisoInsight {
  estado: string;
  /** Cuándo salió el aviso (ISO); null si no ha salido. */
  enviadoEn: string | null;
  /** Hora de la cita del viaje (ISO); null si el programa no la traía. */
  citaEn: string | null;
}

export interface MensajeInsight {
  clienteId: string;
  /** Cuándo llegó el mensaje del cliente (ISO). */
  entranteEn: string;
  /** Cuándo se le contestó o atendió por primera vez (ISO); null = sigue sin atender. */
  atendidoEn: string | null;
  /** 0 ignorar · 1 normal · 2 alta (migración 0798). Ausente = 1. */
  prioridad?: number;
}

export interface ConfigInsights {
  /** Minutos que se supone que costaba mandar a mano un aviso (supuesto configurable). */
  minutosPorAviso: number;
  /** N: el aviso es «a tiempo» si salió a más tardar N horas antes de la cita. */
  horasAntesCita: number;
  /** Minutos dentro de los cuales un mensaje de prioridad alta debe atenderse. */
  umbralAtencionMin: number;
}

export const CONFIG_INSIGHTS_BASE: ConfigInsights = { minutosPorAviso: MINUTOS_POR_AVISO_SUPUESTO, horasAntesCita: 2, umbralAtencionMin: 30 };

export interface InsightsEntrada {
  avisos: readonly AvisoInsight[];
  mensajes: readonly MensajeInsight[];
  config?: Partial<ConfigInsights>;
}

const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/** Avisos que de verdad salieron (estado `enviado` con fecha válida). */
export function avisosEnviados(avisos: readonly AvisoInsight[]): number {
  return avisos.filter((a) => a.estado === 'enviado' && ms(a.enviadoEn) !== null).length;
}

export interface ATiempo { conCita: number; aTiempo: number; porcentaje: number | null }

/**
 * Avisos enviados ≤ cita − N h. Solo cuentan los enviados con cita conocida; sin ninguno el porcentaje es `null` (no 0 %).
 */
export function porcentajeATiempo(avisos: readonly AvisoInsight[], horasAntesCita: number): ATiempo {
  let conCita = 0;
  let aTiempo = 0;
  for (const a of avisos) {
    const env = a.estado === 'enviado' ? ms(a.enviadoEn) : null;
    const cita = ms(a.citaEn);
    if (env === null || cita === null) continue;
    conCita += 1;
    if (env <= cita - horasAntesCita * 3_600_000) aTiempo += 1;
  }
  return { conCita, aTiempo, porcentaje: conCita === 0 ? null : Math.round((aTiempo / conCita) * 1000) / 10 };
}

export interface Ahorro { minutos: number; supuesto: string }

/** Minutos «ahorrados» = avisos × minutos por aviso, SIEMPRE con el rótulo del supuesto. Nunca un porcentaje. */
export function minutosAhorrados(avisos: number, minutosPorAviso: number): Ahorro {
  const m = Number.isFinite(minutosPorAviso) && minutosPorAviso >= 0 ? minutosPorAviso : 0;
  return { minutos: Math.round(avisos * m), supuesto: `supuesto: ${m} min por aviso (configurable)` };
}

/** Percentil por rango más cercano sobre una lista ya ordenada; `null` si está vacía. */
function percentil(orden: readonly number[], p: number): number | null {
  if (orden.length === 0) return null;
  return orden[Math.min(orden.length - 1, Math.max(0, Math.ceil(p * orden.length) - 1))];
}

export interface RespuestaCliente { clienteId: string; muestra: number; medianaMin: number; p90Min: number }

/** Mediana y p90 (minutos) de la primera respuesta por cliente; solo mensajes ya atendidos. Ordenado por mediana descendente. */
function tiemposPorCliente(mensajes: readonly MensajeInsight[]): Map<string, number[]> {
  const por = new Map<string, number[]>();
  for (const m of mensajes) {
    const e = ms(m.entranteEn);
    const a = ms(m.atendidoEn);
    if (e === null || a === null || a < e) continue;
    (por.get(m.clienteId) ?? por.set(m.clienteId, []).get(m.clienteId)!).push((a - e) / 60_000);
  }
  return por;
}

const mediana = (o: readonly number[]): number => (o.length % 2 ? o[o.length >> 1] : (o[(o.length >> 1) - 1] + o[o.length >> 1]) / 2);

/** Mediana y muestra de TODAS las primeras respuestas juntas (no mediana de medianas); `null` sin datos. */
export function primeraRespuestaGlobal(mensajes: readonly MensajeInsight[]): { muestra: number; medianaMin: number; p90Min: number } | null {
  const o = [...tiemposPorCliente(mensajes).values()].flat().sort((x, y) => x - y);
  return o.length === 0 ? null : { muestra: o.length, medianaMin: Math.round(mediana(o)), p90Min: Math.round(percentil(o, 0.9) ?? 0) };
}

export function primeraRespuesta(mensajes: readonly MensajeInsight[]): RespuestaCliente[] {
  const fuera: RespuestaCliente[] = [];
  for (const [clienteId, v] of tiemposPorCliente(mensajes)) {
    const o = [...v].sort((x, y) => x - y);
    fuera.push({ clienteId, muestra: o.length, medianaMin: Math.round(mediana(o)), p90Min: Math.round(percentil(o, 0.9) ?? 0) });
  }
  return fuera.sort((x, y) => y.medianaMin - x.medianaMin || (x.clienteId < y.clienteId ? -1 : 1));
}

export interface Priorizados {
  total: number;
  altas: number;
  normales: number;
  ignorables: number;
  /** Altas atendidas dentro del umbral. */
  altasATiempo: number;
  /** Altas que siguen sin atender o se atendieron tarde. */
  altasPendientes: number;
  porcentajeAltasATiempo: number | null;
}

/** Cuántos mensajes son de prioridad alta/normal/ignorable y cuántos de los altos se atendieron antes del umbral. */
export function mensajesPriorizados(mensajes: readonly MensajeInsight[], umbralMin: number): Priorizados {
  let altas = 0, normales = 0, ignorables = 0, altasATiempo = 0;
  for (const m of mensajes) {
    const p = m.prioridad ?? 1;
    if (p <= 0) { ignorables += 1; continue; }
    if (p === 1) { normales += 1; continue; }
    altas += 1;
    const e = ms(m.entranteEn);
    const a = ms(m.atendidoEn);
    if (e !== null && a !== null && a >= e && (a - e) / 60_000 <= umbralMin) altasATiempo += 1;
  }
  return {
    total: mensajes.length, altas, normales, ignorables, altasATiempo, altasPendientes: altas - altasATiempo,
    porcentajeAltasATiempo: altas === 0 ? null : Math.round((altasATiempo / altas) * 1000) / 10,
  };
}

export interface TarjetaInsight {
  id: 'horas_ahorradas' | 'avisos_a_tiempo' | 'primera_respuesta' | 'mensajes_priorizados';
  titulo: string;
  /** Lo que se ve grande; «—» si aún no hay datos. */
  valor: string;
  quePaso: string;
  queSignifica: string;
  queHacer: string;
  /** De dónde sale el número (tabla/columna). Obligatoria en toda tarjeta. */
  fuente: string;
  /** Rótulo cuando el número depende de un supuesto o de reglas aún sin validar con datos reales. */
  rotulo: string | null;
  sinDatos: boolean;
}

const horas = (min: number) => (min >= 60 ? `${Math.round((min / 60) * 10) / 10} h` : `${min} min`);

/** Arma las cuatro tarjetas «qué pasó · qué significa · qué hacer». PURA. */
export function tarjetasInsights(entrada: InsightsEntrada): TarjetaInsight[] {
  const cfg: ConfigInsights = { ...CONFIG_INSIGHTS_BASE, ...entrada.config };
  const n = avisosEnviados(entrada.avisos);
  const t = porcentajeATiempo(entrada.avisos, cfg.horasAntesCita);
  const ah = minutosAhorrados(n, cfg.minutosPorAviso);
  const resp = primeraRespuesta(entrada.mensajes);
  const pr = mensajesPriorizados(entrada.mensajes, cfg.umbralAtencionMin);
  const glob = primeraRespuestaGlobal(entrada.mensajes);

  const tarjetas: TarjetaInsight[] = [];

  tarjetas.push(n === 0
    ? {
      id: 'horas_ahorradas', titulo: 'Tiempo que ya no se gasta mandando datos del viaje', valor: '—', sinDatos: true,
      quePaso: 'Aún no hay avisos enviados.', queSignifica: 'Todavía no hay nada que contar: el ahorro se calcula sobre avisos que sí salieron.',
      queHacer: 'Enciende el aviso de viaje en «Configuración» y confirma los primeros avisos en la bandeja.',
      fuente: 'vigia_aviso (estado = enviado)', rotulo: ah.supuesto,
    }
    : {
      id: 'horas_ahorradas', titulo: 'Tiempo que ya no se gasta mandando datos del viaje', valor: horas(ah.minutos), sinDatos: false,
      quePaso: `Se enviaron ${n} aviso${n === 1 ? '' : 's'} de viaje desde el sistema.`,
      queSignifica: `Si cada uno se mandaba a mano en ${cfg.minutosPorAviso} min, son ${horas(ah.minutos)}. Es una estimación, no una medición.`,
      queHacer: 'Mide con tu equipo cuánto tarda de verdad un aviso a mano y corrige el supuesto para que el número sea el tuyo.',
      fuente: 'vigia_aviso (estado = enviado) × minutos por aviso configurado', rotulo: ah.supuesto,
    });

  tarjetas.push(t.conCita === 0
    ? {
      id: 'avisos_a_tiempo', titulo: 'Avisos enviados a tiempo', valor: '—', sinDatos: true,
      quePaso: n === 0 ? 'Aún no hay avisos enviados.' : 'Hay avisos enviados pero ninguno con hora de cita conocida.',
      queSignifica: 'Sin la hora de la cita no se puede saber si el aviso llegó a tiempo.',
      queHacer: 'Verifica que el programa de despacho traiga la hora de la cita de cada viaje.',
      fuente: 'vigia_aviso.enviado_en y la cita de programa_despacho_fila', rotulo: null,
    }
    : {
      id: 'avisos_a_tiempo', titulo: 'Avisos enviados a tiempo', valor: `${t.porcentaje}%`, sinDatos: false,
      quePaso: `${t.aTiempo} de ${t.conCita} avisos salieron al menos ${cfg.horasAntesCita} h antes de la cita.`,
      queSignifica: t.aTiempo === t.conCita ? 'Todos los avisos con cita conocida salieron a tiempo.' : `${t.conCita - t.aTiempo} avisos salieron tarde respecto a la regla de ${cfg.horasAntesCita} h.`,
      queHacer: t.aTiempo === t.conCita ? 'Mantén la regla y revisa solo los cambios de última hora.' : 'Revisa en la bandeja por qué esperaron: datos incompletos o falta de confirmación.',
      fuente: 'vigia_aviso.enviado_en frente a la cita de programa_despacho_fila', rotulo: null,
    });

  tarjetas.push(glob === null
    ? {
      id: 'primera_respuesta', titulo: 'Primera respuesta al cliente', valor: '—', sinDatos: true,
      quePaso: 'Aún no hay mensajes de clientes atendidos.', queSignifica: 'No hay con qué medir cuánto tarda la primera respuesta.',
      queHacer: 'Cuando entren mensajes de clientes, aquí verás la mediana y el p90 por cliente.',
      fuente: 'vigia_evento (entrante y primera atención) por conversación', rotulo: null,
    }
    : (() => {
      const peor = resp[0];
      const med = glob.medianaMin;
      return {
        id: 'primera_respuesta' as const, titulo: 'Primera respuesta al cliente', valor: duracionCorta(med), sinDatos: false,
        quePaso: `Mediana de ${duracionCorta(med)} y p90 de ${duracionCorta(glob.p90Min)} sobre ${glob.muestra} mensaje${glob.muestra === 1 ? '' : 's'} de ${resp.length} cliente${resp.length === 1 ? '' : 's'}; el más lento tiene mediana ${duracionCorta(peor.medianaMin)} y p90 ${duracionCorta(peor.p90Min)}.`,
        queSignifica: 'La mitad de las primeras respuestas tarda menos que la mediana; el p90 muestra los casos lentos.',
        queHacer: peor.medianaMin > cfg.umbralAtencionMin ? 'Revisa al cliente más lento: puede faltar un contacto de guardia en su horario.' : 'Sigue vigilando el p90 de cada cliente.',
        fuente: 'vigia_evento (entrante y primera atención) por conversación', rotulo: null,
      };
    })());

  tarjetas.push(pr.total === 0
    ? {
      id: 'mensajes_priorizados', titulo: 'Mensajes priorizados', valor: '—', sinDatos: true,
      quePaso: 'Aún no hay mensajes de clientes.', queSignifica: 'No hay mensajes que ordenar por prioridad.',
      queHacer: 'Nada por ahora.', fuente: 'vigia_conversacion.prioridad y vigia_evento', rotulo: 'prioridad por reglas, validada solo con mensajes sintéticos',
    }
    : {
      id: 'mensajes_priorizados', titulo: 'Mensajes priorizados', valor: `${pr.altas} alta${pr.altas === 1 ? '' : 's'}`, sinDatos: false,
      quePaso: `De ${pr.total} mensajes: ${pr.altas} de prioridad alta, ${pr.normales} normales y ${pr.ignorables} que no piden respuesta.`,
      queSignifica: pr.altas === 0 ? 'Nada urgente por ahora.' : `${pr.altasATiempo} de ${pr.altas} urgentes se atendieron en ${cfg.umbralAtencionMin} min o menos.`,
      queHacer: pr.altasPendientes > 0 ? `Atiende primero los ${pr.altasPendientes} urgentes sin atender o tardados.` : 'Sin urgentes pendientes.',
      fuente: 'vigia_conversacion.prioridad y vigia_evento', rotulo: 'prioridad por reglas, validada solo con mensajes sintéticos',
    });

  return tarjetas;
}

function duracionCorta(min: number): string {
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
}
