import { logger } from '@/lib/logger';
import type { SenalesWebhookLiq } from '../repo';

// ═══════════════════════════════════════════════════════════════════════════
// ALERTAS DEL WEBHOOK DE LIQUIDACIONES DE ENTRADA (POST /v1/liquidaciones-externas/desgloses).
//
// Hasta hoy nadie se enteraba si el webhook fallaba o si el cliente dejaba de mandar. Esto cuelga de la guardia de 5 minutos
// (una pasada de cada tres, como las alertas de IA): SIN cron nuevo, SIN tabla nueva y por el MISMO canal de siempre,
// `alertarOperador` (correo a ALERTA_EMAIL; WhatsApp a ALERTA_WA si existe: los eventos `guardia.*` salen por los dos).
//
// TRES REGLAS, todas puras y probadas con series sintéticas:
//   1. FALLOS: en la última hora, ≥ 3 respuestas 5xx, o ≥ 10 rechazos de otra clase (400 validación, 403, 409, 429). Los rechazos
//      los deja la propia ruta en `evento_seguridad` (origen api_v1, tipo otro, detalle.recurso = webhook_liquidaciones).
//   2. TOKEN: ≥ 5 llaves inválidas (401) contra esta ruta en la última hora. Ya las registra la puerta común (`llave_invalida`).
//   3. SILENCIO: una flota que YA recibió por el webhook y lleva ≥ 20 horas HÁBILES (lun-vie 8:00-18:00 hora de México = dos días
//      hábiles) sin una recepción nueva. Una flota que nunca ha recibido NO está en silencio (no hay «primer uso» todavía): `sin_uso`.
//
// DEGRADA CON ELEGANCIA. Sin ALERTA_EMAIL/ALERTA_WA `alertarOperador` devuelve false y no pasa nada grave: la regla queda en `alerta`
// con `avisado: false`, el latido lo guarda, /api/health lo refleja (campo `webhooks`, sin tumbar su status) y en cuanto exista el
// canal, la siguiente pasada manda el aviso. Una lectura que falla es `sin_medir`, jamás «ok». NUNCA lanza.
//
// El health NO cae por esto: un cliente que falla o calla es un asunto del cliente, no de la salud de la plataforma.
// ═══════════════════════════════════════════════════════════════════════════

export const VENTANA_WEBHOOK_MS = 60 * 60 * 1000;
export const UMBRAL_5XX = 3;
export const UMBRAL_RECHAZOS = 10;
export const UMBRAL_LLAVES_INVALIDAS = 5;
/** Horas hábiles sin recepción para declarar silencio. Se puede afinar con `WEBHOOK_LIQ_SILENCIO_HORAS_HABILES`. */
export const HORAS_HABILES_SILENCIO = 20;
const HORA_ABRE = 8;
const HORA_CIERRA = 18;
/** México no tiene horario de verano desde 2022: UTC-6 fijo todo el año. */
const OFFSET_MX_MS = -6 * 3_600_000;

export type EstadoRegla = 'ok' | 'alerta' | 'sin_medir';
export type EstadoSilencio = EstadoRegla | 'sin_uso';
export type ReglaWebhook = 'fallos' | 'token' | 'silencio';

export function alertasWebhookLiqEncendidas(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ALERTAS_WEBHOOK_LIQ !== 'apagado';
}

export function horasHabilesDeSilencio(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.WEBHOOK_LIQ_SILENCIO_HORAS_HABILES);
  return Number.isFinite(n) && n >= 1 && n <= 400 ? n : HORAS_HABILES_SILENCIO;
}

/** PURA. Horas hábiles (lun-vie, 8:00 a 18:00 hora de México) entre dos instantes. No modela feriados. */
export function horasHabilesEntre(desdeMs: number, hastaMs: number): number {
  if (!(hastaMs > desdeMs)) return 0;
  // Se trabaja en «hora de pared de México» desplazando el reloj: los getters UTC del desplazado son la hora local.
  const d0 = desdeMs + OFFSET_MX_MS;
  const h0 = hastaMs + OFFSET_MX_MS;
  let total = 0;
  const dia = new Date(d0); dia.setUTCHours(0, 0, 0, 0);
  for (let t = dia.getTime(); t < h0; t += 86_400_000) {
    const sem = new Date(t).getUTCDay();
    if (sem === 0 || sem === 6) continue;
    const abre = t + HORA_ABRE * 3_600_000;
    const cierra = t + HORA_CIERRA * 3_600_000;
    const ini = Math.max(abre, d0);
    const fin = Math.min(cierra, h0);
    if (fin > ini) total += fin - ini;
  }
  return total / 3_600_000;
}

export interface EvaluacionFallos { estado: EstadoRegla; cincoxx: number | null; otros: number | null }
/** PURA. `null` = no se pudo leer. */
export function evaluarFallosWebhook(r: SenalesWebhookLiq['rechazos']): EvaluacionFallos {
  if (r === null) return { estado: 'sin_medir', cincoxx: null, otros: null };
  const alerta = r.cincoxx >= UMBRAL_5XX || r.otros >= UMBRAL_RECHAZOS;
  return { estado: alerta ? 'alerta' : 'ok', cincoxx: r.cincoxx, otros: r.otros };
}

