// ═══════════════════════════════════════════════════════════════════════════
// EL LATIDO DE LOS CRONS (auditoría prod 22-ago-2026, RES-7).
//
// Un cron muerto era INVISIBLE: un 401 (secreto rotado en Vercel y no en el
// proyecto, o al revés) salía sin una línea de log; `CRON_SECRET` ausente se
// logueaba pero no alertaba; y nada medía "¿cuándo corrió por última vez?".
// El modo de falla que esto cierra: semanas sin drenar la bandeja de WhatsApp
// o sin escalar viajes, con el panel de Vercel en verde (un 401 es una
// respuesta, no un crash).
//
// TRES PIEZAS:
//   · `puertaCron`: la puerta común. Sin secreto → 500 + alerta al operador;
//     no autorizado → 401 con log y `codigo: 'cron_401'` (estable, para que
//     Sentry abra un issue por causa). La respuesta 401 sigue sin cuerpo.
//   · `registrarLatido`: cada corrida deja su marca en `cron_latido` (0155).
//     NUNCA lanza: un latido que no se pudo escribir no tumba la corrida.
//   · `estadoLatidos`: lo que /api/health y /admin/salud-sistema leen. Un
//     cron está `vencido` cuando lleva más de su cadencia + 20 min sin latir.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { logger } from '@/lib/logger';
import { autorizaCron } from '@/lib/auth/cron';
import { alertarOperador } from '@/lib/observability/alerta';

export const CRONS = ['wa-pendientes', 'wa-outbox', 'escalar', 'facturar', 'purgar', 'runner', 'gps', 'asistencia', 'descarga-sat', 'jornada', 'portales-vivos'] as const;
export type CronId = (typeof CRONS)[number];
export type EstadoLatido = 'ok' | 'fallo' | 'saltado' | 'parcial';

/** La cadencia de cada cron en vercel.json. Si cambia allá, cambia aquí:
 *  `salud.test.ts` compara las dos. */
export const CADENCIA_MS: Record<CronId, number> = {
  'wa-pendientes': 60_000,
  'wa-outbox': 60_000,
  escalar: 3_600_000,
  // ESC-5: la cola de facturación pasó de un lote global por hora a encolar
  // por flota cada 15 minutos. Esta tabla espeja vercel.json y su prueba lo
  // exige: si alguien cambia la cadencia allá y no aquí, el latido llamaría
  // muerto a un cron vivo (o al revés, callaría uno muerto tres cuartos de hora).
  facturar: 15 * 60_000,
  purgar: 86_400_000,
  runner: 4 * 3_600_000,
  // El poller de posiciones (23-ago-2026). 5 minutos es el grano al que un
  // mapa de flota deja de mentir sin castigar la cuota del proveedor.
  gps: 300_000,
  // El reloj muerto de emergencias (Fase 5, 26-ago-2026): un ROJO sin
  // reconocer escala cada 5 min — el cron de escalar (cada hora) no sirve
  // para una emergencia.
  asistencia: 300_000,
  // La descarga masiva del SAT (0231). La cadencia la fija el SAT: una
  // solicitud tarda hasta 6 días en madurar y su paquete vive 72 h. Cada 6 h
  // recoge el paquete el mismo día que queda listo, con margen de sobra antes
  // de que caduque, sin quemar cuota preguntando "¿ya?" cada minuto.
  'descarga-sat': 6 * 3_600_000,
  // El derivador del registro de jornada (0241). Cada hora, en el minuto 30
  // —desfasado de la estampida de los minutos 0/5/7/15/25— porque lo que
  // deriva son hitos y posiciones que ya ocurrieron: el grano fino no compra
  // nada y sí cuesta consultas. Barre tres días hacia atrás, así que una
  // corrida perdida se recupera sola.
  jornada: 3_600_000,
  // El vigilante de portales de facturación (0248). SEMANAL, y la cadencia es
  // una decisión, no una comodidad: lo que vigila se mueve en semanas o meses
  // —un dominio que expira, un portal que se muda—, así que golpear treinta
  // sitios de terceros cada hora no adelantaría ningún hallazgo y sí nos
  // pondría en sus registros como tráfico automatizado insistente. Tres de
  // esos sitios ya bloquean robots; el vigilante no puede ser el que provoque
  // el problema que vino a detectar.
  'portales-vivos': 7 * 86_400_000,
};

