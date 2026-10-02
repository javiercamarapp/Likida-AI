import { NextResponse } from 'next/server';
import { procesarColaPeajes } from '@/lib/likida/peajes/ingesta';
import { ejecutarPulls, type ResumenPulls } from '@/lib/likida/peajes/pull';
import { reintentarAvisosPeajes, type ResumenAvisos } from '@/lib/likida/peajes/aviso_oficina';
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
// Además (0563): PRIMERO consulta los endpoints de las flotas con pull activo
// (`peajes/pull.ts`: lo que traiga entra a la misma cola) y AL FINAL barre los avisos
// a la oficina que quedaron por enviar. Ninguno de los dos tumba la corrida: un pull o un
// aviso que falla se dice en el cuerpo y en el latido (`parcial`), la cola se procesa igual.
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
    // 1. El pull: lo que traiga se encola y lo toma el paso 2 en esta misma corrida.
    let pulls: ResumenPulls | null = null;
    try { pulls = await ejecutarPulls({ limite: 3, venceEn: Date.now() + 40_000 }); } catch (e) {
      logger.error('cron.peajes.pull_fallo', { error: e instanceof Error ? e.message : String(e) });
    }
    // 2. La cola.
    const r = await procesarColaPeajes({ limite: 3, venceEn: Date.now() + 100_000 });
    // 3. Los avisos a la oficina que no salieron al procesar.
    let avisos: ResumenAvisos | null = null;
    try { avisos = await reintentarAvisosPeajes(5); } catch (e) {
      logger.error('cron.peajes.avisos_fallo', { error: e instanceof Error ? e.message : String(e) });
    }
    logger.info('cron.peajes.ok', { ...r, pulls, avisos });
    // `fallidos` y `reintentar` son trabajo que NO terminó bien: ni «ok» ni «fallo»
    // total, que son las dos maneras de mentir aquí. Un pull fallido o un aviso que no
    // salió tampoco es «ok».
    const parcial = r.fallidos > 0 || r.reintentar > 0 || r.claimPerdido > 0
      || (pulls?.fallidas ?? 0) > 0 || pulls === null || (avisos?.pendientes ?? 0) > 0;
    await registrarLatido('peajes', parcial ? 'parcial' : 'ok', { ...r, pulls, avisos });
    return NextResponse.json({ corrio: true, ...r, pulls, avisos });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const codigo = codigoDeError(e);
    logger.error('cron.peajes.fallo', { error, codigo });
    await alertarOperador('cron.peajes', { error, codigo });
    await registrarLatido('peajes', 'fallo', { error, codigo });
    return NextResponse.json({ corrio: false, error, codigo }, { status: 500 });
  }
}
