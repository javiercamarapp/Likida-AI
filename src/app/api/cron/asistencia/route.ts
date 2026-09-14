import { NextResponse } from 'next/server';
import { escalarAsistenciasPendientes } from '@/lib/likida/asistencia_escalamiento';
import { leerInterruptor } from '@/lib/likida/interruptores';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { puertaCron, registrarLatido } from '@/lib/admin/salud';
import { margenUnidadAtomicaMs } from '@/lib/likida/presupuesto';

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
    // El latido ANTES del 500 (tableros al día, 28-ago-2026): sin él este
    // camino era mudo y el tablero decía «No late» sin la causa.
    await registrarLatido('asistencia', 'fallo', { codigo: 'interruptor_ilegible' });
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

  // REN-31-C1 (auditoría 31): el margen era el literal `15` y la unidad que
  // este cron despacha vale 91.5 s. `escalarUna` escribe el claim
  // (`nivel_escalado = objetivo`) ANTES de mandar el WhatsApp, y el barrido
  // siguiente filtra `.lt('nivel_escalado', NIVEL_MAXIMO)`: una escalada
  // admitida a 1 s de `venceEn` moría a mitad de camino con el claim ya
  // quemado, y la emergencia desaparecía del barrido para siempre — sin
  // `sendButtons`, sin `alertarOperador` y sin fila de bitácora que dijera que
  // el aviso no salió. Es REN-A4/REN-A5 de la 28 otra vez: el margen se DERIVA
  // de los techos de la cadena real (7 consultas + 2 envíos, contados paso por
  // paso en `route.test.ts`), nunca se teclea.
  //
  // El precio, declarado: la ventana para admitir trabajo baja a ~28.5 s de
  // los 120. Lo que no entra sale en `cortadosPorReloj` y lo toma la corrida
  // de 5 minutos después — que es el contrato que el comentario de arriba ya
  // declaraba. Una emergencia atendida un ciclo tarde se recupera; una que se
  // perdió del barrido, no.
  const MARGEN_MS = margenUnidadAtomicaMs({ consultas: 7, envios: 2 });
  const venceEn = Date.now() + maxDuration * 1000 - MARGEN_MS;
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
