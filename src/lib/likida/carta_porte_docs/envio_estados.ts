// ═══════════════════════════════════════════════════════════════════════════
// MÁQUINA DE ESTADOS DEL ENVÍO AL TMS (T-A3-26) — función PURA, sin base ni red.
//
// Qué resuelve (33c4d51b 32:46 y 34:42): si el requerimiento no existe todavía, el
// envío NO se pierde: queda `pendiente_reque`, se vuelve a revisar cada
// `frecuenciaMin` (dentro de la ventana horaria, si la hay) hasta `reintentosMax`
// reintentos, se avisa a la oficina UNA sola vez y se deja visible.
//
//   pendiente_prechequeo → listo | pendiente_reque | descartado (revisar: el documento
//                          vuelve a «por_revisar» con motivo)
//   pendiente_reque      → listo (apareció el reque) | pendiente_reque (+1 intento)
//                          | pendiente_reque AGOTADO (alerta única, sin más revisiones)
//   listo → enviando → enviado | rechazado_tms | error_transitorio
//   error_transitorio    → enviando (reintento con backoff 1/2/4/8/8 × frecuencia,
//                          máx. 5) | AGOTADO (alerta única)
//   enviado, rechazado_tms, descartado, subido_a_mano: terminales. Un rechazo solo se
//   resuelve cuando una persona corrige y reaprueba: eso crea un envío NUEVO (llave nueva).
//
// `intentos` es un contador POR FASE: cuenta los prechequeos fallidos en
// `pendiente_reque` y los fallos transitorios en `error_transitorio`; se reinicia al
// entrar a `listo`. Con `reintentosMax = 6` el 1.er prechequeo fallido es el intento 1
// y el 7.º (6 reintentos) agota.
//
// Alerta única: aquí solo se DECIDE (`alerta`); el candado real es la RPC
// `cp_envio_marcar_alerta` (0790). Por eso un envío con `alertaEnviada = true` nunca
// vuelve a pedir alerta, y quien persiste debe tomar el candado antes de avisar.
//
// Determinismo: el reloj entra como argumento (`ahora`), la zona horaria de la
// ventana es explícita (`zona`); no se usa `Date.now()` ni la zona del servidor.
// Invariante: un documento con bloqueos abiertos NUNCA queda en `listo`.
// ═══════════════════════════════════════════════════════════════════════════

import { TZ_MX } from '@/lib/formato';
import type { EstadoEnvioTms, SalidaConfigFila } from './repo';

/** Zona de la flota por omisión (la ventana horaria de `cp_salida_config` son horas locales). */
export const ZONA_FLOTA_POR_DEFECTO = TZ_MX;
/** Tope de reintentos por error transitorio y techo del multiplicador del backoff. */
export const TOPE_TRANSITORIOS = 5;
export const TOPE_MULTIPLICADOR_BACKOFF = 8;

export const ESTADOS_TERMINALES: ReadonlyArray<EstadoEnvioTms> = ['enviado', 'rechazado_tms', 'subido_a_mano', 'descartado'];

export interface EnvioEnMaquina {
  estado: EstadoEnvioTms;
  /** Contador por fase (ver cabecera). */
  intentos: number;
  /** `true` si ya salió (o se reservó) la alerta de este envío: `alerta_enviada_en` no nulo. */
  alertaEnviada: boolean;
  /** Bloqueos duros abiertos del documento. */
  bloqueosAbiertos: number;
  /** El agotamiento ya se declaró (estado visible, sin más revisiones automáticas). */
  agotado?: boolean;
}

export type ConfigMaquina = Pick<SalidaConfigFila,
  'reintentosMax' | 'frecuenciaMin' | 'ventanaInicio' | 'ventanaFin' | 'destinatarioAlertaCorreo'>;

export type EventoEnvio =
  | { tipo: 'prechequeo'; accion: 'enviar' | 'pendiente_reque' | 'revisar'; motivo?: string | null }
  /** El reque ya existe en el TMS (revisión periódica o aviso). */
  | { tipo: 'reque_aparecio' }
  /** Se revisó otra vez y el reque sigue sin existir. */
  | { tipo: 'reque_sigue_ausente' }
  | { tipo: 'iniciar_envio' }
  | { tipo: 'resultado_envio'; resultado: 'enviado' | 'rechazado' | 'transitorio'; motivo?: string | null };

export type MotivoAlerta = 'reque_agotado' | 'rechazado_tms' | 'transitorio_agotado';