export interface EvaluacionToken { estado: EstadoRegla; llavesInvalidas: number | null }
export function evaluarTokenWebhook(n: number | null): EvaluacionToken {
  if (n === null) return { estado: 'sin_medir', llavesInvalidas: null };
  return { estado: n >= UMBRAL_LLAVES_INVALIDAS ? 'alerta' : 'ok', llavesInvalidas: n };
}

export interface EvaluacionSilencio {
  estado: EstadoSilencio;
  umbralHoras: number;
  /** Flotas en silencio: prefijo de 8 caracteres del id (el correo es de operación, no necesita el uuid completo) y horas hábiles. */
  flotas: Array<{ flota: string; horasHabiles: number }>;
}
/** PURA. Lista vacía = nadie ha recibido nunca (en 30 días): `sin_uso`, que NO alerta. */
export function evaluarSilencioWebhook(
  ultimas: SenalesWebhookLiq['ultimaPorTenant'], ahoraMs: number, umbralHoras: number = HORAS_HABILES_SILENCIO,
): EvaluacionSilencio {
  if (ultimas === null) return { estado: 'sin_medir', umbralHoras, flotas: [] };
  if (ultimas.length === 0) return { estado: 'sin_uso', umbralHoras, flotas: [] };
  const flotas = ultimas
    .map((u) => ({ flota: u.tenantId.slice(0, 8), horasHabiles: Math.round(horasHabilesEntre(Date.parse(u.ultima), ahoraMs) * 10) / 10 }))
    .filter((f) => f.horasHabiles >= umbralHoras);
  return { estado: flotas.length > 0 ? 'alerta' : 'ok', umbralHoras, flotas };
}

/** Lo que el latido de `guardia` guarda de la última pasada (y lo que lee /api/health). */
export interface DetalleWebhookLiq {
  evaluadoEn: string;
  fallos: EvaluacionFallos;
  token: EvaluacionToken;
  silencio: EvaluacionSilencio;
  /** Por regla: ¿el aviso de la alerta vigente SALIÓ por algún canal? `false` = sin canal o con el envío rechazado: se reintenta. */
  avisado: Partial<Record<ReglaWebhook, boolean>>;
}

export interface ResultadoWebhookLiq {
  estado: 'apagado' | 'omitido' | 'ok' | 'error';
  detalle?: DetalleWebhookLiq;
  avisos?: string[];
  error?: string;
}

export interface DepsWebhookLiq {
  leer?: (ahoraMs: number, ventanaMs: number) => Promise<SenalesWebhookLiq>;
  avisar?: (evento: string, detalle: Record<string, unknown>) => Promise<boolean>;
  toca?: (ahoraMs: number) => boolean;
  env?: NodeJS.ProcessEnv;
}

/** Una pasada de cada tres de la guardia (cada 15 min), igual que las alertas de IA. */
export function tocaWebhookLiq(ahoraMs: number): boolean {
  return new Date(ahoraMs).getUTCMinutes() % 15 < 5;
}

/** ¿Hay por dónde avisar? Lo refleja /api/health sin depender del módulo de alertas (que ese test mockea). */
export function canalesDeAlerta(env: NodeJS.ProcessEnv = process.env): { correo: boolean; whatsapp: boolean } {
  return { correo: !!env.ALERTA_EMAIL, whatsapp: !!env.ALERTA_WA };
}

/**
 * Una pasada. Avisa al ENTRAR en alerta, o mientras el aviso de una alerta vigente no haya salido (sin canal). Una alerta que
 * sigue y ya avisó no repite: el piso de una hora de `alertarOperador` es la segunda red. NUNCA lanza.
 */
