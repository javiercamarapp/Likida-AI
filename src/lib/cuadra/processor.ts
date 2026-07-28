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
import { cuadrarDesdeDB } from '@/lib/cuadra/cuadre/desde_db';
import { resumenCuadre } from '@/lib/cuadra/cuadre/resumen';
import { PartialExecutionError, type ToolCallRecord } from '@/lib/llm/openrouter';
import type { Gasto } from '@/types/cuadra';
import { extraerComprobante } from '@/lib/cuadra/intake/ocr';
import { hashImagen } from '@/lib/cuadra/intake/hash';
import { decidirFoto } from '@/lib/cuadra/intake/decidir';
import { conceptoDesdeClave } from '@/lib/cuadra/intake/concepto';
import { getConfig } from '@/lib/cuadra/config';
import { emparejarPendiente } from '@/lib/cuadra/intake/emparejar';
import { parseCfdiXml } from '@/lib/cuadra/intake/cfdi_xml';
import {
  addGasto, getGastos, updateGastoCfdiXml, saveCfdiXmlRaw, gastoExistePorHash,
  enriquecerGastoConCodigo, guardarCodigoPendiente, getCodigosPendientes, reclamarCodigoPendiente,
} from '@/lib/cuadra/repo';
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

/**
 * Cierra el protocolo de dos fotos por el lado contrario: acaba de entrar un
 * comprobante, y en la bandeja puede haber un acercamiento que llegó antes y
 * estaba esperando por ese total.
 *
 * BEST-EFFORT a propósito: el gasto YA está insertado. Si la bandeja falla, se
 * pierde el folio exacto —malo— pero tumbar aquí perdería el gasto entero, que
 * es peor, y encima dispararía el reproceso del webhook.
 */