export interface DevolverDocumento { estado: 'por_revisar'; motivo: string }

export type Transicion =
  | {
    ok: true;
    estado: EstadoEnvioTms;
    intentos: number;
    /** Cuándo volver a mirar este envío; `null` = nadie lo reclama (espera evento externo o terminal). */
    proximaRevision: Date | null;
    /** Pedir la alerta única (quien persiste toma el candado antes de avisar). */
    alerta: { motivo: MotivoAlerta; destinatario: string } | null;
    /** Reintentos o intentos agotados: el estado queda visible, sin más revisiones automáticas. */
    agotado: boolean;
    devolverDocumento: DevolverDocumento | null;
    /** Texto para la oficina, en español. */
    mensaje: string | null;
  }
  | { ok: false; razon: string };

const ceroAlertas = { alerta: null, agotado: false, devolverDocumento: null, mensaje: null } as const;

// ── Tiempo (determinista, zona explícita) ────────────────────────────────────

function partesLocales(t: number, zona: string): { y: number; mo: number; d: number; h: number; mi: number } {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(t))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute };
}

/** Desfase (ms) de la zona respecto de UTC en el instante `t`. */
function desfase(t: number, zona: string): number {
  const l = partesLocales(t, zona);
  return Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi) - Math.floor(t / 60000) * 60000;
}

/** Instante UTC de una hora de pared local (dos pasadas para cruzar cambios de horario). */
function instanteLocal(y: number, mo: number, d: number, h: number, mi: number, zona: string): number {
  const pared = Date.UTC(y, mo - 1, d, h, mi);
  let t = pared - desfase(pared, zona);
  t = pared - desfase(t, zona);
  return t;
}

const aMin = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Si `t` cae fuera de la ventana local [inicio, fin), el siguiente `inicio`; si no, `t`. */
export function ajustarAVentana(t: Date, inicio: string | null, fin: string | null, zona: string = ZONA_FLOTA_POR_DEFECTO): Date {
  if (inicio === null || fin === null) return t;
  const a = aMin(inicio);
  const b = aMin(fin);
  if (a === b) return t;
  const l = partesLocales(t.getTime(), zona);
  const m = l.h * 60 + l.mi;
  const dentro = a < b ? m >= a && m < b : m >= a || m < b;
  if (dentro) return t;
  // Fuera: el próximo inicio. Si ya pasó el inicio de hoy (o la ventana cruza medianoche y estamos en el hueco), es hoy cuando m < a.
  const hoy = m < a;
  const base = Date.UTC(l.y, l.mo - 1, l.d + (hoy ? 0 : 1));
  const dia = new Date(base);
  return new Date(instanteLocal(dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate(), Math.floor(a / 60), a % 60, zona));
}

const sumarMin = (t: Date, min: number): Date => new Date(t.getTime() + min * 60000);

/** Multiplicador del backoff para el fallo transitorio número `n` (1-based): 1, 2, 4, 8, 8… */
export function multiplicadorBackoff(n: number): number {
  return Math.min(2 ** Math.max(0, n - 1), TOPE_MULTIPLICADOR_BACKOFF);
}

const destinatarioDe = (c: ConfigMaquina): string => c.destinatarioAlertaCorreo ?? 'la oficina';

/** Invariante: `listo` y bloqueos abiertos son incompatibles. */
export function cumpleInvariante(estado: EstadoEnvioTms, bloqueosAbiertos: number): boolean {
  return !(estado === 'listo' && bloqueosAbiertos > 0);
}

function aRevisar(motivo: string): Transicion {
  return { ok: true, estado: 'descartado', intentos: 0, proximaRevision: null, ...ceroAlertas, devolverDocumento: { estado: 'por_revisar', motivo }, mensaje: motivo };
}

const MOTIVO_BLOQUEOS = 'El documento tiene bloqueos abiertos: corrígelos antes de enviarlo al TMS.';

// ── La máquina ───────────────────────────────────────────────────────────────

