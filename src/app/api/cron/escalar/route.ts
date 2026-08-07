import { NextResponse } from 'next/server';
import { escalarViajesSinAceptar } from '@/lib/likida/escalar_viaje';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Una corrida toca N viajes y cada uno manda hasta dos mensajes de WhatsApp.
// Con el índice parcial de la 0058 la consulta es corta; el presupuesto es para
// los envíos, no para la lectura.
export const maxDuration = 120;

// ═══════════════════════════════════════════════════════════════════════════
// EL CRON QUE DESTAPA LOS VIAJES QUE NADIE ACEPTÓ.
//
// Primer cron del repo. Corre cada hora y le da al jefe de flota la única cosa
// que él puede resolver y el sistema no: cambiar de chofer.
//
// ── POR QUÉ FALLA CERRADO SIN SECRETO ────────────────────────────────────
//
// Esta ruta MANDA MENSAJES DE WHATSAPP, que cuestan dinero y llegan a personas
// reales. Sin `CRON_SECRET` configurado no se ejecuta y devuelve 500 — y no 200
// con un aviso: un 200 le diría a Vercel que la corrida salió bien, el cron se
// vería verde en el panel para siempre, y nadie se enteraría de que la
// escalación lleva meses sin correr. Es el mismo modo de falla que el repo ya
// documenta en `exigir()`: quedarse ciego se lee igual que "no hay nada".
//
// ── POR QUÉ NO SE PUEDE INVOCAR DESDE EL NAVEGADOR ───────────────────────
//
// Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`. Cualquiera que
// conociera la URL podría disparar avisos a los jefes de flota a voluntad; el
// secreto es lo único entre eso y un teléfono sonando de madrugada.
// ═══════════════════════════════════════════════════════════════════════════

export async function GET(req: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    logger.error('cron.escalar.sin_secreto', {});
    return NextResponse.json(
      { error: 'CRON_SECRET no está configurado. La escalación no corre sin él.' },
      { status: 500 },
    );
  }
  if (req.headers.get('authorization') !== `Bearer ${secreto}`) {
    // Sin cuerpo: a quien no está autorizado no se le dice qué hay detrás.
    return new NextResponse(null, { status: 401 });
  }

  try {
    const r = await escalarViajesSinAceptar();
    logger.info('cron.escalar.ok', { ...r });
    // Los fallos van en la RESPUESTA, no solo en el log. "Esa flota no tiene
    // teléfono de jefe registrado" es un problema de configuración que se
    // arregla en un minuto — si solo vive en el log, nadie lo ve hasta que
    // alguien pregunta por qué no le avisaron.
    return NextResponse.json(r);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error('cron.escalar.falló', { error });
    return NextResponse.json({ error }, { status: 500 });
  }
}
