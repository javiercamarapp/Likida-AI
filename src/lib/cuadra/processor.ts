// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE ENTRANTE — el pegamento del sistema agéntico.
// Mensaje de WhatsApp → (foto? OCR → guarda gasto) → corre el agente → responde
// + manda el PDF si se cerró la liquidación.
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'crypto';
import type OpenAI from 'openai';
import '@/lib/cuadra/tools'; // side-effect: registra las tools en el registry
import { runAgent } from '@/lib/agents/run';
import { guardiaCifras } from '@/lib/cuadra/cuadre/guardia';
import type { ToolCallRecord } from '@/lib/llm/openrouter';
import { extraerComprobante } from '@/lib/cuadra/intake/ocr';
import { parseCfdiXml } from '@/lib/cuadra/intake/cfdi_xml';
import { addGasto, getGastos, updateGastoCfdiXml, saveCfdiXmlRaw } from '@/lib/cuadra/repo';
import {
  resolveOperador, getOpenViaje, getTenantContext,
  loadConversation, saveConversation, claimMessage,
  acquireViajeLock, releaseViajeLock, releaseMessageClaim,
  intakeDelta, esperarIntake, type ConvTurn,
} from '@/lib/cuadra/conv';
import { registrarCosto, registrarCostoWhatsApp, faseDeModelo, vincularCostosALiquidacion } from '@/lib/cuadra/costos';
import { sendText, sendDocument, downloadMediaAsDataUrl, downloadMediaAsText } from '@/lib/meta/client';
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

  let lockedViaje: string | null = null;
  try {
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

    // ── IMAGEN: captura SILENCIOSA en PARALELO (acuse consolidado) ────────────
    // Las fotos NO toman el mutex: corren en paralelo (rápido). Cada una hace +1
    // al contador de intake al entrar y -1 al salir; el "listo" espera a que ese
    // contador llegue a 0 antes de cuadrar → nunca cierra sobre datos parciales.
    if (msg.type === 'image' && msg.mediaId) {
      const enVuelo = await intakeDelta(viajeId, 1); // n===1 → soy la primera de la ráfaga
      try {
        const dataUrl = await downloadMediaAsDataUrl(msg.mediaId);
        if (!dataUrl) { await say('No pude descargar tu foto 😕. ¿Me la reenvías?'); return; }
        const { gasto, legible, costo } = await extraerComprobante(dataUrl);
        await registrarCosto({ tenantId: op.tenantId, viajeId, fase: 'ocr', modelo: costo.modelo, tokensIn: costo.tokensIn, tokensOut: costo.tokensOut, costoUsd: costo.costoUsd });
        if (!legible) { await say('Esa foto salió difícil de leer 🔍. ¿Me la reenvías con buena luz y completo el ticket?'); return; }
        await addGasto(op.tenantId, viajeId, gasto);
        // Acuse una sola vez: solo la PRIMERA foto de la ráfaga (la que llevó el
        // contador de 0 a 1). En su propio try: un fallo de envío tras guardar el
        // gasto NO debe disparar reproceso.
        if (enVuelo === 1) {
          try {
            await say('📸 Voy recibiendo tus comprobantes. Mándalos todos y cuando termines escribe *listo* para cerrar tu liquidación. 🚛');
          } catch (e) {
            logger.warn('ack.send', { err: e instanceof Error ? e.message : String(e) });
          }
        }
      } finally {
        await intakeDelta(viajeId, -1); // libera el contador pase lo que pase
      }
      return; // no corre el agente por foto
    }

    // ── DOCUMENTO: XML del CFDI (NIVEL 2 del complemento de hidrocarburos) ────
    // El operador/oficina reenvía el XML que la gasolinera manda por correo. NO
    // requiere e.firma ni portales. Silencioso (acuse consolidado): la validación
    // se refleja en el cuadre al cerrar.
    if (msg.type === 'document' && msg.mediaId) {
      const xmlText = await downloadMediaAsText(msg.mediaId);
      const xml = xmlText ? parseCfdiXml(xmlText) : null;
      if (!xml || !xml.uuid) {
        await say('Recibí un documento, pero necesito el *XML* del CFDI (el archivo .xml que te manda la gasolinera por correo), no el PDF. ¿Me lo reenvías? 📎');
        return;
      }
      const gastos = await getGastos(viajeId, op.tenantId);
      const match = gastos.find((x) => x.cfdiUuid && x.cfdiUuid.toLowerCase() === xml.uuid);
      let gastoId: string;
      if (match) {
        // Ya existía el gasto (de la foto): se enriquece con el XML.
        await updateGastoCfdiXml(op.tenantId, match.id, xml);
        gastoId = match.id;
      } else {
        // El XML llegó sin foto previa: se crea el gasto desde el XML.
        const esFuel = (xml.claveProdServ ?? '').startsWith('15101');
        gastoId = randomUUID();
        await addGasto(op.tenantId, viajeId, {
          id: gastoId,
          concepto: esFuel ? 'diesel' : 'factura',
          monto: xml.total ?? 0,
          fecha: xml.fecha,
          rfcEmisor: xml.rfcEmisor,
          rfcReceptor: xml.rfcReceptor,
          cfdiUuid: xml.uuid,
          claveProdServ: xml.claveProdServ,
          claveUnidad: xml.claveUnidad,
          tipoComprobante: xml.tipoComprobante,
          complementoHidrocarburos: xml.complementoHidrocarburos,
          cfdiEsquemaAlterno: xml.esquemaAlterno,
          formaPago: xml.formaPago,
          subTotal: xml.subTotal,
          iepsTraslado: xml.iepsTraslado,
          ivaTraslado: xml.ivaTraslado,
          xmlVerificado: true,
        });
      }
      // 1.8: conservar el XML crudo (CFF 30). Best-effort.
      await saveCfdiXmlRaw(op.tenantId, xml.uuid, gastoId, xmlText!);
      return; // silencioso
    }

    // ── TEXTO: corre el agente UNA vez → respuesta consolidada ───────────────
    if (!(msg.type === 'text' && msg.text)) {
      await say('Por ahora solo proceso texto, fotos de comprobantes y el XML del CFDI. Mándame la foto de tu ticket o el XML. 📸');
      return;
    }

    // BARRERA DE RÁFAGA: espera a que terminen los OCR de fotos en vuelo antes de
    // cuadrar — así "listo" nunca cierra sobre datos parciales. NUNCA es infinito
    // (tope 60s): si vence, se cuadra con lo que haya y se avisa al operador.
    const intakeOk = await esperarIntake(viajeId);
    if (!intakeOk) logger.warn('intake.barrera_timeout', { viaje: viajeId });

    // Mutex para serializar cierres concurrentes (dos "listo" a la vez).
    if (await acquireViajeLock(viajeId)) lockedViaje = viajeId;
    else logger.warn('viaje.lock_timeout', { viaje: viajeId });

    // Doble "listo": tras tomar el lock, re-verifica que el viaje SIGA abierto. Si
    // otro "listo" ya lo cerró, no re-corras el agente (evita doble cuadre/costo).
    if ((await getOpenViaje(op.tenantId, op.operadorId)) !== viajeId) {
      await say('Ese viaje ya quedó cerrado 👍. Si te falta algo, tu flota te abre el siguiente.');
      return;
    }

    const tenant = await getTenantContext(op.tenantId);
    const conv = await loadConversation(op.tenantId, msg.from, viajeId);
    const turns: ConvTurn[] = [...conv.turns, { role: 'user', content: msg.text }];
    const history: OpenAI.Chat.ChatCompletionMessageParam[] = turns.map((t) => ({ role: t.role, content: t.content }));

    let reply = '';
    let closed = false;
    let agentTools: ToolCallRecord[] = [];
    try {
      const res = await runAgent({
        agent: 'liquidacion',
        tenant,
        ctx: { tenantId: op.tenantId, operadorId: op.operadorId, viajeId, telefono: msg.from, conversationId: conv.id },
        history,
        timeoutMs: 40_000,
      });
      reply = res.finalText || 'Listo. 👍';
      agentTools = res.toolCalls;
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

    // GUARDIA DETERMINÍSTICA (código, no prompt): el LLM NUNCA reporta cifras que
    // no vengan de una tool. Si la respuesta trae dinero y no hubo cuadrar_viaje,
    // se descarta el texto del modelo y se responde con el cuadre REAL. (f/g)
    try {
      const g = await guardiaCifras(reply, agentTools, op.tenantId, viajeId);
      if (g.forzado) { logger.warn('agent.cifras_forzadas', { viaje: viajeId }); reply = g.reply; }
    } catch (e) {
      logger.warn('guardia.fail', { err: e instanceof Error ? e.message : String(e) });
    }

    await say(reply);

    // Si la barrera de intake venció (un OCR tardó demasiado), avisa que se
    // cuadró con lo que alcanzó — falla visible, no silenciosa.
    if (!intakeOk) {
      const n = (await getGastos(viajeId, op.tenantId)).length;
      try {
        await say(`⚠️ Ojo: cuadré con los ${n} comprobantes que alcancé a procesar. Si te faltó alguno, reenvíalo y escribe *listo* otra vez.`);
      } catch (e) {
        logger.warn('intake.aviso', { err: e instanceof Error ? e.message : String(e) });
      }
    }

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
  } catch (e) {
    // CR-2: si el procesamiento crashea, liberar el claim para que el retry de
    // Meta lo reprocese (at-least-once). El OCR/agente ya tienen sus propios
    // catch; esto atrapa lo inesperado (descarga, DB, red) antes de perder dinero.
    logger.error('processInbound.fail', { id: msg.waMessageId, err: e instanceof Error ? e.message : String(e) });
    if (msg.waMessageId) await releaseMessageClaim(msg.waMessageId);
    try { await sendText(msg.from, 'Perdón, se me trabó tantito. ¿Me reenvías tu último mensaje? 🙏'); } catch { /* best-effort */ }
  } finally {
    if (lockedViaje) await releaseViajeLock(lockedViaje);
  }
}
