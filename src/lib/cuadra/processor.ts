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
import { avisoSimplificado, versionAviso, pideAtencionPrivacidad, respuestaPrivacidad } from '@/lib/cuadra/privacidad';
import { violaIndice } from '@/lib/cuadra/pg_errores';
import { crearPresupuesto, PRESUPUESTO_WEBHOOK_MS } from '@/lib/cuadra/presupuesto';
import { conceptoDesdeClave } from '@/lib/cuadra/intake/concepto';
import { getConfig } from '@/lib/cuadra/config';
import { emparejarPendiente, emparejarXmlConTicket } from '@/lib/cuadra/intake/emparejar';
import { parseCfdiXml } from '@/lib/cuadra/intake/cfdi_xml';
import {
  addGasto, getGastos, updateGastoCfdiXml, saveCfdiXmlRaw, gastoExistePorHash,
  enriquecerGastoConCodigo, guardarCodigoPendiente, getCodigosPendientes, reclamarCodigoPendiente,
  getDatosResponsable, reclamarEnvioAviso,
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
    const pegado = await enriquecerGastoConCodigo(tenantId, gasto, {
      folioPortal: cod.folioPortal,
      codigoBarras: cod.codigoBarras,
      urlFacturacion: cod.urlFacturacion,
      cfdiUuid: cod.cfdiUuid,
    });
    if (!pegado) {
      // El código pendiente YA quedó reclamado y el gasto resultó tener folio: en
      // el hueco entre la lectura de arriba y este UPDATE, otra foto de la misma
      // ráfaga se lo puso. El folio de este código se pierde, y ese folio es el
      // que la oficina teclea en el portal — por eso es ERROR, no info.
      logger.error('foto.pendiente_reclamado_sin_pegar', { viaje: viajeId, gasto: gasto.id, codigo: cod.id });
      return;
    }
    logger.info('foto.pendiente_pegado', { viaje: viajeId, gasto: gasto.id });
  } catch (e) {
    logger.warn('foto.pendiente_error', { err: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Pone el aviso simplificado a disposición del operador la primera vez que
 * manda algo — y otra vez si la flota cambió su aviso (art. 15 fr. VI).
 *
 * No lanza: un fallo aquí NO puede tumbar la liquidación del operador. Pero se
 * registra como ERROR y no como warn, porque el silencio deja a la flota sin
 * poder cumplir y sin enterarse.
 */
async function ponerAvisoADisposicion(
  tenantId: string,
  operadorId: string,
  say: (t: string) => Promise<void>,
): Promise<void> {
  try {
    const datos = await getDatosResponsable(tenantId);
    if (!datos) {
      // El tenant no tiene razón social, domicilio o liga del aviso integral.
      // NO se manda un aviso a medias: uno con el responsable equivocado —o sin
      // él— no dice a quién reclamarle, que es justo para lo que sirve.
      logger.error('privacidad.tenant_sin_datos_responsable', { tenantId });
      return;
    }
    const texto = avisoSimplificado(datos);
    if (!texto) return;
    // El claim vive en SQL: el primer mensaje puede llegar por dos caminos a la
    // vez, y sin él el operador recibiría el aviso dos o tres veces seguidas.
    if (!(await reclamarEnvioAviso(tenantId, operadorId, versionAviso(texto)))) return;
    await say(texto);
    logger.info('privacidad.aviso_enviado', { tenantId, operadorId });
  } catch (e) {
    // Si la 0018 no está aplicada, las columnas no existen y esto truena.
    logger.error('privacidad.aviso_error', { err: e instanceof Error ? e.message : String(e) });
  }
}

export async function processInbound(msg: InboundMessage): Promise<void> {
  // Idempotencia: si Meta reintenta el webhook, no re-procesar (no duplicar gasto).
  if (msg.waMessageId && !(await claimMessage(msg.waMessageId))) {
    logger.info('wa.duplicate', { id: msg.waMessageId });
    return;
  }

  // ── RELOJ COMPARTIDO, desde la primera línea ─────────────────────────────
  // Las etapas de abajo pedían su tope fijo sin saber que comparten UNA
  // invocación: 20s de barrera + 12s de mutex + 40s de agente = 72s contra un
  // presupuesto de 60. Y como el webhook ya respondió 200, Meta no reintenta:
  // cuando Vercel mata la función, el operador se queda sin nada y sin rastro.
  //
  // Arranca AQUÍ y no más abajo: resolver al operador, buscar el viaje abierto y
  // mandar el aviso de privacidad también gastan, y son llamadas de red. Un
  // reloj que arranca a media función cree tener 60s cuando ya se fueron varios.
  const reloj = crearPresupuesto(PRESUPUESTO_WEBHOOK_MS);

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

    // ── Aviso de privacidad, una vez por operador (LFPDPPP art. 16 fr. II) ────
    // Va aquí y no antes: es donde empieza el tratamiento que el aviso describe
    // —fotos de comprobantes, montos, fechas—. El teléfono ya lo tenía la flota
    // desde el alta, y ese tratamiento previo es suyo, fuera de este canal.
    //
    // El obligado es el RESPONSABLE, o sea la flota. Likida solo pone el
    // mecanismo: sin él la flota no puede cumplir aunque quiera.
    await ponerAvisoADisposicion(op.tenantId, op.operadorId, say);

    // ── El medio ARCO que el aviso prometió ──────────────────────────────────
    // Determinístico y ANTES del agente. Si el aviso dice que escribiendo
    // PRIVACIDAD se le atiende, tiene que atenderse SIEMPRE — no casi siempre,
    // que es lo único que puede garantizar un LLM. Un medio del art. 15 fr. IV
    // que a veces no responde no se ofreció: se anunció.
    if (msg.type === 'text' && msg.text && pideAtencionPrivacidad(msg.text)) {
      try {
        const datos = await getDatosResponsable(op.tenantId);
        if (datos) {
          await say(respuestaPrivacidad(datos));
          // Rastro para la flota: es ELLA quien tiene que resolver el ARCO.
          logger.info('privacidad.solicitud_operador', { tenantId: op.tenantId, operadorId: op.operadorId });
          return;
        }
        // Sin datos del responsable no se puede decir a quién reclamarle, y
        // mandarlo al agente lo dejaría sin respuesta. Se le dice la verdad.
        logger.error('privacidad.solicitud_sin_datos_responsable', { tenantId: op.tenantId });
        await say('Déjame checarlo con la empresa y te confirmo por aquí. 🙏');
        return;
      } catch (e) {
        logger.error('privacidad.solicitud_error', { err: e instanceof Error ? e.message : String(e) });
      }
    }

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
            try {
              const pegado = await enriquecerGastoConCodigo(op.tenantId, destino, {
                folioPortal: extra.folioPortal as string | undefined,
                codigoBarras: extra.codigoBarras as string | undefined,
                urlFacturacion: extra.urlFacturacion as string | undefined,
                cfdiUuid: gasto.cfdiUuid,
              });
              // false = ese gasto ya tenía su acercamiento. No es un error: es
              // el claim haciendo su trabajo (dos acercamientos del mismo total,
              // o el mismo reenviado). El primero se queda, que es lo correcto.
              logger.info(pegado ? 'foto.acercamiento_pegado' : 'foto.acercamiento_ya_tenia',
                { viaje: viajeId, gasto: destino.id });
            } catch (e) {
              // Si la 0017 no está aplicada, el RPC no existe. Dejarlo salir
              // tumbaría el procesamiento y Meta reintentaría el webhook en
              // bucle. Se pierde el folio del acercamiento (grave, por eso
              // ERROR) pero el gasto ya está registrado con su monto.
              logger.error('foto.acercamiento_error', { err: e instanceof Error ? e.message : String(e) });
            }
          }
          return; // silencioso: el acuse de la ráfaga ya se dio con la 1ª foto
        }
        try {
          await addGasto(op.tenantId, viajeId, imgHash ? { ...gasto, imgHash } : gasto);
        } catch (e) {
          // R1: dos fotos IDÉNTICAS en el mismo lote pasan el pre-check antes de
          // que cualquiera inserte; el índice único (mig. 0015) atrapa la 2ª con
          // 23505 → es un duplicado benigno, no un error. Se ignora en silencio.
          if (imgHash && violaIndice(e, 'uq_gasto_img_hash')) {
            logger.info('foto.dedup_race', { viaje: viajeId });
            return;
          }
          // Mismo CFDI llegando dos veces (mig. 0019). También benigno: el gasto
          // ya está registrado con ese UUID, así que el comprobante no se pierde
          // — lo que se evita es contarlo dos veces. Dejarlo salir tumbaría el
          // procesamiento y Meta reintentaría el webhook en bucle.
          if (violaIndice(e, 'uq_gasto_cfdi_uuid')) {
            logger.info('foto.cfdi_ya_registrado', { viaje: viajeId, uuid: gasto.cfdiUuid });
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
      // 1) Por UUID: el gasto ya venía de un CFDI (foto con QR fiscal legible).
      let match = gastos.find((x) => x.cfdiUuid && x.cfdiUuid.toLowerCase() === xml.uuid);
      let eraTicket = false;
      if (!match) {
        // 2) Por monto y fecha, contra los TICKETS sin timbrar. Es el caso normal:
        // un ticket de gasolinera NO trae UUID, así que buscar solo por UUID no
        // encontraba nada y se creaba un SEGUNDO gasto — el mismo consumo contado
        // dos veces, con su IVA y su IEPS encima. Un unique(cfdi_uuid) no lo
        // arregla: el del ticket es NULL y NULL no colisiona.
        const porTicket = emparejarXmlConTicket({ total: xml.total, fecha: xml.fecha }, gastos);
        if (porTicket) { match = porTicket; eraTicket = true; }
      }
      let gastoId: string;
      if (match) {
        // Ya existía el gasto: se enriquece con el XML. Si era un ticket, el XML
        // además le aporta UUID, RFC, monto y fecha, que son autoritativos.
        await updateGastoCfdiXml(op.tenantId, match.id, eraTicket
          ? { ...xml, uuid: xml.uuid, rfcEmisor: xml.rfcEmisor, rfcReceptor: xml.rfcReceptor, total: xml.total, fecha: xml.fecha }
          : xml);
        if (eraTicket) logger.info('xml.pegado_a_ticket', { viaje: viajeId, gasto: match.id });
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
    // cuadrar — así "listo" nunca cierra sobre datos parciales. NUNCA es infinito:
    // si vence, se cuadra con lo que haya y se avisa al operador.
    const intakeOk = await esperarIntake(viajeId, reloj.acotar(20_000));
    if (!intakeOk) logger.warn('intake.barrera_timeout', { viaje: viajeId, restanteMs: reloj.restante() });

    // Mutex para serializar cierres concurrentes (dos "listo" a la vez).
    if (await acquireViajeLock(viajeId, { maxWaitMs: reloj.acotar(12_000) })) lockedViaje = viajeId;
    else logger.warn('viaje.lock_timeout', { viaje: viajeId, restanteMs: reloj.restante() });

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

    // ── ¿ALCANZA PARA EL AGENTE? ─────────────────────────────────────────────
    // El agente es lo caro y lo último: si la barrera y el mutex se comieron el
    // presupuesto, lanzarlo garantiza que Vercel corte a media ejecución y el
    // operador no reciba NADA.
    //
    // El motor no necesita al LLM para cuadrar. Se manda el resumen
    // determinístico —los mismos números, calculados en milisegundos— y el
    // operador se queda con una respuesta correcta en vez de con silencio.
    const COSTO_AGENTE_MS = 15_000;   // mínimo realista de un turno con tools
    if (!reloj.alcanza(COSTO_AGENTE_MS)) {
      logger.error('agente.sin_presupuesto', { viaje: viajeId, gastadoMs: reloj.gastado(), restanteMs: reloj.restante() });
      try {
        const liq = await cuadrarDesdeDB(op.tenantId, viajeId);
        await say(resumenCuadre(liq, false, 'operador'));
      } catch (e) {
        logger.error('agente.sin_presupuesto_fallback', { err: e instanceof Error ? e.message : String(e) });
        await say('Ya tengo tus comprobantes 👍. Dame un momento y te paso el cuadre.');
      }
      return;
    }

    try {
      const res = await runAgent({
        agent: 'liquidacion',
        tenant,
        ctx: { tenantId: op.tenantId, operadorId: op.operadorId, viajeId, telefono: msg.from, conversationId: conv.id },
        history,
        timeoutMs: reloj.acotar(40_000),
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
          // Va por WhatsApp AL OPERADOR: sin veredicto fiscal (EFOS, cancelado,
          // RFC receptor). Eso es del contralor; al operador se le pide lo que falta.
          reply = resumenCuadre(await cuadrarDesdeDB(op.tenantId, viajeId), true, 'operador');
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