/** Cuánto retraso sobre la cadencia se tolera antes de llamarlo muerto. */
export const TOLERANCIA_LATIDO_MS = 20 * 60_000;

/**
 * La puerta común de los crons. Devuelve la respuesta que hay que contestar
 * (500 o 401) o `null` si la corrida puede seguir.
 */
export async function puertaCron(cron: CronId, req: Request, sinSecreto: string): Promise<NextResponse | null> {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    logger.error(`cron.${cron}.sin_secreto`, { codigo: 'cron_sin_secreto' });
    await alertarOperador(`cron.${cron}`, { error: 'CRON_SECRET no está configurado: el cron no corre.', codigo: 'cron_sin_secreto' });
    return NextResponse.json({ error: `CRON_SECRET no está configurado. ${sinSecreto}` }, { status: 500 });
  }
  // SEG-5: comparación de tiempo constante (`lib/auth/cron.ts`). Un `!==`
  // sobre un secreto es medible en teoría; el costo de no hacerlo es cero.
  if (!autorizaCron(req.headers.get('authorization'), secreto)) {
    // Sin cuerpo: a quien no está autorizado no se le dice qué hay detrás.
    // Pero SÍ se loguea (antes no): un secreto desfasado entre Vercel y el
    // proyecto se veía como un cron que nunca corre.
    logger.error(`cron.${cron}.no_autorizado`, { codigo: 'cron_401' });
    return new NextResponse(null, { status: 401 });
  }
  return null;
}

/** Deja la marca de ESTA corrida. Best-effort con log: nunca lanza. */
export async function registrarLatido(cron: CronId, estado: EstadoLatido, detalle: Record<string, unknown> = {}): Promise<void> {
  try {
    const { error } = await acotada(supabaseAdmin()
      .from('cron_latido')
      .upsert({ id: cron, ultimo_latido: new Date().toISOString(), estado, detalle }, { onConflict: 'id' }), 'registrarLatido');
    if (error) logger.warn('cron.latido_sin_escribir', { cron, err: error.message });
  } catch (e) {
    logger.warn('cron.latido_sin_escribir', { cron, err: e instanceof Error ? e.message : String(e) });
  }
}

export interface Latido { ultimoLatido: string; estado: EstadoLatido; detalle: Record<string, unknown> }

/** El último latido de un cron, o `null` si nunca latió. LANZA ante error. */
export async function leerLatido(cron: CronId): Promise<Latido | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('cron_latido')
    .select('ultimo_latido, estado, detalle')
    .eq('id', cron)
    .maybeSingle(), 'leerLatido');
  if (error) throw new Error(`leerLatido(${cron}): ${error.message}`);
  if (!data) return null;
  return {
    ultimoLatido: String(data.ultimo_latido),
    estado: data.estado as EstadoLatido,
    detalle: (data.detalle as Record<string, unknown> | null) ?? {},
  };
}

export type SaludCron = { estado: 'ok' | 'vencido' | 'sin_latido'; haceMin: number | null; ultimoEstado: EstadoLatido | null };

/** Decide el estado de un cron a partir de su latido — puro, para probarlo. */
export function juzgarLatido(cron: CronId, ultimoLatido: string | null, ultimoEstado: EstadoLatido | null, ahoraMs: number): SaludCron {
  if (!ultimoLatido) return { estado: 'sin_latido', haceMin: null, ultimoEstado: null };
  const hace = ahoraMs - Date.parse(ultimoLatido);
  return {
    estado: hace > CADENCIA_MS[cron] + TOLERANCIA_LATIDO_MS ? 'vencido' : 'ok',
    haceMin: Math.round(hace / 60_000),
    ultimoEstado,
  };
}

