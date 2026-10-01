import { NextResponse } from 'next/server';
import { procesarLiquidacionesExternas } from '@/lib/likida/liquidacion_externa/servicio';
import { leerInterruptor } from '@/lib/likida/interruptores';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { puertaCron, registrarLatido } from '@/lib/admin/salud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Una pasada firma, encola y concilia un lote de 50 contra el outbox: segundos,
// no minutos. No habla con Meta (eso es de `wa-outbox`).
export const maxDuration = 60;

// ═══════════════════════════════════════════════════════════════════════════
// EL CRON QUE ENTREGA Y CONCILIA LAS LIQUIDACIONES EXTERNAS (0370).
//
// El POST intenta entregar de inmediato, pero la entrega es asíncrona: pasa por
// la cola de WhatsApp (`wa_outbox`), que reintenta y puede enterrar. Este cron
// hace las dos cosas que el POST no puede esperar:
//
//   · lo que no se pudo ENCOLAR (el outbox no respondió) se reintenta con
//     backoff, y al agotar intentos queda `fallida` a la vista del panel;
//   · lo que SÍ está en la cola se CONCILIA: cuando Meta aceptó el mensaje pasa
//     a `enviada` (con su wamid), y cuando la ventana de 24 h estaba cerrada y
//     la sesión murió, cae a la plantilla — una sola vez.
//
// Respeta la palanca `global` y falla CERRADO si no puede leerla, igual que sus
// hermanos. No tiene palanca propia: el catálogo de interruptores se enumera
// entero en cada migración (lección de la 0227) y un motor que solo mueve filas
// hacia una cola que ya tiene la suya no la justifica.
// ═══════════════════════════════════════════════════════════════════════════

function ilegible() {
  return {
    corrio: false,
    error: 'No se pudo leer el interruptor global: no se corre sin saber si está apagado.',
    codigo: 'interruptor_ilegible',
    interruptor: 'global',
  };
}

export async function GET(req: Request) {
  const puerta = await puertaCron('liquidaciones-externas', req, 'La entrega de liquidaciones externas no corre sin él.');
  if (puerta) return puerta;

  const global = await leerInterruptor('global');
  if (global === 'ilegible') {
    await registrarLatido('liquidaciones-externas', 'fallo', { codigo: 'interruptor_ilegible' });
    return NextResponse.json(ilegible(), { status: 500 });
  }
  if (global === 'apagado') {
    logger.warn('cron.liquidaciones_externas.saltado', { interruptor: 'global' });
    await registrarLatido('liquidaciones-externas', 'saltado', { interruptor: 'global' });
    return NextResponse.json({ corrio: false, saltado: 'interruptor global' });
  }

  // La palanca del agente: apagar «Liquidación» apaga también la entrega de las
  // externas. Se pregunta DESPUÉS de la global y también falla cerrado.
  const agente = await leerInterruptor('agente:liquidacion');
  if (agente === 'ilegible') {
    await registrarLatido('liquidaciones-externas', 'fallo', { codigo: 'interruptor_ilegible' });
    return NextResponse.json({ ...ilegible(), interruptor: 'agente:liquidacion' }, { status: 500 });
  }
  if (agente === 'apagado') {
    logger.warn('cron.liquidaciones_externas.saltado', { interruptor: 'agente:liquidacion' });
    await registrarLatido('liquidaciones-externas', 'saltado', { interruptor: 'agente:liquidacion' });
    return NextResponse.json({ corrio: false, saltado: 'interruptor agente:liquidacion' });
  }

  try {
    const r = await procesarLiquidacionesExternas();
    logger.info('cron.liquidaciones_externas.ok', { ...r });
    // `fallidas` y `reintentar` son trabajo que NO terminó: ni «ok» ni «fallo»
    // total, que son las dos maneras de mentir aquí.
    const parcial = r.fallidas > 0 || r.reintentar > 0;
    await registrarLatido('liquidaciones-externas', parcial ? 'parcial' : 'ok', { ...r });
    return NextResponse.json({ corrio: true, ...r });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const codigo = codigoDeError(e);
    logger.error('cron.liquidaciones_externas.fallo', { error, codigo });
    await alertarOperador('cron.liquidaciones_externas', { error, codigo });
    await registrarLatido('liquidaciones-externas', 'fallo', { error, codigo });
    return NextResponse.json({ corrio: false, error, codigo }, { status: 500 });
  }
}