export function siguienteEstado(
  envio: EnvioEnMaquina, evento: EventoEnvio, config: ConfigMaquina, ahora: Date, zona: string = ZONA_FLOTA_POR_DEFECTO,
): Transicion {
  const { estado } = envio;
  if (ESTADOS_TERMINALES.includes(estado)) {
    return { ok: false, razon: `El envío está en «${estado}», que es terminal: ${estado === 'rechazado_tms' ? 'una persona debe corregir y reaprobar (envío nuevo)' : 'no admite más eventos'}.` };
  }
  const proxima = (min: number): Date => ajustarAVentana(sumarMin(ahora, min), config.ventanaInicio, config.ventanaFin, zona);

  const aListo = (): Transicion => envio.bloqueosAbiertos > 0
    ? aRevisar(MOTIVO_BLOQUEOS)
    : { ok: true, estado: 'listo', intentos: 0, proximaRevision: ahora, ...ceroAlertas };

  const reintentarReque = (): Transicion => {
    const intentos = envio.intentos + 1;
    if (intentos > config.reintentosMax) {
      if (envio.agotado) {
        return { ok: true, estado: 'pendiente_reque', intentos: envio.intentos, proximaRevision: null, ...ceroAlertas, agotado: true, mensaje: `Sigue sin requerimiento: avisamos a ${destinatarioDe(config)}.` };
      }
      const destinatario = destinatarioDe(config);
      return {
        ok: true, estado: 'pendiente_reque', intentos, proximaRevision: null, agotado: true, devolverDocumento: null,
        alerta: envio.alertaEnviada ? null : { motivo: 'reque_agotado', destinatario },
        mensaje: `Sigue sin requerimiento: avisamos a ${destinatario}.`,
      };
    }
    return { ok: true, estado: 'pendiente_reque', intentos, proximaRevision: proxima(config.frecuenciaMin), ...ceroAlertas, mensaje: 'Esperando el requerimiento en el TMS.' };
  };

  switch (estado) {
    case 'pendiente_prechequeo': {
      if (evento.tipo !== 'prechequeo') break;
      if (evento.accion === 'enviar') return aListo();
      if (evento.accion === 'revisar') return aRevisar(evento.motivo?.trim() || 'El pre-chequeo pide que una persona revise el documento.');
      return reintentarReque();
    }
    case 'pendiente_reque': {
      if (evento.tipo === 'reque_aparecio') return aListo();
      if (evento.tipo === 'reque_sigue_ausente') return reintentarReque();
      break;
    }
    case 'listo': {
      if (evento.tipo !== 'iniciar_envio') break;
      if (envio.bloqueosAbiertos > 0) return aRevisar(MOTIVO_BLOQUEOS);
      return { ok: true, estado: 'enviando', intentos: envio.intentos, proximaRevision: null, ...ceroAlertas };
    }
    case 'error_transitorio': {
      if (evento.tipo !== 'iniciar_envio') break;
      if (envio.agotado) return { ok: false, razon: 'Los reintentos por error transitorio ya se agotaron; una persona debe intervenir.' };
      if (envio.bloqueosAbiertos > 0) return aRevisar(MOTIVO_BLOQUEOS);
      return { ok: true, estado: 'enviando', intentos: envio.intentos, proximaRevision: null, ...ceroAlertas };
    }
    case 'enviando': {
      if (evento.tipo !== 'resultado_envio') break;
      if (evento.resultado === 'enviado') return { ok: true, estado: 'enviado', intentos: envio.intentos, proximaRevision: null, ...ceroAlertas };
      if (evento.resultado === 'rechazado') {
        const destinatario = destinatarioDe(config);
        return {
          ok: true, estado: 'rechazado_tms', intentos: envio.intentos, proximaRevision: null, agotado: false, devolverDocumento: null,
          alerta: envio.alertaEnviada ? null : { motivo: 'rechazado_tms', destinatario },
          mensaje: `El TMS rechazó el envío: corrige el documento y vuelve a aprobar (avisamos a ${destinatario}).`,
        };
      }
      const intentos = envio.intentos + 1;
      if (intentos > TOPE_TRANSITORIOS) {
        const destinatario = destinatarioDe(config);
        return {
          ok: true, estado: 'error_transitorio', intentos, proximaRevision: null, agotado: true, devolverDocumento: null,
          alerta: envio.alertaEnviada ? null : { motivo: 'transitorio_agotado', destinatario },
          mensaje: `El TMS no responde tras varios intentos: avisamos a ${destinatario}.`,
        };
      }
      return {
        ok: true, estado: 'error_transitorio', intentos, proximaRevision: proxima(config.frecuenciaMin * multiplicadorBackoff(intentos)),
        ...ceroAlertas, mensaje: 'Error temporal del TMS: se reintenta solo.',
      };
    }
    default:
      break;
  }
  return { ok: false, razon: `El evento «${evento.tipo}» no aplica al estado «${estado}».` };
}