/**
 * Por qué un cron se saltó su corrida, en palabras, o `null` si no fue un
 * salto declarado. Puro para poder probarlo sin base.
 *
 * Los crons que se apagan por palanca anotan el motivo DENTRO de `detalle`
 * (`{ interruptor: 'global' }` en `gps/route.ts:58`, `facturar/route.ts:431`),
 * no en una columna. Sin esta lectura, un cron apagado a propósito y un cron
 * caído se ven idénticos en el panel — y son la diferencia entre «lo apagué
 * yo el martes» y «lleva tres días muerto».
 */
export function motivoDeSalto(detalle: Record<string, unknown>): string | null {
  const palanca = detalle.interruptor;
  if (typeof palanca === 'string' && palanca.trim() !== '') {
    return `apagado por la palanca «${palanca}»`;
  }
  // Un salto puede tener motivo PROPIO en prosa, no solo palanca: `facturar`
  // sin un adaptador de portal escrito anota `{ motivo: '...' }` (tableros al
  // día, 28-ago-2026). El cron escribe la frase; aquí solo se lee.
  const motivo = detalle.motivo;
  if (typeof motivo === 'string' && motivo.trim() !== '') return motivo;
  return null;
}

/**
 * ¿El latido de un cron describe un HUECO DE CONFIGURACIÓN ya declarado
 * (falta una variable de entorno, un contrato, una credencial) en vez de una
 * regresión real (algo que funcionaba y se rompió)?
 *
 * DOS SEÑALES, en orden de preferencia:
 *
 * 1. ESTRUCTURADA: `detalle.configAusente` (booleano). El cron ya resolvió la
 *    pregunta internamente — p. ej. `estadoDescargaSat().configurado` en
 *    `sat_descarga/index.ts`, que viaja hasta aquí vía `configAusente` en
 *    `cron/descarga-sat/route.ts` — así que aquí solo se lee el veredicto, no
 *    se reinterpreta texto libre. Es la señal que decide cuando está
 *    presente, sea cual sea la redacción de `motivo`.
 * 2. DE PROSA (respaldo, para crons que no traen `configAusente`): la MISMA
 *    convención que ya usa el repo entero para decir "esto no está listo":
 *    el cofre de credenciales ("El cofre no está configurado..."), los
 *    canales de correo/WhatsApp ("...no está configurado en este entorno").
 *    No es una lista de crons a mano — es leer la frase — así que un cron
 *    nuevo que declare su propio hueco con esta misma convención queda
 *    cubierto sin tocar este archivo. Pero es, por construcción, un regex
 *    contra texto libre: SIEMPRE que un cron pueda calcular el booleano,
 *    debe mandarlo (señal 1) en vez de confiar en que su prosa futura siga
 *    matcheando este patrón.
 *
 * AUDITORÍA PROD 29-AGO-2026 (ronda 18): sin la señal estructurada,
 * `/api/health` trataba `descarga-sat` sin `LIKIDA_SAT_PROVEEDOR` igual que
 * una regresión — un correo "Urgente" cada vez que un monitor externo pegaba
 * al endpoint (ocho en doce horas), indistinguible del cron que sí se rompió.
 *
 * AUDITORÍA 21 (29-ago-2026, ronda siguiente): ese arreglo dejó el regex de
 * respaldo cubriendo solo UNA de las cuatro ramas de `estadoDescargaSat()`
 * (proveedor ausente) — las otras tres (declarado y no construido,
 * desconocido, credenciales incompletas) redactan su motivo distinto y no
 * matcheaban. `configAusente` cierra el hueco de raíz para `descarga-sat`
 * (no depende de la redacción); el regex de abajo también se amplió para
 * cubrir las tres frases reales, como red de seguridad para latidos viejos
 * (escritos antes de este cambio) o crons que todavía no manden la señal
 * estructurada. Ver `alertarHuecoConfiguracion` en `observability/alerta.ts`.
 */
