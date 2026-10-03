import { NextResponse } from 'next/server';
import { correrAlertasTope } from '@/lib/likida/jornada/alerta_tope';
import { puertosAlertaReales } from '@/lib/likida/jornada/alerta_tope_datos';
import { leerInterruptor, type NombreInterruptor } from '@/lib/likida/interruptores';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { puertaCron, registrarLatido, type EstadoLatido } from '@/lib/admin/salud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Una pasada lee las jornadas en curso de las flotas con la alerta encendida y manda
// a lo más un par de mensajes por jornada que cruzó un umbral; cada envío a Meta tiene
// techo de 10 s. El reloj corta ANTES de reclamar la siguiente.
export const maxDuration = 60;
const MARGEN_MS = 12_000;

// ═══════════════════════════════════════════════════════════════════════════
// EL CRON DE LA ALERTA DE TOPE DE JORNADA (0502, Agente 12).
//
// Cada 15 minutos: con el 80 % de un tope de 12 h (9.6 h) a una hora de cron, el aviso
// llegaría hasta una hora tarde; a 15 minutos, el retraso máximo es el de la cadencia.
// Es un cron PROPIO y no parte de `jornada`: aquel es un motor de escritura interna sin
// mensajes y este le ESCRIBE A PERSONAS (encargado y operador), así que hereda las
// reglas de los crons que mandan WhatsApp: secreto o 401/500, palanca global fail-closed
// (ilegible = no corre; apagado = saltado), claim por (jornada, nivel) y latido en TODO
// camino de salida, incluso el que lanza.
//
// Sin palanca propia a propósito (ver la cabecera de `cron/jornada`): la alerta ya se
// apaga POR FLOTA (`jornada_alerta_config.activa`, apagada por omisión) y reescribir el
// catálogo de interruptores por un motor sin modelo es el riesgo que la 0227 ya pagó.
// ═══════════════════════════════════════════════════════════════════════════

function ilegible(interruptor: NombreInterruptor) {
  return {
    corrio: false,
    error: `No se pudo leer el interruptor ${interruptor}: no se corre sin saber si está apagado.`,
    codigo: 'interruptor_ilegible',
    interruptor,
  };
}

export async function GET(req: Request) {
  const puerta = await puertaCron('jornada-alertas', req, 'La alerta de tope de jornada no corre sin él.');
  if (puerta) return puerta;

  const global = await leerInterruptor('global');
  if (global === 'ilegible') {
    await registrarLatido('jornada-alertas', 'fallo', { codigo: 'interruptor_ilegible' });
    return NextResponse.json(ilegible('global'), { status: 500 });
  }
  if (global === 'apagado') {
    logger.warn('cron.jornada_alertas.saltado', { interruptor: 'global' });
    await registrarLatido('jornada-alertas', 'saltado', { interruptor: 'global' });
    return NextResponse.json({ corrio: false, saltado: 'interruptor global' });
  }

  let latido: { estado: EstadoLatido; detalle: Record<string, unknown> } = { estado: 'fallo', detalle: { codigo: 'corrida_sin_cerrar' } };
  try {
    const venceEn = Date.now() + (maxDuration * 1000) - MARGEN_MS;
    const r = await correrAlertasTope(puertosAlertaReales, { venceEn });
    logger.info('cron.jornada_alertas.ok', { ...r, fallos: r.fallos.length });
    const huboFallo = r.fallos.length > 0;
    // `parcial` = la corrida no cerró su trabajo: corte por reloj, lista truncada, rechazo masivo, o
    // jornadas abiertas > 24 h (un cierre que nadie marcó: el tablero las muestra).
    const incompleto = r.cortadosPorReloj > 0 || r.listaTruncada || r.cortadaPorRechazoMasivo;
    latido = {
      estado: huboFallo || incompleto ? 'parcial' : 'ok',
      detalle: {
        revisadas: r.revisadas, enCurso: r.enCurso, alertas: r.alertas, yaAvisadas: r.yaAvisadas,
        sinCierreProbable: r.sinCierreProbable, inicioEnFuturo: r.inicioEnFuturo, sinDestinatario: r.sinDestinatario,
        rechazosReintentables: r.rechazosReintentables, cortadosPorReloj: r.cortadosPorReloj, listaTruncada: r.listaTruncada,
        fallos: r.fallos.length,
        motivo: r.cortadaPorRechazoMasivo ? 'WhatsApp rechazó varios avisos seguidos por un motivo reintentable; la corrida se detuvo.' : undefined,
      },
    };
    if (r.cortadaPorRechazoMasivo) {
      await alertarOperador('cron.jornada_alertas', {
        error: 'WhatsApp rechazó varios avisos de tope de jornada seguidos por un motivo reintentable (rate limit o bloqueo). La corrida se detuvo; los avisos quedaron sin reclamar.',
        codigo: 'wa_rechazo_masivo',
      });
    }
    return NextResponse.json({ corrio: true, ...r, fallos: r.fallos.slice(0, 20) });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const codigo = codigoDeError(e);
    logger.error('cron.jornada_alertas.fallo', { error, codigo });
    await alertarOperador('cron.jornada_alertas', { error, codigo });
    latido = { estado: 'fallo', detalle: { error, codigo } };
    return NextResponse.json({ corrio: false, error, codigo }, { status: 500 });
  } finally {
    await registrarLatido('jornada-alertas', latido.estado, latido.detalle);
  }
}