export async function correrAlertasWebhookLiq(
  ahoraMs: number, previo: DetalleWebhookLiq | null, deps: DepsWebhookLiq = {},
): Promise<ResultadoWebhookLiq> {
  const env = deps.env ?? process.env;
  if (!alertasWebhookLiqEncendidas(env)) return { estado: 'apagado' };
  if (!(deps.toca ?? tocaWebhookLiq)(ahoraMs)) return { estado: 'omitido' };
  try {
    const leer = deps.leer ?? (async (a, v) => (await import('../repo')).leerSenalesWebhookLiq(a, v));
    const avisar = deps.avisar ?? (async (evento, d) => (await import('@/lib/observability/alerta')).alertarOperador(evento, d));
    const s = await leer(ahoraMs, VENTANA_WEBHOOK_MS);
    const fallos = evaluarFallosWebhook(s.rechazos);
    const token = evaluarTokenWebhook(s.llavesInvalidas);
    const silencio = evaluarSilencioWebhook(s.ultimaPorTenant, ahoraMs, horasHabilesDeSilencio(env));
    const avisado: DetalleWebhookLiq['avisado'] = {};
    const avisos: string[] = [];

    const tratar = async (regla: ReglaWebhook, estado: string, previoEstado: string | undefined, evento: string, detalle: Record<string, unknown>) => {
      if (estado !== 'alerta') return;
      if (previoEstado === 'alerta' && previo?.avisado[regla] === true) { avisado[regla] = true; return; }
      const salio = await avisar(evento, { ...detalle, ventana: '60 min', webhook: 'POST /v1/liquidaciones-externas/desgloses' });
      avisado[regla] = salio;
      avisos.push(salio ? regla : `${regla}_no_salio`);
    };
    await tratar('fallos', fallos.estado, previo?.fallos.estado, 'guardia.webhook_liq_fallos', {
      codigo: 'webhook_liq_fallos',
      error: `El webhook de liquidaciones de entrada rechazó o falló en la última hora: ${fallos.cincoxx} respuesta(s) 5xx (umbral ${UMBRAL_5XX}) y ${fallos.otros} rechazo(s) de otra clase (umbral ${UMBRAL_RECHAZOS}). Si son 5xx el fallo es nuestro; si son 400/409, revisa con el cliente qué manda.`,
    });
    await tratar('token', token.estado, previo?.token.estado, 'guardia.webhook_liq_token', {
      codigo: 'webhook_liq_token',
      error: `${token.llavesInvalidas} llave(s) inválida(s) contra el webhook de liquidaciones en la última hora (umbral ${UMBRAL_LLAVES_INVALIDAS}): el cliente puede estar usando una llave vencida o rotada, o alguien está probando llaves.`,
    });
    await tratar('silencio', silencio.estado, previo?.silencio.estado, 'guardia.webhook_liq_silencio', {
      codigo: 'webhook_liq_silencio',
      error: `El cliente dejó de mandar liquidaciones por el webhook: ${silencio.flotas.map((f) => `flota ${f.flota} lleva ${f.horasHabiles} h hábiles sin recepción`).join('; ')} (umbral ${silencio.umbralHoras} h hábiles, lun-vie 8:00-18:00 hora de México).`,
    });

    const detalle: DetalleWebhookLiq = { evaluadoEn: new Date(ahoraMs).toISOString(), fallos, token, silencio, avisado };
    return { estado: 'ok', detalle, avisos };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 160);
    logger.error('cron.guardia.webhook_liq_fallo', { err: error });
    return { estado: 'error', error };
  }
}

const ESTADOS_REGLA = ['ok', 'alerta', 'sin_medir'];
/** Lee `detalle.webhookLiq` de un latido sin confiar en su forma. */
export function webhookLiqDeDetalle(detalle: unknown): DetalleWebhookLiq | null {
  const w = (detalle as { webhookLiq?: unknown } | null)?.webhookLiq as Partial<DetalleWebhookLiq> | undefined;
  if (!w || typeof w !== 'object' || !w.fallos || !w.token || !w.silencio) return null;
  const ok = (e: unknown, extra: string[] = []) => [...ESTADOS_REGLA, ...extra].includes((e as { estado?: string })?.estado ?? '');
  if (!ok(w.fallos) || !ok(w.token) || !ok(w.silencio, ['sin_uso'])) return null;
  return { ...(w as DetalleWebhookLiq), avisado: w.avisado && typeof w.avisado === 'object' ? w.avisado : {} };
}

export interface ResumenWebhookHealth {
  estado: 'ok' | 'alerta' | 'sin_uso' | 'sin_medir' | 'sin_datos';
  alertas: ReglaWebhook[];
  /** Alguna alerta vigente cuyo aviso no salió (típico: ALERTA_EMAIL/ALERTA_WA sin configurar). */
  sinAvisar: boolean;
  canal: { correo: boolean; whatsapp: boolean };
  evaluadoEn: string | null;
}

/**
 * PURA. Lo que /api/health publica del webhook. Es informativo: NO entra al `status` global (un cliente que falla o calla no
 * hace que la plataforma esté `degraded`). `sin_datos` = la guardia aún no lo ha evaluado (apagado, recién desplegado o latido viejo).
 */
export function resumenWebhookParaHealth(detalleGuardia: unknown, env: NodeJS.ProcessEnv = process.env): ResumenWebhookHealth {
  const canal = canalesDeAlerta(env);
  const w = webhookLiqDeDetalle(detalleGuardia);
  if (!w) return { estado: 'sin_datos', alertas: [], sinAvisar: false, canal, evaluadoEn: null };
  const alertas = (['fallos', 'token', 'silencio'] as const).filter((r) => w[r].estado === 'alerta');
  const estado: ResumenWebhookHealth['estado'] =
    alertas.length > 0 ? 'alerta'
      : [w.fallos.estado, w.token.estado, w.silencio.estado].includes('sin_medir') ? 'sin_medir'
        : w.silencio.estado === 'sin_uso' ? 'sin_uso' : 'ok';
  return { estado, alertas, sinAvisar: alertas.some((r) => w.avisado[r] !== true), canal, evaluadoEn: w.evaluadoEn };
}
