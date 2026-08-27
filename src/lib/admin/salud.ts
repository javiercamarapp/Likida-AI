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

export const CRONS = ['wa-pendientes', 'wa-outbox', 'escalar', 'facturar', 'purgar', 'runner', 'gps', 'asistencia'] as const;
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
