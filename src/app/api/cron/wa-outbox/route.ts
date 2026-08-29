import { NextResponse } from 'next/server';
import { puertaCron, registrarLatido } from '@/lib/admin/salud';
import { reclamarSalidasWhatsApp, finalizarSalidaWhatsApp } from '@/lib/likida/wa_outbox';
import { conPool } from '@/lib/likida/lotes';
import { leerInterruptor } from '@/lib/likida/interruptores';
import { logger } from '@/lib/logger';
import { alertarOperador } from '@/lib/observability/alerta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// RENDIMIENTO-19C2-6: medido en 155.5s reales contra los 60s declarados —
// mismo ajuste de margen que `gps/route.ts` (ver esa nota para el porqué de
// 300 y no una redistribución de fondo).
export const maxDuration = 300;

const GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * AUDITORÍA 19 (OP-19c2-3): antes de la 0189 esta llamada no distinguía "va a
 * reintentar sola" de "murió, nadie la va a volver a intentar". Un mensaje al
 * chofer o al jefe que agota sus 8 reintentos (0180) se perdía en silencio: el
 * cron seguía en verde porque procesó la fila con éxito, solo que el
 * resultado fue enterrarla. Mismo patrón que los otros cinco crons
 * (gps/escalar/purgar/facturar/wa-pendientes), que sí avisan.
 */
async function finalizarYAvisarSiMurio(s: Awaited<ReturnType<typeof reclamarSalidasWhatsApp>>[number], messageId?: string, error?: string): Promise<void> {
  const { muerta } = await finalizarSalidaWhatsApp(s, messageId, error);
  if (muerta) {
    await alertarOperador('cron.wa_outbox', {
      error: `Un mensaje de WhatsApp agotó sus reintentos y no se va a volver a enviar: ${error ?? 'sin detalle'}`,
      codigo: 'salida_muerta',
    });
  }
}

/** Drena el outbox durable. Solo reintenta la misma carga serializada; el
 * lease hace que dos crons solapados no la envíen simultáneamente. */
export async function GET(req: Request) {
  const puerta = await puertaCron('wa-outbox', req, 'El outbox de WhatsApp no se drena sin CRON_SECRET.');
  if (puerta) return puerta;

  // AUDITORÍA 19, BACK-19-1 (CRÍTICO): este cron era el ÚNICO que no
  // preguntaba por la palanca, y es el que de verdad manda — no encola,
  // hace POST a graph.facebook.com. Con el kill switch abajo, `wa-pendientes`
  // dejaba de encolar y este seguía vaciando a teléfonos reales lo que ya
  // estaba dentro, cada minuto. La compuerta va ANTES de reclamar: un lease
  // tomado con el sistema apagado secuestra la salida hasta que expire.
  // Mismo contrato que `wa-pendientes`, palabra por palabra — dos formas de
  // obedecer la misma palanca es una palanca que no se puede razonar.
  const global = await leerInterruptor('global');
  if (global === 'ilegible') {
    // El latido ANTES del 500 (tableros al día, 28-ago-2026): sin él este
    // camino era mudo y el tablero decía «No late» sin la causa.
    await registrarLatido('wa-outbox', 'fallo', { codigo: 'interruptor_ilegible' });
    return NextResponse.json({
      corrio: false,
      error: 'No se pudo leer el interruptor global: el outbox no se drena sin saber si está apagado.',
      codigo: 'interruptor_ilegible',
      interruptor: 'global',
    }, { status: 500 });
  }
  if (global === 'apagado') {
    logger.warn('cron.wa_outbox.saltado', { interruptor: 'global' });
    // Sin este latido, el apagado deliberado se pintaba como cron muerto y
    // /api/health alertaba al operador por su propia decisión.
    await registrarLatido('wa-outbox', 'saltado', { interruptor: 'global' });
    return NextResponse.json({ corrio: false, saltado: 'interruptor global' });
  }

  try {
    const salidas = await reclamarSalidasWhatsApp();
    let enviadas = 0;
    let fallidas = 0;
    await conPool(salidas, 4, async (s) => {
      const token = process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      if (!token || !phoneId) {
        fallidas++;
        await finalizarYAvisarSiMurio(s, undefined, 'canal de WhatsApp no configurado');
        return;
      }
      try {
        const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(s.payload), signal: AbortSignal.timeout(10_000),
        });
        const body = await r.text();
        if (!r.ok) {
          fallidas++;
          await finalizarYAvisarSiMurio(s, undefined, `HTTP ${r.status}: ${body.slice(0, 300)}`);
          return;
        }
        let id: string | undefined;
        try { id = (JSON.parse(body) as { messages?: Array<{ id?: string }> }).messages?.[0]?.id; } catch { /* no wamid */ }
        if (!id) { fallidas++; await finalizarYAvisarSiMurio(s, undefined, 'Meta aceptó sin wamid'); return; }
        enviadas++;
        await finalizarSalidaWhatsApp(s, id);
      } catch (e) {
        fallidas++;
        await finalizarYAvisarSiMurio(s, undefined, e instanceof Error ? e.message : String(e));
      }
    });
    await registrarLatido('wa-outbox', fallidas ? 'parcial' : 'ok', { enviadas, fallidas });
    return NextResponse.json({ corrio: true, tomadas: salidas.length, enviadas, fallidas }, { status: fallidas ? 500 : 200 });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error('cron.wa_outbox.fallo', { error });
    await registrarLatido('wa-outbox', 'fallo', {});
    return NextResponse.json({ error }, { status: 500 });
  }
}