async function pegarCodigoEnEspera(tenantId: string, viajeId: string, gasto: Gasto): Promise<void> {
  try {
    const extra = (gasto.ocrExtra ?? {}) as Record<string, unknown>;
    // Si esta misma foto ya traía su código no hay nada que buscar. Además
    // ahorra la consulta en el camino de siempre.
    if (extra.folioPortal || extra.codigoBarras) return;
    const bandeja = await getCodigosPendientes(viajeId, tenantId);
    if (!bandeja.length) return;
    const cod = emparejarPendiente(gasto.monto, bandeja);
    if (!cod) return;
    // Claim atómico: las fotos de una ráfaga corren en paralelo y NO toman el
    // mutex del viaje, así que dos comprobantes del mismo total pueden ir por el
    // mismo código a la vez. El que pierde no pega nada.
    if (!(await reclamarCodigoPendiente(tenantId, cod.id))) {
      logger.info('foto.pendiente_ya_tomado', { viaje: viajeId, gasto: gasto.id });
      return;
    }
    await enriquecerGastoConCodigo(tenantId, gasto, {
      folioPortal: cod.folioPortal,
      codigoBarras: cod.codigoBarras,
      urlFacturacion: cod.urlFacturacion,
      cfdiUuid: cod.cfdiUuid,
    });
    logger.info('foto.pendiente_pegado', { viaje: viajeId, gasto: gasto.id });
  } catch (e) {
    logger.warn('foto.pendiente_error', { err: e instanceof Error ? e.message : String(e) });
  }
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

        // FASE 2 (FLAG default-off): dedup por contenido. La idempotencia por
        // waMessageId cubre reintentos de Meta; esto cubre el reenvío MANUAL de la
        // misma foto (otro waMessageId). Pre-check antes del OCR → ahorra ese costo.
        // Camino actual intacto con CUADRA_DEDUP_FOTOS sin setear (HARD RULE 3).
        let imgHash: string | undefined;
        if (process.env.CUADRA_DEDUP_FOTOS === '1') {
          imgHash = await hashImagen(dataUrl);
          if (await gastoExistePorHash(viajeId, imgHash, op.tenantId)) {
            logger.info('foto.dedup', { viaje: viajeId });
            return; // ya la teníamos: no re-OCR, no duplicar gasto, sin acuse extra
          }
        }

        const extraccion = await extraerComprobante(dataUrl);
        const { gasto, costo } = extraccion;
        await registrarCosto({ tenantId: op.tenantId, viajeId, fase: 'ocr', modelo: costo.modelo, tokensIn: costo.tokensIn, tokensOut: costo.tokensOut, costoUsd: costo.costoUsd });

        // Los gastos ya registrados solo se leen cuando hay que emparejar un
        // acercamiento: en el camino normal esa consulta no se paga.
        const yaRegistrados = extraccion.motivo === 'solo_codigo' ? await getGastos(viajeId, op.tenantId) : [];
        const decision = decidirFoto(extraccion, yaRegistrados);

        // Pedir reenvío SOLO cuando reenviar arregla algo. Si el fallo fue
        // nuestro (truncamiento, provider caído), la misma foto falla igual:
        // decirle "mándala con mejor luz" lo manda a un bucle y le echa la culpa
        // de un bug nuestro.
        if (decision.accion === 'avisar_falla') {
          await say('Tuve un problema de mi lado al procesar ese comprobante ⚙️ — no es tu foto. Guarda el ticket: ese gasto NO quedó registrado y hay que capturarlo aparte.');
          return;
        }
        if (decision.accion === 'pedir_reenvio') {
          await say('Esa foto salió difícil de leer 🔍. ¿Me la reenvías con buena luz y completo el ticket?');
          return;
        }
        // Acercamiento del protocolo de dos fotos: hizo lo correcto, no se le
        // regaña. Pero un código por su cuenta NO se da de alta como gasto —
        // vale el mismo dinero que el ticket que le toca, y sumar los dos
        // inflaría la liquidación.
        if (decision.accion === 'pedir_ticket') {
          // A la BANDEJA (mig. 0016): el acercamiento llegó antes que su ticket.
          // Sin esto, el folio exacto que trae el código se perdía y el gasto se
          // quedaba con el que leyó la visión — que es justo el que baila.
          const extra = (gasto.ocrExtra ?? {}) as Record<string, unknown>;
          try {
            await guardarCodigoPendiente(op.tenantId, viajeId, {
              monto: gasto.monto,
              folioPortal: extra.folioPortal as string | undefined,
              codigoBarras: extra.codigoBarras as string | undefined,
              urlFacturacion: extra.urlFacturacion as string | undefined,
              cfdiUuid: gasto.cfdiUuid,
            });
            logger.info('foto.codigo_en_espera', { viaje: viajeId, monto: gasto.monto });
          } catch (e) {
            // Si la 0016 no está aplicada esto truena. Dejarlo salir tumbaría el
            // procesamiento de la foto y Meta reintentaría el webhook en bucle.
            // Se pierde el folio exacto (grave, por eso ERROR) pero el operador
            // igual recibe la instrucción y el gasto entra con la foto del ticket.
            logger.error('foto.codigo_en_espera_error', { err: e instanceof Error ? e.message : String(e) });
          }
          await say('Ya tengo el código de ese ticket 👍. Mándame también la foto del *ticket completo* para registrar el gasto.');
          return;
        }
        if (decision.accion === 'enriquecer') {
          const destino = yaRegistrados.find((g) => g.id === decision.gastoId);
          if (destino) {
            const extra = (gasto.ocrExtra ?? {}) as Record<string, unknown>;
            await enriquecerGastoConCodigo(op.tenantId, destino, {
              folioPortal: extra.folioPortal as string | undefined,
              codigoBarras: extra.codigoBarras as string | undefined,
              urlFacturacion: extra.urlFacturacion as string | undefined,
              cfdiUuid: gasto.cfdiUuid,
            });
            logger.info('foto.acercamiento_pegado', { viaje: viajeId, gasto: destino.id });
          }
          return; // silencioso: el acuse de la ráfaga ya se dio con la 1ª foto
        }
        try {
          await addGasto(op.tenantId, viajeId, imgHash ? { ...gasto, imgHash } : gasto);
        } catch (e) {
          // R1: dos fotos IDÉNTICAS en el mismo lote pasan el pre-check antes de
          // que cualquiera inserte; el índice único (mig. 0015) atrapa la 2ª con
          // 23505 → es un duplicado benigno, no un error. Se ignora en silencio.
          if (imgHash && (e as { code?: string }).code === '23505') {
            logger.info('foto.dedup_race', { viaje: viajeId });
            return;
          }
          throw e;
        }
        // ¿Había un acercamiento esperando por este comprobante? (el caso en que
        // el operador mandó primero el código y después el ticket).
        await pegarCodigoEnEspera(op.tenantId, viajeId, gasto);
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
        // El concepto sale de la CLAVE del SAT, no de un prefijo. Antes esto era
        // `startsWith('15101') ? 'diesel' : 'factura'`, así que toda caseta
        // timbrada entraba como 'factura' y perdía el estímulo del 50% de peaje
        // (LIF 2026 Art. 20-A), que el motor sólo aplica a `concepto === 'caseta'`.
        gastoId = randomUUID();
        const cfg = await getConfig(op.tenantId);
        await addGasto(op.tenantId, viajeId, {
          id: gastoId,
          concepto: conceptoDesdeClave(xml.claveProdServ, cfg.hidrocarburos.claves, cfg.estimulos.clavesPeaje),
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
      // AUDIT_V3 orquestación CRÍTICO (huérfano de cierre parcial): si el agente
      // YA guardó la liquidación (guardar_liquidacion OK) pero una ronda posterior
      // o el timeout tiró el ciclo, PartialExecutionError trae esas tools en
      // partialToolCalls. Sin recuperación: liquidacion persistida en DB pero el
      // operador recibe "se trabó" y NUNCA su PDF → huérfano. Se recupera tratando
      // el cierre como válido, vinculando costos y armando el resumen REAL del motor.
      // FLAG (HARD RULE 3): default off = comportamiento actual EXACTO (mensaje de
      // error, sin cierre). Se recomienda ON para el demo (ver REPORTE_NOCHE).
      const recuperar = process.env.CUADRA_RECUPERAR_CIERRE_PARCIAL === '1';
      const parcial = e instanceof PartialExecutionError ? e.partialToolCalls : null;
      const cierreParcial =
        recuperar && parcial?.find((t) => t.toolName === 'guardar_liquidacion' && !t.error);
      if (cierreParcial) {
        agentTools = parcial!;
        closed = true;
        const liqId = (cierreParcial.result as { liquidacion_id?: string } | undefined)?.liquidacion_id;
        if (liqId) {
          try { await vincularCostosALiquidacion(op.tenantId, viajeId, liqId); } catch { /* best-effort */ }
        }
        // Resumen determinístico del motor (nunca cifras del modelo). Fail-closed:
        // si no se puede recalcular, se avisa el cierre sin números (el PDF va abajo).
        try {
          reply = resumenCuadre(await cuadrarDesdeDB(op.tenantId, viajeId));
        } catch {
          reply = 'Ya cerré tu liquidación ✅. Te mando el PDF.';
        }
        logger.warn('agent.cierre_parcial_recuperado', { viaje: viajeId, liqId });
      } else {
        logger.error('agent.fail', { err: e instanceof Error ? e.message : String(e) });
        reply = 'Perdón, se me trabó el sistema tantito. ¿Me reenvías tu último mensaje?';
      }
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
