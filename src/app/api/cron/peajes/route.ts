import { NextResponse } from 'next/server';
import { procesarColaPeajes } from '@/lib/likida/peajes/ingesta';
import { leerInterruptor } from '@/lib/likida/interruptores';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { puertaCron, registrarLatido } from '@/lib/admin/salud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// ═══════════════════════════════════════════════════════════════════════════
// EL CRON QUE PROCESA LOS DESGLOSES DE PEAJE RECIBIDOS (0376).
//
// Reclama archivos de la cola (`peaje_archivo_reclamar`: FOR UPDATE SKIP LOCKED
// + lease con token, así dos cron simultáneos no toman el mismo archivo y uno
// que murió suelta el suyo al vencer el lease), los importa, los cruza y los
// cierra solo si todavía tiene el token. Un formato que no entiende queda
// `fallida` con el motivo exacto (y una corrida de «fallo» en la bitácora del
// agente); un fallo de infraestructura reintenta con backoff.
//
// Respeta la palanca `global` y la del agente de peajes y FALLA CERRADO si no
// puede leerlas, igual que sus hermanos. Un latido en TODO camino de salida.
// ═══════════════════════════════════════════════════════════════════════════

function ilegible(interruptor: string) {
  return {
    corrio: false,
    error: 'No se pudo leer el interruptor: no se corre sin saber si está apagado.',
    codigo: 'interruptor_ilegible',
    interruptor,
  };
}

export async function GET(req: Request) {
  const puerta = await puertaCron('peajes', req, 'La ingesta de desgloses de peaje no corre sin él.');
  if (puerta) return puerta;

  for (const id of ['global', 'agente:peajes'] as const) {
    const estado = await leerInterruptor(id);
    if (estado === 'ilegible') {
      await registrarLatido('peajes', 'fallo', { codigo: 'interruptor_ilegible', interruptor: id });
      return NextResponse.json(ilegible(id), { status: 500 });
    }
    if (estado === 'apagado') {
      logger.warn('cron.peajes.saltado', { interruptor: id });
      await registrarLatido('peajes', 'saltado', { interruptor: id });
      return NextResponse.json({ corrio: false, saltado: `interruptor ${id}` });
    }
  }

  try {
    // Un margen para el latido: lo que no alcance queda con su lease y el
    // siguiente cron lo recupera.
    const r = await procesarColaPeajes({ limite: 3, venceEn: Date.now() + 100_000 });
    logger.info('cron.peajes.ok', { ...r });
    // `fallidos` y `reintentar` son trabajo que NO terminó bien: ni «ok» ni «fallo»
    // total, que son las dos maneras de mentir aquí.
    const parcial = r.fallidos > 0 || r.reintentar > 0 || r.claimPerdido > 0;
    await registrarLatido('peajes', parcial ? 'parcial' : 'ok', { ...r });
    return NextResponse.json({ corrio: true, ...r });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const codigo = codigoDeError(e);
    logger.error('cron.peajes.fallo', { error, codigo });
    await alertarOperador('cron.peajes', { error, codigo });
    await registrarLatido('peajes', 'fallo', { error, codigo });
    return NextResponse.json({ corrio: false, error, codigo }, { status: 500 });
  }
}
