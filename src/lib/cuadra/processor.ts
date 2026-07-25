// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE ENTRANTE — el pegamento del sistema agéntico.
// Mensaje de WhatsApp → (foto? OCR → guarda gasto) → corre el agente → responde
// + manda el PDF si se cerró la liquidación.
// ═══════════════════════════════════════════════════════════════════════════

import type OpenAI from 'openai';
import '@/lib/cuadra/tools'; // side-effect: registra las tools en el registry
import { runAgent } from '@/lib/agents/run';
import { extraerComprobante } from '@/lib/cuadra/intake/ocr';
import { addGasto, getGastos } from '@/lib/cuadra/repo';
import {
  resolveOperador, getOpenViaje, getTenantContext,
  loadConversation, saveConversation, claimMessage, type ConvTurn,
} from '@/lib/cuadra/conv';
import { registrarCosto, registrarCostoWhatsApp, faseDeModelo, vincularCostosALiquidacion } from '@/lib/cuadra/costos';
import { sendText, sendDocument, downloadMediaAsDataUrl } from '@/lib/meta/client';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export interface InboundMessage {
  from: string;               // teléfono E.164
  type: 'text' | 'image' | 'document' | 'other';
  text?: string;
  mediaId?: string;           // para image/document
  waMessageId?: string;       // id de Meta, para idempotencia
}

export async function processInbound(msg: InboundMessage): Promise<void> {
  // Idempotencia: si Meta reintenta el webhook, no re-procesar (no duplicar gasto).
  if (msg.waMessageId && !(await claimMessage(msg.waMessageId))) {
    logger.info('wa.duplicate', { id: msg.waMessageId });
    return;
  }
  const op = await resolveOperador(msg.from);
  if (!op) {
    await sendText(msg.from, 'Hola, no te tengo registrado como operador. Pídele a tu flota que te dé de alta en Cuadra. 🚛');
    return;
  }
  const viajeId = await getOpenViaje(op.tenantId, op.operadorId);
  if (!viajeId) {
    await sendText(msg.from, 'No tienes un viaje abierto para liquidar ahorita. Cuando tu flota te asigne uno, aquí lo cerramos. 👍');
    return;
  }
  // Helper: enviar + contar el costo (solo mensajes SALIENTES se cobran).
  const say = async (text: string) => {
    await sendText(msg.from, text);
    await registrarCostoWhatsApp(op.tenantId, viajeId);
  };

  // ── IMAGEN: captura SILENCIOSA (acuse consolidado, no por foto) ─────────────
  // Los mensajes entrantes son gratis; para no gastar salientes ni llamadas LLM
  // por cada foto, se guarda el gasto en silencio y se responde una sola vez en
  // el turno de texto ("listo").
  if (msg.type === 'image' && msg.mediaId) {
    const dataUrl = await downloadMediaAsDataUrl(msg.mediaId);
    if (!dataUrl) { await say('No pude descargar tu foto 😕. ¿Me la reenvías?'); return; }
    try {
      const previos = await getGastos(viajeId, op.tenantId);
      const { gasto, legible, costo } = await extraerComprobante(dataUrl);
      await registrarCosto({ tenantId: op.tenantId, viajeId, fase: 'ocr', modelo: costo.modelo, tokensIn: costo.tokensIn, tokensOut: costo.tokensOut, costoUsd: costo.costoUsd });
      if (!legible) { await say('Esa foto salió difícil de leer 🔍. ¿Me la reenvías con buena luz y completo el ticket?'); return; }
      await addGasto(op.tenantId, viajeId, gasto);
      // Solo el PRIMER comprobante recibe acuse; el resto, en silencio.
      if (previos.length === 0) {
        await say('📸 Voy recibiendo tus comprobantes. Mándalos todos y cuando termines escribe *listo* para cerrar tu liquidación. 🚛');
      }
    } catch (e) {
      logger.error('ocr.fail', { err: e instanceof Error ? e.message : String(e) });
      await say('Tuve un problema leyendo tu comprobante 😕. ¿Me lo reenvías?');
    }
    return; // no corre el agente por foto
  }

  // ── TEXTO: corre el agente UNA vez → respuesta consolidada ──────────────────
  if (!(msg.type === 'text' && msg.text)) {
    await say('Por ahora solo proceso texto y fotos de comprobantes. Mándame la foto de tu ticket. 📸');
    return;
  }

  const tenant = await getTenantContext(op.tenantId);
  const conv = await loadConversation(op.tenantId, msg.from, viajeId);
  const turns: ConvTurn[] = [...conv.turns, { role: 'user', content: msg.text }];
  const history: OpenAI.Chat.ChatCompletionMessageParam[] = turns.map((t) => ({ role: t.role, content: t.content }));

  let reply = '';
  let closed = false;
  try {
    const res = await runAgent({
      agent: 'liquidacion',
      tenant,
      ctx: { tenantId: op.tenantId, operadorId: op.operadorId, viajeId, telefono: msg.from, conversationId: conv.id },
      history,
      timeoutMs: 40_000,
    });
    reply = res.finalText || 'Listo. 👍';
    closed = res.toolCalls.some((t) => t.toolName === 'guardar_liquidacion' && !t.error);
    await registrarCosto({ tenantId: op.tenantId, viajeId, fase: faseDeModelo(res.model, 'cuadre'), modelo: res.model, tokensIn: res.tokensIn, tokensOut: res.tokensOut, costoUsd: res.costUsd });
    if (closed) {
      const call = res.toolCalls.find((t) => t.toolName === 'guardar_liquidacion' && !t.error);
      const liqId = (call?.result as { liquidacion_id?: string } | undefined)?.liquidacion_id;
      if (liqId) await vincularCostosALiquidacion(op.tenantId, viajeId, liqId);
    }
    logger.info('agent.run', { tenant: op.tenantId, viaje: viajeId, tools: res.toolCalls.map((t) => t.toolName), costUsd: res.costUsd });
  } catch (e) {
    logger.error('agent.fail', { err: e instanceof Error ? e.message : String(e) });
    reply = 'Perdón, se me trabó el sistema tantito. ¿Me reenvías tu último mensaje?';
  }

  await say(reply);

  if (closed) {
    try {
      const path = `${op.tenantId}/${viajeId}.pdf`;
      const { data } = await supabaseAdmin().storage.from('liquidaciones').createSignedUrl(path, 3600);
      if (data?.signedUrl) {
        await sendDocument(msg.from, data.signedUrl, 'liquidacion.pdf', 'Aquí está tu liquidación 📄');
        await registrarCostoWhatsApp(op.tenantId, viajeId);
      }
    } catch (e) {
      logger.warn('pdf.send', { err: e instanceof Error ? e.message : String(e) });
    }
  }

  await saveConversation(conv.id, [...turns, { role: 'assistant', content: reply }], closed ? null : viajeId);
}
