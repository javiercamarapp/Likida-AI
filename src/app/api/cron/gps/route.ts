import { NextResponse } from 'next/server';
import { sincronizarGpsTodas } from '@/lib/likida/conectores/sincronizar_gps';
import { leerInterruptor } from '@/lib/likida/interruptores';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { registrarLatido, puertaCron } from '@/lib/admin/salud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Una llamada HTTP por flota con GPS conectado, cada una acotada a 15 s dentro
// de `httpReal`. 60 s cubre una decena de flotas con margen; el día que sean
// más, lo que hay que partir es la corrida por flota, no subir este número.
export const maxDuration = 60;

// ═══════════════════════════════════════════════════════════════════════════
// EL CRON QUE HACE VERDAD «el GPS de tu flota».
//
// La landing lista el GPS entre las fuentes de dato. Los cuatro conectores
// existían, declaraban `leer_posiciones` y probaban su credencial — y `posicion`
// tenía UN escritor: el pin que un chofer manda a mano por WhatsApp. Un
// conector que nadie llama es una credencial guardada, no una fuente.
//
// ── POR QUÉ NO ALERTA POR CADA FLOTA QUE FALLA ───────────────────────────
// `sincronizarGpsTodas` devuelve el error POR FLOTA en vez de lanzar: un token
// de Samsara vencido en una flota no puede dejar sin posiciones a las demás.
// Aquí eso se traduce en un latido 'parcial' —no 'fallo'— y en el conteo en el
// cuerpo. El 'fallo' se reserva para lo que sí tumba la corrida entera.
//
// ── LA PUERTA Y EL INTERRUPTOR, IGUAL QUE LAS DEMÁS ───────────────────────
// Sin `CRON_SECRET` contesta 500, no 200: un 200 dejaría el cron verde en el
// panel de Vercel mientras el GPS lleva semanas sin entrar. Y el interruptor
// ilegible NO se lee como apagado (A17): es un fallo declarado.
// ═══════════════════════════════════════════════════════════════════════════

export async function GET(req: Request) {
  const puerta = await puertaCron('gps', req, 'El GPS no se sincroniza sin él.');
  if (puerta) return puerta;

  const global = await leerInterruptor('global');
  if (global === 'ilegible') {
    return NextResponse.json({
      corrio: false,
      error: 'No se pudo leer el interruptor global: no se sincroniza sin saber si está apagado.',
      codigo: 'interruptor_ilegible',
      interruptor: 'global',
    }, { status: 500 });
  }
  if (global === 'apagado') {
    logger.warn('cron.gps.saltado', { interruptor: 'global' });
    await registrarLatido('gps', 'saltado', { interruptor: 'global' });
    return NextResponse.json({ corrio: false, saltado: 'interruptor global' });
  }

  try {
    const resultados = await sincronizarGpsTodas();

    const conError = resultados.filter((r) => r.error);
    const guardadas = resultados.reduce((s, r) => s + r.guardadas, 0);
    const huerfanas = resultados.reduce((s, r) => s + r.huerfanas, 0);

    // Las huérfanas no son un error de la corrida, pero tampoco son ruido: son
    // camiones que el proveedor reporta y que ninguna unidad reclama. Van en el
    // cuerpo para que se vean desde el panel sin abrir los logs.
    const cuerpo = {
      corrio: true,
      flotas: resultados.length,
      guardadas,
      huerfanas,
      conError: conError.length,
      // El detalle SIN la credencial: aquí solo viaja el id del proveedor.
      errores: conError.map((r) => ({ tenantId: r.tenantId, proveedor: r.proveedor, error: r.error })),
    };

    if (conError.length > 0) {
      logger.warn('cron.gps.parcial', cuerpo);
      await registrarLatido('gps', 'parcial', { flotas: resultados.length, conError: conError.length });
    } else {
      logger.info('cron.gps.ok', cuerpo);
      await registrarLatido('gps', 'ok', { flotas: resultados.length, guardadas });
    }
    return NextResponse.json(cuerpo);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const codigo = codigoDeError(e);
    logger.error('cron.gps.falló', { error, codigo });
    await alertarOperador('cron.gps', { error, codigo });
    await registrarLatido('gps', 'fallo', { codigo });
    return NextResponse.json({ error }, { status: 500 });
  }
}

