import { NextResponse } from 'next/server';
import { barridoVigia } from '@/lib/likida/vigia/servicio';
import { crearDepsVigia } from '@/lib/likida/vigia/deps';
import { leerInterruptor } from '@/lib/likida/interruptores';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { puertaCron, registrarLatido } from '@/lib/admin/salud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Una pasada barre ≤100 conversaciones en espera: lecturas y, a lo más, un aviso de WhatsApp por
// escalamiento nuevo. Segundos, no minutos; el reloj de abajo corta antes de los 60 s.
export const maxDuration = 60;

// ═══════════════════════════════════════════════════════════════════════════
// EL BARRIDO DEL VIGÍA DE SERVICIO AL CLIENTE (0400).
//
// Cada 5 minutos, SIN modelo:
//   · mide el tiempo que cada cliente lleva sin respuesta contra el SLA de SU flota
//     y escala por niveles (1: gerente responsable, 2: dueño), una sola vez por
//     ciclo (sello en `vigia_evento.clave`);
//   · sube la molestia por el tiempo aunque el cliente no vuelva a escribir;
//   · marca como fallidos los «aprobados» que se quedaron sin enviar (no se
//     reenvían a ciegas: podrían haber salido);
//   · corre la retención (`vigia_purgar`).
//
// Respeta la palanca `global` y falla CERRADO si no puede leerla, igual que sus
// hermanos. No tiene palanca propia: cada flota enciende o apaga el agente en
// `vigia_config.habilitado` (apagado por omisión) y el barrido solo mira las
// encendidas.
// ═══════════════════════════════════════════════════════════════════════════

/** El barrido corta antes de que Vercel mate la función (la ruta no escribiría latido). */
const MARGEN_MS = 12_000;

export async function GET(req: Request) {
  const inicio = Date.now();
  const puerta = await puertaCron('vigia', req, 'El barrido del Vigía no corre sin él.');
  if (puerta) return puerta;

  const global = await leerInterruptor('global');
  if (global === 'ilegible') {
    await registrarLatido('vigia', 'fallo', { codigo: 'interruptor_ilegible' });
    return NextResponse.json({
      corrio: false,
      error: 'No se pudo leer el interruptor global: no se corre sin saber si está apagado.',
      codigo: 'interruptor_ilegible', interruptor: 'global',
    }, { status: 500 });
  }
  if (global === 'apagado') {
    logger.warn('cron.vigia.saltado', { interruptor: 'global' });
    await registrarLatido('vigia', 'saltado', { interruptor: 'global' });
    return NextResponse.json({ corrio: false, saltado: 'interruptor global' });
  }

  try {
    const r = await barridoVigia(crearDepsVigia(), { vencePorReloj: inicio + maxDuration * 1000 - MARGEN_MS });
    logger.info('cron.vigia.ok', { ...r });
    // Trabajo que NO terminó (corte por reloj, envíos fallidos, atorados) no es «ok» limpio.
    const parcial = r.cortadoPorReloj || r.fallosEnvio > 0 || r.atorados > 0;
    await registrarLatido('vigia', parcial ? 'parcial' : 'ok', { ...r });
    return NextResponse.json({ corrio: true, ...r });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const codigo = codigoDeError(e);
    logger.error('cron.vigia.fallo', { error, codigo });
    await alertarOperador('cron.vigia', { error, codigo });
    await registrarLatido('vigia', 'fallo', { error, codigo });
    return NextResponse.json({ corrio: false, error, codigo }, { status: 500 });
  }
}
