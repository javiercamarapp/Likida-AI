// ═══════════════════════════════════════════════════════════════════════════
// LA ESCALERA: a quién se le avisa, cuándo, y cuántas veces.
//
// Dos niveles, con bitácora:
//
//   Nivel 1 — el gerente RESPONSABLE del cliente (o el jefe de la flota si no
//             tiene uno asignado).
//   Nivel 2 — el DUEÑO de la flota (flota_admin).
//
// Qué dispara cada nivel (el más alto que corresponda, una sola vez por ciclo):
//
//   · molestia nivel 2 ........... nivel 1, al instante
//   · molestia nivel 3 (crítica) . nivel 2, al instante
//   · pide_humano / sin dato ..... nivel 1, al instante
//   · espera ≥ SLA ............... nivel 1
//   · espera ≥ SLA + N2 min ...... nivel 2 (aunque el gerente ya «se encargó»: si
//                                  tomó el hilo y el cliente sigue esperando, el
//                                  dueño tiene que saberlo — es la red contra el
//                                  «yo me encargo» que nunca contestó)
//
// IDEMPOTENCIA: cada aviso lleva una CLAVE (`vigia_evento.clave`, única por
// flota). El cron corre cada 5 minutos y mil veces seguidas; solo la primera
// inserción de esa clave avisa. La clave incluye el INICIO del ciclo de espera:
// cuando el cliente es atendido y vuelve a escribir, es un ciclo nuevo y puede
// volver a escalar.
// ═══════════════════════════════════════════════════════════════════════════
import type { Conversacion, ConfigVigia, MotivoEscalamiento } from './tipos';

export interface AccionEscalamiento {
  nivel: 1 | 2;
  motivo: MotivoEscalamiento;
  /** Única por (conversación, ciclo, nivel): el sello anti-repetición. */
  clave: string;
  minutosEsperando: number;
}

export interface EntradaEscalamiento {
  conversacion: Pick<Conversacion,
    'id' | 'estado' | 'control' | 'sinRespuestaDesde' | 'escalamientoNivel' | 'molestiaNivel' | 'molestiaEn' | 'atendidaEn'>;
  config: Pick<ConfigVigia, 'slaRespuestaMin' | 'escalarNivel2Min'> & Partial<Pick<ConfigVigia, 'molestiaAvisoNivel'>>;
  ahoraMs: number;
  /** Alguien pidió un humano o faltó un dato en el mensaje que se acaba de procesar. */
  disparoInmediato?: Extract<MotivoEscalamiento, 'pide_humano' | 'sin_dato' | 'folio_ajeno'> | null;
}

export function minutosEsperando(sinRespuestaDesde: string | null, ahoraMs: number): number {
  if (!sinRespuestaDesde) return 0;
  const t = Date.parse(sinRespuestaDesde);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((ahoraMs - t) / 60_000));
}

function claveDe(id: string, inicio: string | null, nivel: number): string {
  const t = inicio ? Date.parse(inicio) : 0;
  return `${id}:${Number.isNaN(t) ? 0 : t}:n${nivel}`;
}

/**
 * La acción de escalamiento que corresponde AHORA, o `null`. PURA.
 * `escalamientoNivel` es el nivel más alto ya avisado en este ciclo: nunca se
 * baja ni se repite uno ya avisado.
 */
export function evaluarEscalamiento(e: EntradaEscalamiento): AccionEscalamiento | null {
  const c = e.conversacion;
  if (c.estado !== 'activa') return null;

  const espera = minutosEsperando(c.sinRespuestaDesde, e.ahoraMs);
  // El ciclo de la clave: cuando alguien espera, desde cuándo espera; si no
  // espera (molestia/disparo sin espera), desde la molestia.
  const inicio = c.sinRespuestaDesde ?? c.molestiaEn;

  let nivel = 0;
  let motivo: MotivoEscalamiento = 'sin_respuesta';

  if (c.sinRespuestaDesde) {
    if (espera >= e.config.slaRespuestaMin + e.config.escalarNivel2Min) { nivel = 2; motivo = 'sin_respuesta'; }
    else if (espera >= e.config.slaRespuestaMin) { nivel = 1; motivo = 'sin_respuesta'; }
  }
  if (c.molestiaNivel >= 3 && nivel < 2) { nivel = 2; motivo = 'molestia'; }
  else if (c.molestiaNivel >= Math.max(2, e.config.molestiaAvisoNivel ?? 2) && nivel < 1) { nivel = 1; motivo = 'molestia'; }
  if (e.disparoInmediato && nivel < 1) { nivel = 1; motivo = e.disparoInmediato; }

  if (nivel === 0) return null;
  // Nivel 1 lo detiene un humano que ya se hizo cargo; el 2 no (ver encabezado).
  if (nivel === 1 && c.atendidaEn) return null;
  if (nivel <= c.escalamientoNivel) return null;

  return { nivel: nivel as 1 | 2, motivo, clave: claveDe(c.id, inicio, nivel), minutosEsperando: espera };
}

