import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { sentryActivo } from '@/lib/observability/sentry';
import { estadoLatidos, type CronId, type SaludCron } from '@/lib/admin/salud';
import { alertarOperador } from '@/lib/observability/alerta';
import { logger } from '@/lib/logger';

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
//  · si Sentry está configurado.
//  · desde RES-7 (0155) SÍ mide el latido de cada cron (`cron_latido`): un
//    cron que lleva más de su cadencia + 20 min sin latir sale `vencido` en
//    `crons` y dispara UNA alerta al operador (piso de una hora). No baja el
//    status a 503: el monitor externo mide la base; el cron muerto se avisa
//    por correo, que es el canal que alguien lee. `sin_latido` (recién
//    desplegado, tabla vacía) no alarma.
//
// SIN AUTH A PROPÓSITO: no devuelve un solo dato de negocio ni un nombre de
// tabla — solo ok/fail, el sha (público en GitHub) y la hora. Un health
// detrás de secreto es un health que el monitor gratuito no puede usar.
// Status 200 solo cuando TODO lo medido está bien; 503 si la base no
// respondió — que es lo que un monitor entiende sin leer el cuerpo.
// ═══════════════════════════════════════════════════════════════════════════

export async function GET() {
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

  // Solo los estados, sin detalle: el health es público y esto no filtra
  // nada de negocio. Una lectura caída no tumba el pulso: se reporta `ilegible`.
  let crons: Record<string, SaludCron['estado']> | 'ilegible' = 'ilegible';
  try {
    const latidos = await estadoLatidos();
    crons = Object.fromEntries((Object.keys(latidos) as CronId[]).map((c) => [c, latidos[c].estado]));
    const vencidos = (Object.keys(latidos) as CronId[]).filter((c) => latidos[c].estado === 'vencido');
    if (vencidos.length > 0) {
      logger.error('health.cron_vencido', { crons: vencidos, haceMin: vencidos.map((c) => latidos[c].haceMin) });
      await alertarOperador('cron.sin_latido', {
        error: `Sin latido: ${vencidos.map((c) => `${c} (hace ${latidos[c].haceMin} min)`).join(', ')}`,
        codigo: 'cron_sin_latido',
      });
    }
  } catch (e) {
    logger.warn('health.latidos_ilegibles', { err: e instanceof Error ? e.message : String(e) });
  }

  const cuerpo = {
    ok: db === 'ok',
    db,
    sentry: sentryActivo() ? 'configurado' : 'sin_dsn',
    // Vercel la inyecta en build; en local es "local" y eso también es verdad.
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    hora: new Date().toISOString(),
    crons,
  };
  return NextResponse.json(cuerpo, { status: cuerpo.ok ? 200 : 503 });
}
