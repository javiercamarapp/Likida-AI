import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { sentryActivo } from '@/lib/observability/sentry';
import { redisConfigurado } from '@/lib/ratelimit';

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
//  · si Sentry está configurado;
//  · con qué backend corre el LÍMITE DE TASA (auditoría prod, SEG-1). Sin
//    Redis, `ratelimit.ts` cuenta en la memoria de cada instancia y el techo
//    del login se multiplica por cuantas lambdas abra quien insiste. Eso se
//    sabía SOLO leyendo la línea de arranque de una instancia que ya hubiera
//    atendido algo; aquí se pregunta desde fuera y en cualquier momento.
//    Decir `redis|memoria` no es filtrar nada: no revela host, credencial ni
//    umbral — dice si una defensa conocida está encendida, igual que
//    `sentry: sin_dsn` ya lo hacía.
//  · NO mide la ausencia de corridas de cron: con la base en cero flotas,
//    "no hubo corridas con trabajo" es lo normal y alarmaría siempre. Ese
//    monitor llega cuando `agente_corrida` tenga tráfico real que fechar.
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

  const cuerpo = {
    ok: db === 'ok',
    db,
    sentry: sentryActivo() ? 'configurado' : 'sin_dsn',
    // Mide lo MISMO que decide `ratelimit.ts` (su propia función exportada),
    // no una segunda lectura de las env: dos mediciones del mismo hecho se
    // desincronizan al primer cambio.
    ratelimit: redisConfigurado() ? 'redis' : 'memoria',
    // Vercel la inyecta en build; en local es "local" y eso también es verdad.
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    hora: new Date().toISOString(),
  };
  return NextResponse.json(cuerpo, { status: cuerpo.ok ? 200 : 503 });
}
