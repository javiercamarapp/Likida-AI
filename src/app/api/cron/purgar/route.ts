import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Un `delete` acotado por fecha y un `insert … on conflict` de agregados. Los
// dos entran por índice (`idx_wa_msg_created` y `idx_costo_tenant`), así que el
// presupuesto es para el caso raro: la PRIMERA corrida, que barre de golpe todo
// lo que se acumuló desde que existe la tabla.
export const maxDuration = 120;

// ═══════════════════════════════════════════════════════════════════════════
// EL CRON DE MANTENIMIENTO DE DATOS.
//
// Hasta la 0072 no se purgaba NADA. Dos tablas crecen sin techo y ninguna tenía
// una línea que las recortara — y la que revienta primero no es la obvia:
// `llm_costo` guarda una fila por LLAMADA AL MODELO, y un mensaje de WhatsApp
// dispara varias, así que crece más rápido que `wa_mensaje_procesado`, que
// guarda una por mensaje.
//
// ── QUÉ HACE, Y QUÉ NO HACE A PROPÓSITO ──────────────────────────────────
//
// BORRA `wa_mensaje_procesado` de más de 30 días. Es una tabla de idempotencia
// y nada más: no tiene `tenant_id` (CLAUDE.md), no se puede atribuir a una
// flota y no responde ninguna pregunta de negocio. 30 días es más de un orden
// de magnitud por encima de la ventana de reintentos de Meta.
//
// NO BORRA `llm_costo`. Es la fuente del costo por viaje, y además
// `resumen_costo_ia_tenant()` (0062/0064) suma sus filas CRUDAS: si se
// purgaran, esa función contestaría —sin avisar— una cifra MENOR para cualquier
// periodo purgado, y el panel enseñaría un número distinto del mismo mes según
// cuándo se mire. Eso choca con la regla que define al producto ("nunca
// inventar una cifra"). En su lugar se CONSOLIDA a mensual, que es la
// granularidad que el panel de verdad lee. Ver la 0072 para el detalle.
//
// La respuesta lleva `llmCostoPurgado: false` explícito para que nadie lea una
// corrida verde como "ya se limpió todo".
//
// ── POR QUÉ FALLA CERRADO SIN SECRETO ────────────────────────────────────
//
// Mismo criterio que `escalar` y `facturar`: esta ruta BORRA FILAS. Sin
// `CRON_SECRET` devuelve 500 y no 200, porque un 200 dejaría el cron verde en
// el panel de Vercel para siempre y nadie se enteraría de que la purga lleva
// meses sin correr — que es justo el modo de falla que esta ruta existe para
// cerrar. Y sin el secreto, cualquiera que conociera la URL podría disparar
// borrados a voluntad.
// ═══════════════════════════════════════════════════════════════════════════

/** Días que sobrevive una fila de idempotencia. El piso lo impone la 0072. */
const DIAS_WA = 30;

export async function GET(req: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    logger.error('cron.purgar.sin_secreto', {});
    return NextResponse.json(
      { error: 'CRON_SECRET no está configurado. La purga no corre sin él.' },
      { status: 500 },
    );
  }
  if (req.headers.get('authorization') !== `Bearer ${secreto}`) {
    // Sin cuerpo: a quien no está autorizado no se le dice qué hay detrás.
    return new NextResponse(null, { status: 401 });
  }

  try {
    const { data, error } = await supabaseAdmin().rpc('mantenimiento_de_datos', {
      p_dias_wa: DIAS_WA,
    });

    // supabase-js reporta POR VALOR: sin comprobar `error` explícitamente, una
    // base caída se leería como una purga que no encontró nada que borrar y la
    // corrida saldría verde. Ver `exigir()` en analytics.ts.
    if (error) {
      logger.error('cron.purgar.falló', { error: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    logger.info('cron.purgar.ok', { ...(data as Record<string, unknown>) });
    return NextResponse.json({ corrio: true, ...(data as Record<string, unknown>) });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error('cron.purgar.falló', { error });
    return NextResponse.json({ error }, { status: 500 });
  }
}
