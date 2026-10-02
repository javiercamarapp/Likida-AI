import { NextResponse } from 'next/server';
import { procesarEntregas } from '@/lib/likida/buzon/entrega';
import { depsEntregaReales } from '@/lib/likida/buzon/servicio';
import { leerInterruptor } from '@/lib/likida/interruptores';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { puertaCron, registrarLatido } from '@/lib/admin/salud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Una pasada arma a lo más un lote por flota y envía ≤10 correos con CSV+ZIP: segundos; el reloj corta antes.
export const maxDuration = 60;

// ═══════════════════════════════════════════════════════════════════════════
// EL CRON DE LA ENTREGA AL CONTADOR (0531, Agente 9).
//
// Cada 15 minutos: arma el lote AUTOMÁTICO del día de las flotas que lo encendieron (apagado
// por omisión), envía los lotes vencidos (nuevos y reintentos con backoff, con claim y lease),
// y anota el retraso de los «enviados» que Resend no ha confirmado. La confirmación llega por
// el webhook de Resend (`api/correo/eventos`). Respeta la palanca `global` y falla CERRADO.
// ═══════════════════════════════════════════════════════════════════════════

const MARGEN_MS = 12_000;

export async function GET(req: Request) {
  const inicio = Date.now();
  const puerta = await puertaCron('buzon-entrega', req, 'La entrega de facturas al contador no corre sin él.');
  if (puerta) return puerta;

  const global = await leerInterruptor('global');
  if (global === 'ilegible') {
    await registrarLatido('buzon-entrega', 'fallo', { codigo: 'interruptor_ilegible' });
    return NextResponse.json({
      corrio: false,
      error: 'No se pudo leer el interruptor global: no se corre sin saber si está apagado.',
      codigo: 'interruptor_ilegible', interruptor: 'global',
    }, { status: 500 });
  }
  if (global === 'apagado') {
    logger.warn('cron.buzon_entrega.saltado', { interruptor: 'global' });
    await registrarLatido('buzon-entrega', 'saltado', { interruptor: 'global' });
    return NextResponse.json({ corrio: false, saltado: 'interruptor global' });
  }

  try {
    const r = await procesarEntregas(depsEntregaReales(), { vencePorReloj: inicio + maxDuration * 1000 - MARGEN_MS });
    logger.info('cron.buzon_entrega.ok', { ...r });
    // Lotes fallidos o errores son trabajo que NO terminó: ni «ok» limpio ni «fallo» total.
    const parcial = r.fallidos > 0 || r.errores > 0;
    await registrarLatido('buzon-entrega', parcial ? 'parcial' : 'ok', { ...r });
    return NextResponse.json({ corrio: true, ...r });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const codigo = codigoDeError(e);
    logger.error('cron.buzon_entrega.fallo', { error, codigo });
    await alertarOperador('cron.buzon-entrega', { error, codigo });
    await registrarLatido('buzon-entrega', 'fallo', { error, codigo });
    return NextResponse.json({ corrio: false, error, codigo }, { status: 500 });
  }
}
