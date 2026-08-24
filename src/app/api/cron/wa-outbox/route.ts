import { NextResponse } from 'next/server';
import { puertaCron, registrarLatido } from '@/lib/admin/salud';
import { reclamarSalidasWhatsApp, finalizarSalidaWhatsApp } from '@/lib/likida/wa_outbox';
import { conPool } from '@/lib/likida/lotes';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GRAPH = 'https://graph.facebook.com/v21.0';

/** Drena el outbox durable. Solo reintenta la misma carga serializada; el
 * lease hace que dos crons solapados no la envíen simultáneamente. */
export async function GET(req: Request) {
  const puerta = await puertaCron('wa-outbox', req, 'El outbox de WhatsApp no se drena sin CRON_SECRET.');
  if (puerta) return puerta;
  try {
    const salidas = await reclamarSalidasWhatsApp();
    let enviadas = 0;
    let fallidas = 0;
    await conPool(salidas, 4, async (s) => {
      const token = process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      if (!token || !phoneId) {
        fallidas++;
        await finalizarSalidaWhatsApp(s, undefined, 'canal de WhatsApp no configurado');
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
          await finalizarSalidaWhatsApp(s, undefined, `HTTP ${r.status}: ${body.slice(0, 300)}`);
          return;
        }
        let id: string | undefined;
        try { id = (JSON.parse(body) as { messages?: Array<{ id?: string }> }).messages?.[0]?.id; } catch { /* no wamid */ }
        if (!id) { fallidas++; await finalizarSalidaWhatsApp(s, undefined, 'Meta aceptó sin wamid'); return; }
        enviadas++;
        await finalizarSalidaWhatsApp(s, id);
      } catch (e) {
        fallidas++;
        await finalizarSalidaWhatsApp(s, undefined, e instanceof Error ? e.message : String(e));
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
