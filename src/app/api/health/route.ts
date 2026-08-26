import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { estadoLatidos, type CronId } from '@/lib/admin/salud';
import { alertarOperador } from '@/lib/observability/alerta';
import { logger } from '@/lib/logger';
import { rateLimit, clientIp } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// /api/health — el pulso para un monitor externo (hallazgo D4, auditoría 4).
//
// Hasta hoy nada podía preguntarle a Likida "¿estás vivo?" desde fuera: el
// cron del camino del dinero tronó cada hora durante nueve días y se
// descubrió porque se cayó una página a la vista. Un UptimeRobot (o el cron
// de un tercero) pegándole a esto cada minuto convierte ese modo de falla en
// una alerta de minutos.
//
// QUÉ MIDE Y QUÉ NO:
//  · la base respondió (consulta real, HEAD + count sobre `tenant`);
//  · qué versión corre (el sha del deploy — es lo que confirma que el último
//    push con [deploy] de verdad llegó, contra el modo de falla silencioso
//    del ignoreCommand);
//  · desde RES-7 (0155) SÍ mide los latidos de los crons. Un cron vencido o
//    una lectura de latidos ilegible degrada el estado agregado a 503 y dispara
//    UNA alerta al operador (piso de una hora). Los nombres y edades concretas
//    quedan únicamente en logs/alerta privados, no en el endpoint público.
//    `sin_latido` mantiene el health degradado hasta que el cron haya probado
//    que está vivo.
//  · NO mide la ausencia de corridas de cron: con la base en cero flotas,
//    "no hubo corridas con trabajo" es lo normal y alarmaría siempre. Ese
//    monitor llega cuando `agente_corrida` tenga tráfico real que fechar.
//
// SIN AUTH A PROPÓSITO: no devuelve un solo dato de negocio, nombre de cron ni
// configuración interna — solo estado agregado, sha (público en GitHub) y hora.
// Un health detrás de secreto es un health que el monitor gratuito no puede
// usar. Status 200 solo cuando TODO lo medido está bien; 503 si hay fallo o
// degradación — que es lo que un monitor entiende sin leer el cuerpo.
// ═══════════════════════════════════════════════════════════════════════════

export async function GET(req: NextRequest) {
  const iniciado = Date.now();
  // OPERABILIDAD-19C2-3 (barrido MEDIO/BAJO): sin auth a propósito (ver
  // arriba), esta ruta hace 2 consultas reales a Supabase por petición, sin
  // ningún techo. 30/min por IP deja de sobra a un monitor externo (que le
  // pega "cada minuto", según el comentario original) y frena un scraper.
  if (!(await rateLimit(`health:${clientIp(req)}`, 30, 60_000))) {
    return NextResponse.json({ ok: false, status: 'fail', error: 'demasiadas peticiones' }, {
      status: 429,
      headers: { 'cache-control': 'no-store' },
    });
  }
  let db: 'ok' | 'fallo' = 'fallo';
  try {
    const { error } = await acotada(
      supabaseAdmin().from('tenant').select('id', { count: 'exact', head: true }),
      'health.db',
    );
    if (!error) db = 'ok';
  } catch {
    db = 'fallo';
  }

  // Solo el agregado, sin detalle: el health es público y esto no filtra
  // nombres de cron ni datos de negocio. Una lectura caída degrada el pulso.
  let cronCheck: 'ok' | 'degraded' | 'unknown' = 'unknown';
  try {
    const latidos = await estadoLatidos();
    const vencidos = (Object.keys(latidos) as CronId[]).filter((c) => latidos[c].estado === 'vencido');
    const sinLatido = (Object.keys(latidos) as CronId[]).filter((c) => latidos[c].estado === 'sin_latido');
    const noSanos = (Object.keys(latidos) as CronId[]).filter((c) =>
      latidos[c].estado === 'ok' && latidos[c].ultimoEstado !== 'ok');
    if (vencidos.length > 0) {
      cronCheck = 'degraded';
      logger.error('health.cron_vencido', { crons: vencidos, haceMin: vencidos.map((c) => latidos[c].haceMin) });
      await alertarOperador('cron.sin_latido', {
        error: `Sin latido: ${vencidos.map((c) => `${c} (hace ${latidos[c].haceMin} min)`).join(', ')}`,
        codigo: 'cron_sin_latido',
      });
    } else if (noSanos.length > 0) {
      // Fresco no significa sano: un cron que acaba de reportar `fallo`,
      // `parcial` o `saltado` debe tumbar el health aunque su reloj esté al día.
      cronCheck = 'degraded';
      logger.error('health.cron_estado_no_ok', {
        crons: noSanos,
        estados: noSanos.map((c) => latidos[c].ultimoEstado),
      });
      await alertarOperador('cron.estado_no_ok', {
        error: `Cron con resultado no sano: ${noSanos.map((c) => `${c} (${latidos[c].ultimoEstado})`).join(', ')}`,
        codigo: 'cron_estado_no_ok',
      });
    } else if (sinLatido.length === 0) {
      cronCheck = 'ok';
    }
  } catch (e) {
    cronCheck = 'unknown';
    logger.warn('health.latidos_ilegibles', { err: e instanceof Error ? e.message : String(e) });
  }

  const status: 'ok' | 'degraded' | 'fail' = db !== 'ok' ? 'fail' : cronCheck !== 'ok' ? 'degraded' : 'ok';
  // Métrica de baja cardinalidad para logs/drains. El detalle de qué cron fue
  // vencido queda en el log privado y no se publica en este endpoint.
  logger.info('metric.health', { status, db, cron: cronCheck, ms: Date.now() - iniciado });
  const cuerpo = {
    ok: status === 'ok',
    status,
    checks: { db, crons: cronCheck },
    // Vercel la inyecta en build; en local es "local" y eso también es verdad.
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    hora: new Date().toISOString(),
  };
  return NextResponse.json(cuerpo, {
    status: cuerpo.ok ? 200 : 503,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}