// ═══════════════════════════════════════════════════════════════════════════
// LA COLA DEL BARRIDO: a quién se mira primero.
//
// El barrido mira un número acotado de conversaciones por pasada. Si la lista
// se llenara de hilos que ya no pueden avisar nada (la escalera completa, un
// ciclo muerto), una crítica nueva quedaría detrás de ellos y su alerta de 10
// minutos no saldría nunca: el «bloqueo en cabeza de cola». Por eso:
//
//   · lo que ya llegó al nivel 2 NO entra (no tiene un aviso más que dar);
//   · lo demás se ordena por su PRÓXIMO VENCIMIENTO (lo vencido va antes que lo
//     que aún no toca), no por la antigüedad del cliente: una flota con SLA de
//     24 h no puede tapar a otra con SLA de 10 min.
//
// Un hilo que ya tomó una persona SÍ sigue entrando mientras no llegue al nivel 2:
// el dueño tiene que enterarse si el cliente sigue esperando (ver arriba), y por
// ordenarse por su vencimiento real (SLA + N2) no se interpone a nadie.
// ═══════════════════════════════════════════════════════════════════════════

type ConvParaCola = Pick<Conversacion, 'sinRespuestaDesde' | 'escalamientoNivel' | 'molestiaNivel' | 'atendidaEn' | 'entradasSinRespuesta'>;
type ConfigParaCola = Pick<ConfigVigia, 'slaRespuestaMin' | 'escalarNivel2Min'>;

/**
 * El instante (ms) en que a esta conversación le toca su próximo aviso, o `null` si ya no tiene ninguno que dar. PURA.
 * Una molestia o una insistencia que ya ameritan aviso y aún no se avisó están «vencidas desde que empezó la espera».
 */
export function proximoVencimientoMs(c: ConvParaCola, config: ConfigParaCola): number | null {
  if (c.escalamientoNivel >= 2 || !c.sinRespuestaDesde) return null;
  const inicio = Date.parse(c.sinRespuestaDesde);
  if (Number.isNaN(inicio)) return null;
  const sla = config.slaRespuestaMin * 60_000;
  const n2 = (config.slaRespuestaMin + config.escalarNivel2Min) * 60_000;
  const urgente = c.escalamientoNivel < 1 && !c.atendidaEn && (c.molestiaNivel >= 2 || c.entradasSinRespuesta >= 5);
  if (urgente) return inicio;
  if (c.escalamientoNivel >= 1 || c.atendidaEn) return inicio + n2;
  return inicio + sla;
}

/**
 * De las candidatas, las que se revisan en ESTA pasada: sin las que ya no tienen aviso por dar, las más vencidas primero
 * (empate: la que espera desde antes, luego por id), hasta `limite`. PURA y estable.
 */
export function seleccionarEnEspera<T extends { conversacion: ConvParaCola & { id: string }; config: ConfigParaCola }>(filas: readonly T[], limite: number): T[] {
  return filas
    .map((f) => ({ f, v: proximoVencimientoMs(f.conversacion, f.config) }))
    .filter((x): x is { f: T; v: number } => x.v !== null)
    .sort((a, b) => a.v - b.v
      || Date.parse(a.f.conversacion.sinRespuestaDesde ?? '') - Date.parse(b.f.conversacion.sinRespuestaDesde ?? '')
      || (a.f.conversacion.id < b.f.conversacion.id ? -1 : a.f.conversacion.id > b.f.conversacion.id ? 1 : 0))
    .slice(0, Math.max(0, limite))
    .map((x) => x.f);
}

/** Un hilo cuyo cliente lleva este tiempo sin que nada cambie es un ciclo muerto: se cierra (si el cliente vuelve a escribir, abre uno nuevo). */
export const DIAS_CICLO_INACTIVO = 7;