const RE_HUECO_CONFIGURACION =
  /no\s+est[aá]\s+configurad[oa]|no\s+configurad[oa]|no\s+construid[oa]|no\s+es\s+un[a]?\s+\S+\s+conocid[oa]|\bfalta\s+LIKIDA_[A-Z_]+\b/i;

function esHuecoPorProsa(motivo: unknown): boolean {
  return typeof motivo === 'string' && RE_HUECO_CONFIGURACION.test(motivo);
}

export function esHuecoDeConfiguracion(valor: unknown): boolean {
  if (typeof valor === 'string') return esHuecoPorProsa(valor);
  if (valor !== null && typeof valor === 'object') {
    const detalle = valor as Record<string, unknown>;
    if (typeof detalle.configAusente === 'boolean') return detalle.configAusente;
    return esHuecoPorProsa(detalle.motivo);
  }
  return false;
}

export interface LatidoDetallado extends SaludCron {
  /** ISO del último latido, o `null` si nunca latió. */
  ultimoLatido: string | null;
  /** Cada cuánto DEBERÍA correr, según vercel.json. */
  cadenciaMs: number;
  /** El jsonb tal cual lo dejó el cron. `{}` si nunca latió. */
  detalle: Record<string, unknown>;
  /** `motivoDeSalto(detalle)` ya resuelto, para que la vista no razone. */
  motivoSalto: string | null;
}

/**
 * Como `estadoLatidos`, pero trae también `detalle` y la cadencia esperada:
 * es lo que necesita una PANTALLA para explicar un rojo, frente a lo que
 * necesita `/api/health` para contestar un booleano. LANZA ante error — una
 * pantalla de salud que no puede leer la salud tiene que caerse, no pintar
 * nueve renglones grises que se leen como «todo tranquilo».
 */
export async function detalleLatidos(ahoraMs: number = Date.now()): Promise<Record<CronId, LatidoDetallado>> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('cron_latido')
    .select('id, ultimo_latido, estado, detalle'), 'detalleLatidos');
  if (error) throw new Error(`detalleLatidos: ${error.message}`);
  const porId = new Map((data ?? []).map((f) => [String(f.id), f]));
  const salida = {} as Record<CronId, LatidoDetallado>;
  for (const c of CRONS) {
    const f = porId.get(c);
    const ultimoLatido = f ? String(f.ultimo_latido) : null;
    const ultimoEstado = f ? (f.estado as EstadoLatido) : null;
    const detalle = (f?.detalle as Record<string, unknown> | null) ?? {};
    salida[c] = {
      ...juzgarLatido(c, ultimoLatido, ultimoEstado, ahoraMs),
      ultimoLatido,
      cadenciaMs: CADENCIA_MS[c],
      detalle,
      // SOLO cuando el propio cron dijo 'saltado': el detalle de un 'fallo'
      // puede traer llaves parecidas (p.ej. qué palanca resultó ilegible) y
      // leerlas como «apagado a propósito» sería contar la historia al revés.
      motivoSalto: ultimoEstado === 'saltado' ? motivoDeSalto(detalle) : null,
    };
  }
  return salida;
}

/** El estado de TODOS los crons en una sola lectura. LANZA ante error. */
export async function estadoLatidos(ahoraMs: number = Date.now()): Promise<Record<CronId, SaludCron>> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('cron_latido')
    .select('id, ultimo_latido, estado'), 'estadoLatidos');
  if (error) throw new Error(`estadoLatidos: ${error.message}`);
  const porId = new Map((data ?? []).map((f) => [String(f.id), f]));
  const salida = {} as Record<CronId, SaludCron>;
  for (const c of CRONS) {
    const f = porId.get(c);
    salida[c] = juzgarLatido(c, f ? String(f.ultimo_latido) : null, f ? (f.estado as EstadoLatido) : null, ahoraMs);
  }
  return salida;
}
