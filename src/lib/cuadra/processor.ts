// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE ENTRANTE — el pegamento del sistema agéntico.
// Mensaje de WhatsApp → (foto? OCR → guarda gasto) → corre el agente → responde
// + manda el PDF si se cerró la liquidación.
// ═══════════════════════════════════════════════════════════════════════════

import type OpenAI from 'openai';
import '@/lib/cuadra/tools'; // side-effect: registra las tools en el registry
import { runAgent } from '@/lib/agents/run';
import { extraerComprobante } from '@/lib/cuadra/intake/ocr';
import { addGasto } from '@/lib/cuadra/repo';
import {
  resolveOperador, getOpenViaje, getTenantContext,
  loadConversation, saveConversation, claimMessage, type ConvTurn,
} from '@/lib/cuadra/conv';
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

const mxn = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

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
  const tenant = await getTenantContext(op.tenantId);
  const conv = await loadConversation(op.tenantId, msg.from, viajeId);

  // ── Construir el turno del usuario ─────────────────────────────────────────
  let userContent: string;
  if (msg.type === 'image' && msg.mediaId) {
    const dataUrl = await downloadMediaAsDataUrl(msg.mediaId);
    if (!dataUrl) {
      await sendText(msg.from, 'No pude descargar tu foto 😕. ¿Me la reenvías?');
      return;
    }
    try {
      const { gasto, legible } = await extraerComprobante(dataUrl);
      if (!legible) {
        await sendText(msg.from, 'Esa foto salió difícil de leer 🔍. ¿Me la reenvías con buena luz y que se vea completo el ticket?');
        return;
      }
      await addGasto(op.tenantId, viajeId, gasto);
      userContent = `[Comprobante recibido y guardado — concepto: ${gasto.concepto}, monto: ${mxn(gasto.monto)}${gasto.folio ? `, folio: ${gasto.folio}` : ''}${gasto.cfdiUuid ? ', CFDI validado por QR' : ''}, confianza OCR: ${Math.round((gasto.ocrConfianza ?? 0) * 100)}%]. Confirma al operador brevemente que lo recibiste y pregunta si tiene más comprobantes o si ya cerramos.`;
    } catch (e) {
      logger.error('ocr.fail', { err: e instanceof Error ? e.message : String(e) });
      await sendText(msg.from, 'Tuve un problema leyendo tu comprobante 😕. ¿Me lo reenvías?');
      return;
    }
  } else if (msg.type === 'text' && msg.text) {
    userContent = msg.text;
  } else {
    await sendText(msg.from, 'Por ahora solo proceso texto y fotos de comprobantes. Mándame la foto de tu ticket. 📸');
    return;
  }

  const turns: ConvTurn[] = [...conv.turns, { role: 'user', content: userContent }];
  const history: OpenAI.Chat.ChatCompletionMessageParam[] = turns.map((t) => ({ role: t.role, content: t.content }));

  // ── Correr el agente ───────────────────────────────────────────────────────
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
    logger.info('agent.run', { tenant: op.tenantId, viaje: viajeId, tools: res.toolCalls.map((t) => t.toolName), costUsd: res.costUsd });
  } catch (e) {
    logger.error('agent.fail', { err: e instanceof Error ? e.message : String(e) });
    reply = 'Perdón, se me trabó el sistema tantito. ¿Me reenvías tu último mensaje?';
  }

  await sendText(msg.from, reply);

  // ── Si se cerró la liquidación, mandar el PDF ──────────────────────────────
  if (closed) {
    try {
      const path = `${op.tenantId}/${viajeId}.pdf`;
      const { data } = await supabaseAdmin().storage.from('liquidaciones').createSignedUrl(path, 3600);
      if (data?.signedUrl) await sendDocument(msg.from, data.signedUrl, 'liquidacion.pdf', 'Aquí está tu liquidación 📄');
    } catch (e) {
      logger.warn('pdf.send', { err: e instanceof Error ? e.message : String(e) });
    }
  }

  await saveConversation(conv.id, [...turns, { role: 'assistant', content: reply }], closed ? null : viajeId);
}
