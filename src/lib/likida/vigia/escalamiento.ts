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
//   · sin dato de UNIDAD/CAJA .... primero a la lista de SERVICIO AL CLIENTE (T-A4-27, 41dfb197 00:00, en privado, sin tocar los
//                                  niveles); solo si esa lista está vacía, no se entrega, o no contesta en `escalarNivel2Min`
//                                  (nadie toca «Yo me encargo»), sube al nivel 1 como siempre
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
    'id' | 'estado' | 'control' | 'sinRespuestaDesde' | 'escalamientoNivel' | 'molestiaNivel' | 'molestiaEn' | 'atendidaEn'>
    // T-A4-27: con el nivel en 0, `escaladoEn` marca CUÁNDO se avisó a servicio al cliente (el reloj de su plazo).
    & Partial<Pick<Conversacion, 'escaladoEn'>>;
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

// ── T-A4-27: «sin dato / sin caja» va primero a servicio al cliente ─────────────────────────────────────

/** Lo que el Vigía pide al estatus cuando preguntan por la unidad: si falta alguno de estos, es un «sin dato de unidad». */
export const FALTANTES_DE_UNIDAD: readonly string[] = ['caja', 'unidad', 'operador'];

/** ¿Algo de lo que falta es de la unidad (caja, unidad u operador)? Otros faltantes (hora estimada…) siguen la escalera de siempre. */
export function esSinDatoDeUnidad(faltantes: readonly string[]): boolean {
  return faltantes.some((f) => FALTANTES_DE_UNIDAD.includes(f));
}

/** Los faltantes de unidad de un estatus (lo que el Vigía diría «no tengo registrado»), en el orden en que se piden. */
export function faltantesDeUnidad(est: { caja?: string | null; unidad?: string | null; operador?: string | null }): string[] {
  return [est.caja ? null : 'caja', est.unidad ? null : 'unidad', est.operador ? null : 'operador'].filter((x): x is string => x !== null);
}

/**
 * ¿A dónde va este disparo inmediato? SOLO el `sin_dato` de unidad/caja con una lista de servicio al cliente que tenga a alguien va
 * a `servicio`; todo lo demás (molestia, sin_respuesta, pide_humano, folio_ajeno, sin_dato de otra cosa, lista vacía) va a la
 * `escalera` exactamente como antes. PURA.
 */
export function destinoDelDisparo(e: { disparo: MotivoEscalamiento | null; faltantes: readonly string[]; hayListaServicio: boolean }): 'servicio' | 'escalera' {
  return e.disparo === 'sin_dato' && esSinDatoDeUnidad(e.faltantes) && e.hayListaServicio ? 'servicio' : 'escalera';
}

/** La llave del aviso a servicio al cliente: la del ciclo de espera con sufijo propio, que no choca con `:n1`/`:n2`. */
export function claveServicio(id: string, inicio: string | null): string {
  const t = inicio ? Date.parse(inicio) : 0;
  return `${id}:${Number.isNaN(t) ? 0 : t}:srv`;
}

/**
 * Servicio al cliente fue avisado (nivel 0 con `escaladoEn`: el único camino que lo deja así) y pasó `escalarNivel2Min` sin que
 * nadie contestara (contestar vacía `sinRespuestaDesde`; «Yo me encargo» pone `atendidaEn`). PURA.
 */
export function servicioSinContestar(
  c: Pick<Conversacion, 'sinRespuestaDesde' | 'escalamientoNivel' | 'atendidaEn'> & Partial<Pick<Conversacion, 'escaladoEn'>>, plazoMin: number, ahoraMs: number,
): boolean {
  if (c.escalamientoNivel !== 0 || !c.escaladoEn || !c.sinRespuestaDesde || c.atendidaEn) return false;
  const desde = Date.parse(c.escaladoEn);
  // El aviso a servicio tiene que ser de ESTE ciclo de espera: uno anterior (de antes de que contestaran) no cuenta.
  return !Number.isNaN(desde) && desde >= Date.parse(c.sinRespuestaDesde) && ahoraMs - desde >= plazoMin * 60_000;
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
  // T-A4-27: servicio al cliente fue avisado (nivel en 0, `escaladoEn` puesto) y nadie se hizo cargo en el plazo: sube al nivel 1.
  if (nivel < 1 && servicioSinContestar(c, e.config.escalarNivel2Min, e.ahoraMs)) { nivel = 1; motivo = 'sin_dato'; }

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

type ConvParaCola = Pick<Conversacion, 'sinRespuestaDesde' | 'escalamientoNivel' | 'molestiaNivel' | 'atendidaEn' | 'entradasSinRespuesta'> & Partial<Pick<Conversacion, 'escaladoEn'>>;
type ConfigParaCola = Pick<ConfigVigia, 'slaRespuestaMin' | 'escalarNivel2Min'> & Partial<Pick<ConfigVigia, 'molestiaAvisoNivel'>>;

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
  // «Urgente» es exactamente lo que `evaluarEscalamiento` convertiría en acción YA, ni más ni menos (R09-2): molestia 3 sube al
  // nivel 2 aunque haya un nivel 1 o una persona; molestia desde el umbral de la flota (mínimo 2) sube al 1 si nadie lo avisó ni lo tomó.
  // Las entradas sin respuesta NO cuentan: `evaluarEscalamiento` no las mira, y un hilo «urgente» que no genera acción se quedaría
  // en la cabeza de la cola sin avisar nada (bloqueo en cabeza).
  const umbralMolestia = Math.max(2, config.molestiaAvisoNivel ?? 2);
  const urgente = c.molestiaNivel >= 3 || (c.escalamientoNivel < 1 && !c.atendidaEn && c.molestiaNivel >= umbralMolestia);
  if (urgente) return inicio;
  // T-A4-27: con servicio al cliente ya avisado, el plazo corto (el suyo) puede vencer antes que el SLA.
  if (c.escalamientoNivel === 0 && !c.atendidaEn && c.escaladoEn) {
    const desde = Date.parse(c.escaladoEn);
    if (!Number.isNaN(desde) && desde >= inicio) return Math.min(inicio + sla, desde + config.escalarNivel2Min * 60_000);
  }
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
