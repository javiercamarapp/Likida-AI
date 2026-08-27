import { NextResponse } from 'next/server';
import { escalarAsistenciasPendientes } from '@/lib/likida/asistencia_escalamiento';
import { leerInterruptor } from '@/lib/likida/interruptores';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { puertaCron, registrarLatido } from '@/lib/admin/salud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Cada incidencia escalada son 1-2 llamadas a Meta más 2-4 lecturas cortas.
// Con el índice parcial de la 0198 la consulta es corta; el presupuesto es
// para los envíos. 120 s con margen: el corte por reloj deja el resto a la
// corrida siguiente (5 min después) y el conteo lo dice.
export const maxDuration = 120;

// ═══════════════════════════════════════════════════════════════════════════
// EL CRON DEL RELOJ MUERTO (Fase 5).
//
// El de `escalar` corre cada hora — para una emergencia no sirve: un chofer
// con un choque no puede esperar 59 minutos a que alguien note que su jefe no
// contestó. Este corre CADA 5 MINUTOS y hace una sola cosa: subir de nivel
// las incidencias de asistencia que nadie ha reconocido
// (`asistencia_escalamiento.ts` — claim monótono, ROJO ignora ventana, ámbar
// difiere fuera de horario).
//
// EL PRIMER AVISO NO ES DE ESTE CRON: sale síncrono en el turno del webhook
// (Fase 4). Este cron es el que insiste cuando ese aviso no bastó.
//
// Mismos contratos que los demás crons (RES-7 / A17 / la lección del PR #80):
// fail-closed sin secreto, kill switch global ANTES de trabajar (apagado →
// 200 saltado; ilegible → 500 con código), latido al cerrar, y un motor
// reventado responde 500 — nunca un verde de mentira.
// ═══════════════════════════════════════════════════════════════════════════

export async function GET(req: Request) {
  const puerta = await puertaCron('asistencia', req, 'El reloj de emergencias no corre sin él.');
  if (puerta) return puerta;

  const global = await leerInterruptor('global');
  if (global === 'ilegible') {
    return NextResponse.json({
      corrio: false,
      error: 'No se pudo leer el interruptor global: el escalamiento no corre sin saber si está apagado.',
      codigo: 'interruptor_ilegible',
      interruptor: 'global',
    }, { status: 500 });
  }
  if (global === 'apagado') {
    logger.warn('cron.asistencia.saltado', { interruptor: 'global' });
    await registrarLatido('asistencia', 'saltado', { interruptor: 'global' });
    return NextResponse.json({ corrio: false, saltado: 'interruptor global' });
  }

  const venceEn = Date.now() + (maxDuration - 15) * 1000;
  try {
    const r = await escalarAsistenciasPendientes(new Date(), { venceEn });
    logger.info('cron.asistencia.ok', { ...r });
    await registrarLatido(
      'asistencia',
      r.fallosAviso > 0 || r.cortadosPorReloj > 0 ? 'parcial' : 'ok',
      { escaladas: r.escaladas, diferidas: r.diferidas, fallosAviso: r.fallosAviso, cortados: r.cortadosPorReloj },
    );
    return NextResponse.json(r, { status: 200 });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const codigo = codigoDeError(e);
    logger.error('cron.asistencia.falló', { error, codigo });
    await alertarOperador('cron.asistencia', { error, codigo });
    await registrarLatido('asistencia', 'fallo', { codigo });
    return NextResponse.json({ error }, { status: 500 });
  }
}
