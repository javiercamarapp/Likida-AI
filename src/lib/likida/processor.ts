// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE ENTRANTE — el pegamento del sistema agéntico.
// Mensaje de WhatsApp → (foto? OCR → guarda gasto) → corre el agente → responde
// + manda el PDF si se cerró la liquidación.
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'crypto';
import type OpenAI from 'openai';
import '@/lib/likida/tools'; // side-effect: registra las tools en el registry
import { runAgent } from '@/lib/agents/run';
import { guardiaCifras } from '@/lib/likida/cuadre/guardia';
import { cuadrarDesdeDB, ventanaDesdeDB } from '@/lib/likida/cuadre/desde_db';
import { fechaDudosa } from '@/lib/likida/cuadre/fecha_dudosa';
import { etiquetaConcepto, copiasDeComprobante } from '@/lib/likida/cuadre/engine';
import { mensajePideFechaOtraVez } from '@/lib/likida/intake/pedir_fecha';
import { resumenCuadre } from '@/lib/likida/cuadre/resumen';
import { PartialExecutionError, type ToolCallRecord } from '@/lib/llm/openrouter';
import type { Gasto } from '@/types/likida';
import { extraerComprobante } from '@/lib/likida/intake/ocr';
import { hashImagen } from '@/lib/likida/intake/hash';
import { subirComprobante } from '@/lib/likida/intake/almacen';
import {
  mensajeGuardadoSinViaje, mensajeGuardadoTrasLiquidar, mensajeOfrecer,
  mensajeAdjuntados, esAfirmacion, esNegacion,
} from '@/lib/likida/intake/huerfanos';
import { decidirFoto } from '@/lib/likida/intake/decidir';
import {
  anotarFoto, anotarIncidencia, pedirTurnoDeConfirmacion, cerrarRafaga, lineaIncidencias,
} from '@/lib/likida/intake/rafaga';
import { avisoSimplificado, versionAviso, pideAtencionPrivacidad, respuestaPrivacidad } from '@/lib/likida/privacidad';
import { violaIndice, llegoTarde } from '@/lib/likida/pg_errores';
import { mxn, fechaMx } from '@/lib/formato';
import { guardiaFundamento, normasDeToolCalls } from '@/lib/likida/normas/fundamento';
import { guardiaEstado } from '@/lib/likida/cuadre/estado_afirmado';
import { crearPresupuesto, PRESUPUESTO_WEBHOOK_MS, acotada } from '@/lib/likida/presupuesto';
import { conceptoDesdeClave } from '@/lib/likida/intake/concepto';
import { getConfig } from '@/lib/likida/config';
import { emparejarPendiente, emparejarXmlConTicket } from '@/lib/likida/intake/emparejar';
import { parseCfdiXml, esConsolidado } from '@/lib/likida/intake/cfdi_xml';
import { guardarYConciliarConsolidado, mensajeConsolidadoRecibido } from '@/lib/likida/intake/consolidado';
import {
  addGasto, getGastos, updateGastoCfdiXml, saveCfdiXmlRaw, gastoExistePorHash, gastoPorHash, ubicarGastoPorHash, corregirFechaGasto,
  guardarHuerfano, getHuerfanos, resolverHuerfanos, marcarHuerfanosOfrecidos, getViaje,
  enriquecerGastoConCodigo, guardarCodigoPendiente, getCodigosPendientes, reclamarCodigoPendiente,
  getDatosResponsable, reclamarEnvioAviso, confirmarEnvioAviso, liberarEnvioAviso,
  registrarSolicitudArco,
} from '@/lib/likida/repo';
import {
  resolveOperador, getOpenViaje, getTenantContext,
  loadConversation, saveConversation, claimMessage,
  acquireViajeLock, releaseViajeLock, releaseMessageClaim,
  intakeDelta, esperarIntake, ConsultaFallida, OperadorAmbiguo, type ConvTurn,
  buscarTenantPorTelefono,
} from '@/lib/likida/conv';
import { registrarCosto, registrarCostoWhatsApp, faseDeModelo, vincularCostosALiquidacion } from '@/lib/likida/costos';
import { sendText, sendButtons, sendDocument, downloadMediaAsDataUrl, downloadMediaAsText } from '@/lib/meta/client';
import {
  decidirAcuse, mensajeConfirmar, mensajeRefoto, esPeticionDeFoto,
  mensajeCorregir, mensajeConfirmado, leerBoton, mensajeDemasiadasDudas,
  MAX_CONFIRMACIONES_SEGUIDAS, type LecturaTicket,
} from './acuse_ticket';
import { estadoDelViaje, responderConsulta } from './consulta_chofer';
import { resolverCuentaOficina } from './contactos';
import { atenderConfirmacion, aceptarPorActividad } from './confirmar_viaje';
import { avisarCierreAlJefe } from './avisar_cierre';
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
    // AUDITORÍA 9, ALTO operabilidad: `tenantId`/`viajeId`/`gasto.id` están en
    // scope y las tres líneas vecinas los usan — solo este catch los omitía.
    // Sentry agrupa por `msg`, así que sin ellos un fallo aquí ("fetch failed")
    // no se puede cruzar contra la base para saber a qué viaje o tenant
    // pertenece. (El otro mecanismo que compartía este mismo nombre de log,
    // `foto_pendiente`/mig. 0038, se revirtió esta ronda; ya no hay colisión
    // de dos mecanismos distintos bajo un mismo `msg`, pero la falta de
    // contexto en ESTE sitio seguía siendo real por su cuenta.)
    logger.warn('foto.pendiente_error', { viaje: viajeId, tenant: tenantId, gasto: gasto.id, err: e instanceof Error ? e.message : String(e) });
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
/**
 * Atiende el ejercicio del medio ARCO. Se llama ANTES del corte por "sin viaje
 * abierto": el derecho no depende de que la flota le haya asignado uno.
 *
 * Nunca lanza: dejar sin respuesta a quien ejerce un derecho es peor que
 * cualquier fallo que se pueda registrar.
 */
async function atenderPrivacidad(tenantId: string, operadorId: string | null, telefono: string, texto: string): Promise<void> {
  try {
    const datos = await getDatosResponsable(tenantId);
    if (datos) {
      await sendText(telefono, respuestaPrivacidad(datos));
      // AUDITORÍA 12, ALTO (legal): el aviso promete "queda registrada tu
      // solicitud" y antes NO se registraba nada — `solicitud_arco` (0053)
      // existía sin un solo insert y la flota (la responsable, 15 días hábiles
      // para contestar, LFPDPPP art. 32) no tenía constancia que atender. El
      // tipo se clasifica del texto; la flota decide la calificación exacta.
      const { tipoDeSolicitudArco } = await import('@/lib/likida/privacidad');
      await registrarSolicitudArco({
        tenantId,
        operadorId,
        titularRef: telefono,
        tipo: tipoDeSolicitudArco(texto),
        canal: 'whatsapp',
      });
      return;
    }
    // Sin datos del responsable no se puede decir a quién reclamarle. Se le dice
    // la verdad en vez de dejarlo sin respuesta.
    logger.error('privacidad.solicitud_sin_datos_responsable', { tenantId });
    await sendText(telefono, 'Déjame checarlo con la empresa y te confirmo por aquí. 🙏');
  } catch (e) {
    logger.error('privacidad.solicitud_error', { tenantId, err: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Devuelve `false` cuando el aviso NO se pudo poner a disposición.
 *
 * Devolvía `void`, y el llamador seguía adelante pasara lo que pasara: sin razón
 * social o domicilio de la flota, esta función registraba el error, retornaba de
 * SÍ MISMA, y el procesamiento continuaba — la foto del operador se descargaba y
 * se mandaba a un modelo externo igual. Eso es una transferencia de datos
 * personales sin el aviso que la ampare, y es el único supuesto que el art. 8 de
 * la LFPDPPP no admite en ninguna lectura.
 *
 * El obligado es la flota, no Likida; pero quien ejecuta el tratamiento es este
 * código, y no puede ejecutarlo a ciegas.
 */
// Se exporta para poder probarla: es la función que decide si HAY tratamiento,
// y su rama de fallo —liberar la constancia cuando Meta no entregó— no la
// ejecutaba ninguna prueba (auditoría 6, rubro pruebas). Llegar a ella por
// `processInbound` exige montar la cadena entera, y entonces lo que se mide es
// la cadena, no esta decisión.
/**
 * CUATRO desenlaces, no dos, y la diferencia se le dice al operador.
 *
 * Devolvía un booleano, y el llamador traducía TODO el `false` a «tu empresa
 * aún no ha terminado de configurar su aviso de privacidad». Pero `sendText`
 * SÍ lanza ante un fallo de red o un timeout —lleva `AbortSignal.timeout` y no
 * tiene try/catch— y ese throw caía en el catch de aquí abajo, que devolvía
 * `false` igual. O sea: un blip de red de tres segundos se le presentaba al
 * chofer como un error administrativo de su patrón, con la foto descartada y
 * el mensaje marcado como procesado. Le echaba la culpa a su jefe de un
 * problema nuestro, y encima le quitaba el comprobante.
 *
 *   · `puesto`        → se puede tratar (se mandó ahora o ya se había mandado).
 *   · `sin_datos`     → la flota no terminó su alta. ES administrativo, y es lo
 *                       único que justifica mandar al operador con su patrón.
 *   · `no_entregado`  → Meta rechazó el envío (destinatario fuera de lista…).
 *   · `error`         → red, timeout o base. Transitorio: se reintenta.
 */
export type ResultadoAviso = 'puesto' | 'sin_datos' | 'no_entregado' | 'error';

export async function ponerAvisoADisposicion(
  tenantId: string,
  operadorId: string,
  telefono: string,
): Promise<ResultadoAviso> {
  try {
    const datos = await getDatosResponsable(tenantId);
    if (!datos) {
      // El tenant no tiene razón social, domicilio o liga del aviso integral.
      // NO se manda un aviso a medias: uno con el responsable equivocado —o sin
      // él— no dice a quién reclamarle, que es justo para lo que sirve.
      logger.error('privacidad.tenant_sin_datos_responsable', { tenantId });
      return 'sin_datos';
    }
    const texto = avisoSimplificado(datos);
    if (!texto) return 'sin_datos';
    // El claim vive en SQL: el primer mensaje puede llegar por dos caminos a la
    // vez, y sin él el operador recibiría el aviso dos o tres veces seguidas.
    // Ya se le puso a disposición antes: se puede tratar, y no se repite.
    if (!(await reclamarEnvioAviso(tenantId, operadorId, versionAviso(texto)))) return 'puesto';
    // La reserva va ANTES de enviar (si no, el aviso sale dos o tres veces), pero
    // la CONSTANCIA solo vale si el mensaje salió de verdad. `sendText` devolvía
    // `void` y no lanza al fallar, así que la fila se escribía igual: el 28-jul la
    // base afirmó que un operador recibió su aviso diez minutos ANTES del commit
    // que arregló el destinatario que Meta rechazaba. Ante la autoridad esa fila
    // es la prueba del art. 16; una prueba falsa es peor que ninguna.
    const id = await sendText(telefono, texto);
    if (!id) {
      logger.error('privacidad.aviso_no_entregado', { tenantId, operadorId });
      await liberarEnvioAviso(tenantId, operadorId);   // que el siguiente mensaje reintente
      return 'no_entregado';
    }
    // LA CONSTANCIA VA AQUÍ, y no antes. Hasta la 0033 la escribía la reserva, y
    // por eso deshacerla borraba la prueba de un aviso ANTERIOR que sí se había
    // entregado: si el texto de la flota cambia y el reenvío falla, la base
    // pasaba a decir que el operador nunca recibió ninguno.
    await confirmarEnvioAviso(tenantId, operadorId, versionAviso(texto));
    logger.info('privacidad.aviso_enviado', { tenantId, operadorId, id });
    return 'puesto';
  } catch (e) {
    // Si la 0018 no está aplicada, las columnas no existen y esto truena. Y por
    // aquí sale también el throw de `sendText` ante red o timeout: es un fallo
    // NUESTRO y transitorio, no la flota sin dar de alta su aviso.
    logger.error('privacidad.aviso_error', { tenantId, operadorId, err: e instanceof Error ? e.message : String(e) });
    return 'error';
  }
}

/**
 * Deja constancia EN LA CONVERSACIÓN de que se le pidió otra foto.
 *
 * ── POR QUÉ HACE FALTA ───────────────────────────────────────────────────
 *
 * `acuse_ticket.ts` declara como su razón de existir que "una repetición
 * siempre lleva respuesta": si se le pidió otra foto, la segunda se le contesta
 * aunque salga perfecta, porque callar tras un "mándame otra" se lee como
 * "volvió a fallar" y manda una tercera. Esa regla se implementa mirando si el
 * ÚLTIMO turno nuestro fue una petición de foto (`esPeticionDeFoto`).
 *
 * Pero el camino de la foto salía siempre con `say(...); return;` y nunca
 * llegaba al único `saveConversation` del archivo (el del cierre del agente),
 * así que la petición no entraba al historial: `esRepeticion` era `false`
 * SIEMPRE y la rama `if (l.esRepeticion) return { peldano: 'confirmar' }` de
 * `decidirAcuse` era código muerto. La foto que se pidió recibía silencio.
 *
 * ── POR QUÉ SOLO ESTA Y NO TODO EL CAMINO DE LA FOTO ─────────────────────
 *
 * Las fotos NO toman el mutex del viaje (corren en paralelo a propósito), así
 * que cada escritura de esta fila es un "el último gana" contra las demás. Se
 * escribe únicamente lo que un turno POSTERIOR necesita poder ver, que es
 * exactamente esta petición: el acuse con botones se contesta por el botón, no
 * por el historial. Y la ventana de carrera es angosta —esto ocurre antes del
 * `-1` del contador de intake, así que la barrera del "listo" no abre hasta que
 * esta escritura terminó.
 *
 * Best-effort: el gasto YA está guardado. Perder la constancia cuesta un acuse,
 * tumbar aquí costaría el reproceso del webhook y con él la llamada de visión.
 */
async function recordarPeticionDeFoto(
  tenantId: string, telefono: string, viajeId: string, texto: string,
): Promise<void> {
  try {
    const conv = await loadConversation(tenantId, telefono, viajeId);
    await saveConversation(
      conv.id,
      [...conv.turns, { role: 'assistant', content: texto }],
      viajeId,
      { intentosConfirmacion: conv.intentosConfirmacion, cierreSinComprobantes: conv.cierreSinComprobantes },
    );
  } catch (e) {
    logger.warn('foto.refoto_no_recordada', { viaje: viajeId, err: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * ¿Este texto parece un "ya acabé"?
 *
 * Vive aquí arriba porque lo usan DOS decisiones: apartarse del ofrecimiento de
 * huérfanos y el freno del cierre sin comprobantes. Dos copias de esta condición
 * se separan en silencio.
 *
 * Cubre las conjugaciones que de verdad escribe un chofer: "terminé", "termine",
 * "termino", "terminó", y lo mismo con "acabar". La frontera es `(?!\p{L})` con
 * bandera `u`, NO `\b`: en JavaScript `\b` se calcula con [A-Za-z0-9_], así que
 * una "é" NO cuenta como letra y "terminé" —la forma correcta y la más
 * escrita— nunca casaba. La lista vieja pedía además la e final, dejando fuera
 * "termino ruta", que es de las más comunes.
 */
function pareceCierre(texto: string): boolean {
  return /^\s*(listo|ya|ya est[aá]|termin[éeoó]|acab[éeoó]|cierra|cerrar|eso es todo|es todo|ya qued[óo])(?!\p{L})/iu.test(texto);
}

export async function processInbound(msg: InboundMessage): Promise<void> {
  // Idempotencia: si Meta reintenta el webhook, no re-procesar (no duplicar gasto).
  const claim = msg.waMessageId ? await claimMessage(msg.waMessageId) : 'nuevo';
  if (claim === 'duplicado') {
    logger.info('wa.duplicate', { id: msg.waMessageId });
    return;
  }
  if (claim === 'indeterminado') {
    // NO se abandona el turno. Meta ya recibió su 200 en `route.ts` y no
    // reintenta, así que abandonar aquí no aplaza el mensaje: lo pierde, para
    // siempre y en silencio. Se sigue, aceptando el riesgo de reprocesar: los
    // efectos con dinero tienen sus propios candados —hash de comprobante para el
    // gasto, `on conflict (viaje_id)` para la liquidación— y ninguno depende de
    // esta rejilla. Perder el "listo" del operador no tiene candado ninguno.
    logger.warn('wa.claim_indeterminado', { id: msg.waMessageId });
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
  // Contexto para el `catch` general. Vive FUERA del `try` a propósito: sin esto
  // el log de un fallo salía como `{ id, de, err }` — sin tenant, sin viaje y sin
  // saber si la liquidación había cerrado—, así que era imposible reconstruir
  // CUÁL liquidación quedó cerrada sin entregar. Un error del camino del dinero
  // que no dice de qué dinero habla no sirve a las 3 de la mañana.
  let ctxTenant: string | null = null;
  let ctxViaje: string | null = null;
  let ctxCerro = false;
  try {
    // ── EL MEDIO ARCO RESPONDE SIEMPRE, incluso a quien YA no es operador ──
    // AUDITORÍA 12, MEDIO (legal): el chequeo vivía dentro de `if (op)`, así
    // que un operador DADO DE BAJA (activo=false — la única forma de inactivar
    // del panel) escribía PRIVACIDAD y recibía "no te tengo registrado". La
    // población más probable de ejercer cancelación/oposición es exactamente
    // la que el canal rechazaba. El tenant se busca por teléfono SIN el filtro
    // de activo, o por cuenta de oficina; sin ninguna de las dos, se le dice la
    // verdad en vez de callar.
    if (msg.type === 'text' && msg.text && pideAtencionPrivacidad(msg.text)) {
      const tenantId =
        (await buscarTenantPorTelefono(msg.from).catch(() => null))
        ?? (await resolverCuentaOficina(msg.from).catch(() => null))?.tenantId
        ?? null;
      if (tenantId) {
        await atenderPrivacidad(tenantId, null, msg.from, msg.text);
      } else {
        await sendText(msg.from, 'Claro. No te tengo identificado con una flota en Likida, así que no sé a qué empresa reclamarle. Si trabajaste con una flota que usa Likida, pídeles que te confirmen qué hicieron con tus datos. 🙏');
      }
      return;
    }

    const op = await resolveOperador(msg.from);
    if (!op) {
      // ── ¿ES UNA CUENTA DE OFICINA? ───────────────────────────────────────
      //
      // Antes esto era un callejón sin salida: cualquier número que no fuera
      // chofer recibía "no te tengo registrado como operador" y ahí terminaba.
      // El costo real no era la frase, era esto: los avisos que Likida MANDA a
      // la oficina —"tu chofer no aceptó el viaje", "tienes tickets por
      // vencer"— llegaban a un número que el sistema no reconocía de vuelta. El
      // jefe podía contestar "cámbialo a Pérez" y nadie estaba escuchando. Un
      // aviso que no se puede contestar no es una conversación, es una alerta.
      const cuenta = await resolverCuentaOficina(msg.from).catch((e) => {
        // Ambigüedad o base caída. No se afirma que no existe: eso es justo la
        // confusión que `resolveOperador` ya corrigió arriba.
        logger.error('oficina.no_resuelta', { err: e instanceof Error ? e.message : String(e) });
        return null;
      });

      if (cuenta) {
        // ── AUDITORÍA 10, CRÍTICO FISCAL — EL XML CONSOLIDADO DE LA OFICINA ──
        //
        // El monedero de combustible y el TAG de casetas mandan SU CFDI al
        // correo de la OFICINA, no al del chofer — es la oficina quien lo
        // reenvía. Hasta hoy este bloque respondía el mismo texto genérico a
        // CUALQUIER mensaje, documento incluido: un XML consolidado que la
        // oficina reenviara aquí se perdía en silencio, sin siquiera un
        // "no sé qué hacer con esto".
        //
        // Alcance DELIBERADAMENTE angosto: solo se atiende el documento que
        // el parser reconoce como CONSOLIDADO (`lineas.length > 1` —
        // `esConsolidado`). Un XML de un solo concepto mandado por error desde
        // la oficina sigue sin tener dueño (no hay viaje/operador de
        // contexto para el camino de ticket 1:1) y cae al mensaje genérico de
        // abajo — ampliar ESE caso es una decisión de producto aparte.
        if (cuenta.tenantId && msg.type === 'document' && msg.mediaId) {
          try {
            const xmlText = await downloadMediaAsText(msg.mediaId);
            const xml = xmlText ? parseCfdiXml(xmlText) : null;
            if (xml?.uuid && esConsolidado(xml)) {
              logger.info('oficina.xml_consolidado', { tenant: cuenta.tenantId, user: cuenta.userId, uuid: xml.uuid, lineas: xml.lineas.length });
              const resumen = await guardarYConciliarConsolidado(cuenta.tenantId, xml, xmlText!);
              await sendText(msg.from, mensajeConsolidadoRecibido(resumen));
              return;
            }
          } catch (e) {
            // Best-effort: si algo truena aquí, cae al mensaje genérico de
            // abajo en vez de dejar al remitente sin ninguna respuesta.
            logger.error('oficina.xml_consolidado_error', { tenant: cuenta.tenantId, err: e instanceof Error ? e.message : String(e) });
          }
        }

        const quien = cuenta.nombre ? `${cuenta.nombre}` : 'Qué tal';
        // Se le dice lo que SÍ puede hacer hoy por aquí y se le manda al panel
        // para lo demás. Prometerle por WhatsApp algo que todavía no existe
        // —reasignar un viaje contestando este mensaje— sería peor que no
        // contestarle: lo haría esperar una acción que nadie va a ejecutar.
        logger.info('oficina.mensaje', { user: cuenta.userId, rol: cuenta.rol });
        await sendText(msg.from,
          `${quien}, te reconozco como ${cuenta.rol === 'contador' ? 'contador' : 'parte del equipo'} de tu flota en Likida 👋\n\n` +
          `Por aquí te aviso cuando un chofer no confirma su viaje y cuando haya comprobantes por facturar. ` +
          `Para asignar viajes, reasignar chofer o ver liquidaciones, entra a ${process.env.NEXT_PUBLIC_APP_URL ?? 'tu panel'}.`);
        return;
      }

      await sendText(msg.from, 'Hola, no te tengo registrado como operador. Pídele a tu flota que te dé de alta en Likida. 🚛');
      return;
    }
    // ── El medio ARCO responde SIEMPRE, haya viaje o no ──────────────────────
    // Va ANTES del corte por "sin viaje abierto". El aviso de privacidad le
    // promete al operador que escribiendo PRIVACIDAD se le atiende, y un derecho
    // ARCO no depende de que su flota le haya asignado un viaje — de hecho, quien
    // quiere que dejen de tratar sus datos es probable que YA no tenga viajes.
    //
    // Estaba después del corte, así que la promesa del aviso era falsa en el caso
    // más probable de ejercerla. Lo cazó la auditoría 3. (El chequeo global de
    // arriba —antes de la resolución de identidad— ya lo atiende, incluido al
    // operador dado de baja: este bloque queda como red redundante por si el
    // de arriba cambia de orden.)
    if (msg.type === 'text' && msg.text && pideAtencionPrivacidad(msg.text)) {
      await atenderPrivacidad(op.tenantId, op.operadorId, msg.from, msg.text);
      return;
    }

    ctxTenant = op.tenantId;
    const viajeId = await getOpenViaje(op.tenantId, op.operadorId);
    ctxViaje = viajeId;
    if (!viajeId) {
      // ── EL XML QUE PEDIMOS NO SE TIRA, aunque el viaje ya haya cerrado ──────
      // `complemento_no_verificable` NO está en SOLO_CONTRALOR a propósito: su
      // nota le dice al operador "reenvía el XML (el que te manda la gasolinera
      // por correo)". Y ese texto llega en el MISMO mensaje de cierre, cuando
      // `guardar_liquidacion` ya puso el viaje en 'liquidado'. Así que el
      // operador obedecía, el corte de arriba lo mandaba de vuelta con "no tienes
      // viaje abierto", y el XML se descartaba sin guardarse en ningún lado: el
      // producto pedía un documento y luego se negaba a recibirlo.
      //
      // Se conserva por UUID (CFF 30 lo exige igual) con `gasto_id` nulo. Volver
      // a cuadrar una liquidación ya cerrada es otra decisión —de producto, no de
      // este corte— y por eso aquí solo se garantiza que el dato no se pierda y
      // que al operador se le diga la verdad.
      if (msg.type === 'document' && msg.mediaId) {
        const xmlText = await downloadMediaAsText(msg.mediaId);
        const xml = xmlText ? parseCfdiXml(xmlText) : null;
        // ── AUDITORÍA 10, CRÍTICO FISCAL — CONSOLIDADO SIN VIAJE ABIERTO ────
        // Un CFDI de monedero/TAG ampara MUCHOS días y MUCHOS viajes — nunca
        // pertenece a "el viaje abierto de este operador", así que esta rama
        // (justamente la de "no hay viaje abierto") es, si acaso, la más
        // natural para recibirlo: no hace falta viaje de contexto porque el
        // consolidado nunca lo usó. Va ANTES del camino de ticket 1:1 de
        // abajo, que asume 1 CFDI = 1 gasto.
        if (xml?.uuid && esConsolidado(xml)) {
          const resumen = await guardarYConciliarConsolidado(op.tenantId, xml, xmlText!);
          logger.info('xml.consolidado_sin_viaje', { tenant: op.tenantId, operador: op.operadorId, uuid: xml.uuid, ...resumen });
          await sendText(msg.from, mensajeConsolidadoRecibido(resumen));
          return;
        }
        if (xml?.uuid) {
          await saveCfdiXmlRaw(op.tenantId, xml.uuid, null, xmlText!);
          logger.info('xml.sin_viaje_abierto', { tenant: op.tenantId, operador: op.operadorId, uuid: xml.uuid });
          await sendText(msg.from, 'Recibí tu XML y ya quedó guardado ✅. Tu viaje ya estaba cerrado, así que tu contralor lo aplica desde el panel. 🙏');
          return;
        }
      }
      // ── LA FOTO TAMPOCO SE TIRA ─────────────────────────────────────────────
      // Era la asimetría más fea del intake: el XML de arriba SÍ se conservaba y
      // la foto —el documento que de verdad importa— se descartaba con un «no
      // tienes viaje abierto», que es cierto y no es lo que pasó. Lo que pasó es
      // que se tiraron sus tickets.
      //
      // Y hay un chofer real detrás: no todos escriben «hola» ni esperan a que
      // la oficina abra el viaje. Terminan la ruta, sacan el fajo y mandan once
      // fotos de golpe. Ese operador perdía once comprobantes sin enterarse.
      //
      // Se le paga la visión AQUÍ, sin viaje: es lo que permite decirle cuánto
      // trae cada uno cuando se le pregunte si van, y evita pagarla otra vez al
      // adjuntarlos. Un comprobante vale mucho más que una llamada de visión.
      if (msg.type === 'image' && msg.mediaId) {
        try {
          const dataUrl = await downloadMediaAsDataUrl(msg.mediaId);
          if (!dataUrl) { await sendText(msg.from, 'No pude descargar tu foto 😕. ¿Me la reenvías?'); return; }
          const ruta = await subirComprobante(op.tenantId, 'sin-viaje', await hashImagen(dataUrl), dataUrl);
          const ex = await extraerComprobante(dataUrl, reloj.senal(25_000));
          await registrarCosto({ tenantId: op.tenantId, viajeId: null, fase: 'ocr', modelo: ex.costo.modelo, tokensIn: ex.costo.tokensIn, tokensOut: ex.costo.tokensOut, costoUsd: ex.costo.costoUsd });
          // ── FALLO NUESTRO: AQUÍ TAMPOCO SE PIERDE EL COMPROBANTE ────────────
          //
          // Es la rama GEMELA del `avisar_falla` de más abajo (el camino CON
          // viaje abierto), y hasta hoy hacía justo lo que aquélla dejó de
          // hacer: tirar la foto sin guardar nada y pedirle al operador que la
          // reenviara «con buena luz y completo el ticket». Dos mentiras en una
          // frase: la foto está bien —`fallo_tecnico` es un 429, un
          // truncamiento o el proveedor de visión caído— y no hay nada que
          // completar, porque no llegamos a leer el ticket. Y el disparador es
          // SISTÉMICO: si falló una foto de la ráfaga, fallaron las once.
          //
          // Este huérfano nace con `monto: 0` (es lo que devuelve
          // `extraerComprobante` cuando truena) y por eso NO entra al
          // ofrecimiento —el filtro `monto > 0` de más abajo—: adjuntarlo
          // metería una línea de $0.00 en la liquidación del contralor, que es
          // una cifra que nadie midió. Se guarda igual porque la fila y la
          // imagen son la evidencia de que ese papel existió; el monto solo
          // vuelve por el reenvío, y por eso el reenvío es lo que se le pide.
          //
          // LO QUE ESTO DEJA ABIERTO (igual que la rama gemela, que ya lo
          // tenía): un huérfano sin monto NUNCA se ofrece, así que nunca se
          // resuelve y se queda en la sala de espera. `getHuerfanos` lee 50 por
          // operador ordenados por antigüedad, o sea que un operador que
          // acumule 50 de éstos —dos o tres caídas del proveedor con ráfagas
          // largas— dejaría de ver los que SÍ tienen monto. No se resuelve aquí
          // porque marcarlos 'descartado' escribiría en la base algo que el
          // operador no dijo; el arreglo va en la lectura (filtrar por monto en
          // la consulta, o subir el tope) y queda anotado.
          if (!ex.legible && ex.motivo === 'fallo_tecnico') {
            const guardado = await guardarHuerfano(op.tenantId, op.operadorId, {
              gasto: ruta ? { ...ex.gasto, imagenUrl: ruta } : ex.gasto,
              motivo: 'fallo_ocr', rutaImagen: ruta,
            });
            logger.warn('huerfano.fallo_tecnico', {
              tenant: op.tenantId, operador: op.operadorId, guardado, conImagen: Boolean(ruta),
            });
            if (!guardado) {
              await sendText(msg.from, 'Se me trabó a mí al leer ese comprobante ⚙️ — no es tu foto — y tampoco lo pude guardar. Conserva el ticket y reenvíamelo en un rato, por favor. 🙏');
              return;
            }
            // MISMO CRITERIO QUE EL ACUSE DE ABAJO: se cuenta lo que ya hay en
            // la sala de espera para no dar once explicaciones idénticas por
            // una falla que es una sola.
            const enEspera = await getHuerfanos(op.tenantId, op.operadorId);
            if (enEspera.length <= 1) {
              await sendText(msg.from, 'Se me trabó a mí al leer ese comprobante ⚙️ — no es tu foto. Guardé la imagen, así que el papel no se pierde, pero no alcancé a leer el monto: ¿me lo reenvías en un ratito para poder contarlo? 📸');
            }
            return;
          }
          // Ilegible: se le pide otra ANTES de guardar algo que no se puede usar.
          // Aquí sí es la foto (borrosa, cortada, oscura) y reenviarla SIRVE.
          if (!ex.legible && ex.motivo !== 'solo_codigo' && ex.motivo !== 'solo_pago') {
            await sendText(msg.from, 'Esa foto salió difícil de leer 🔍. ¿Me la reenvías con buena luz y completo el ticket?');
            return;
          }
          const guardado = await guardarHuerfano(op.tenantId, op.operadorId, {
            gasto: ruta ? { ...ex.gasto, imagenUrl: ruta } : ex.gasto,
            motivo: 'sin_viaje', rutaImagen: ruta,
          });
          logger.info('huerfano.guardado', { tenant: op.tenantId, operador: op.operadorId, monto: ex.gasto.monto, ok: guardado });
          if (!guardado) {
            // Se le dice la verdad: es la única forma de que no lo dé por hecho.
            await sendText(msg.from, 'No pude guardar ese comprobante ⚙️. Guarda el ticket y vuelve a mandarlo en un rato, por favor.');
            return;
          }
          // Cuántos lleva ya, para no acusar once veces en una ráfaga de once.
          const enEspera = await getHuerfanos(op.tenantId, op.operadorId);
          if (enEspera.length <= 1) await sendText(msg.from, mensajeGuardadoSinViaje(enEspera.length));
          return;
        } catch (e) {
          logger.error('huerfano.error', { err: e instanceof Error ? e.message : String(e) });
          await sendText(msg.from, 'Se me trabó tantito al recibir tu foto 😕. ¿Me la reenvías?');
          return;
        }
      }
      await sendText(msg.from, 'No tienes un viaje abierto para liquidar ahorita. Cuando tu flota te asigne uno, aquí lo cerramos. 👍');
      return;
    }

    // Helper: enviar + contar el costo. DEVUELVE SI SALIÓ, y ahí está el asunto.
    //
    // `sendText` NO lanza cuando Meta rechaza: devuelve `null` (y su propio
    // comentario dice que el éxito deja rastro justo para poder distinguirlos).
    // Aquí se tiraba ese resultado, así que un mensaje rebotado se trataba igual
    // que uno entregado. Dos consecuencias, y las dos se vieron en producción el
    // 1-ago con un `131030` (destinatario fuera de la lista de Meta):
    //
    //   · el turno del asistente se guardaba en la conversación igual, así que
    //     el agente CREÍA haber saludado a alguien que nunca leyó nada, y en el
    //     siguiente mensaje contestaba como si viniera de una charla en curso;
    //   · y se cobraba el costo de un mensaje que no se entregó, inflando el
    //     costo por liquidación.
    //
    // Es la misma familia que la constancia falsa del aviso de privacidad, que
    // se cerró esta misma semana: registrar como hecho algo que no ocurrió.
    const say = async (text: string): Promise<boolean> => {
      const id = await sendText(msg.from, text);
      if (!id) return false;
      await registrarCostoWhatsApp(op.tenantId, viajeId);
      return true;
    };

    // ── Aviso de privacidad, una vez por operador (LFPDPPP art. 16 fr. II) ────
    // Va aquí y no antes: es donde empieza el tratamiento que el aviso describe
    // —fotos de comprobantes, montos, fechas—. El teléfono ya lo tenía la flota
    // desde el alta, y ese tratamiento previo es suyo, fuera de este canal.
    //
    // El obligado es el RESPONSABLE, o sea la flota. Likida solo pone el
    // mecanismo: sin él la flota no puede cumplir aunque quiera.
    const avisoPuesto = await ponerAvisoADisposicion(op.tenantId, op.operadorId, msg.from);
    if (avisoPuesto !== 'puesto') {
      // SIN AVISO NO HAY TRATAMIENTO. Antes se seguía de largo: la foto se
      // descargaba y se mandaba a un modelo externo sin el aviso que lo ampare.
      //
      // LO QUE SE LE DICE DEPENDE DE POR QUÉ NO SE PUDO, y ese es el arreglo.
      // «tu empresa aún no ha terminado de configurar su aviso de privacidad»
      // se le soltaba también cuando el que falló fue NUESTRO envío —`sendText`
      // lanza ante red o timeout—, así que un blip de tres segundos le llegaba
      // al chofer como un error administrativo de su patrón, con la foto
      // descartada. Le echábamos la culpa a su jefe de un problema nuestro.
      logger.error('privacidad.tratamiento_bloqueado', {
        tenant: op.tenantId, operador: op.operadorId, motivo: avisoPuesto,
      });
      try {
        await sendText(msg.from, avisoPuesto === 'sin_datos'
          ? 'No puedo procesar tus comprobantes todavía: tu empresa aún no ha terminado de configurar su aviso de privacidad. Avísale a tu flota. 🙏'
          : 'Se me trabó tantito antes de poder recibir tu comprobante 😕. No es cosa tuya ni de tu empresa. Reenvíamelo en un minuto, por favor. 🙏');
      } catch { /* best-effort */ }
      // Y EL CLAIM SE LIBERA cuando el fallo es nuestro y transitorio: el
      // mensaje NO se procesó, así que no puede quedar contado como procesado.
      // Con `sin_datos` no se libera a propósito — reintentar no va a dar de
      // alta a la flota, y el aviso se le vuelve a dar en el siguiente mensaje.
      if (avisoPuesto !== 'sin_datos' && msg.waMessageId) await releaseMessageClaim(msg.waMessageId);
      return;
    }


    // ── IMAGEN: captura SILENCIOSA en PARALELO (acuse consolidado) ────────────
    // Las fotos NO toman el mutex: corren en paralelo (rápido). Cada una hace +1
    // al contador de intake al entrar y -1 al salir; el "listo" espera a que ese
    // contador llegue a 0 antes de cuadrar → nunca cierra sobre datos parciales.
    if (msg.type === 'image' && msg.mediaId) {
      // El +1 de esta foto. El valor devuelto ya NO decide el acuse (ver abajo):
      // decidirlo con "el contador pasó de 0 a 1" mandaba el mensaje una vez por
      // foto. Se conserva la llamada porque su EFECTO —el incremento— es lo que
      // sostiene la barrera del "listo".
      //
      // AUDITORÍA 7, ALTO — EL PAR +1/-1 NO ERA SIMÉTRICO ANTE EL ERROR. Si este
      // +1 fallaba (RPC transitoria → `null`), el código seguía de largo a
      // descargar/OCR/registrar el gasto igual, sosteniendo la barrera con un
      // incremento que NUNCA ocurrió — y el `finally` de abajo decrementa PASE
      // LO QUE PASE. Si el OCR de esa foto no termina antes de que el operador
      // escriba "listo", el cuadre cierra SIN ese comprobante, sin avisar, y el
      // operador paga de su bolsa un gasto que sí hizo.
      //
      // Fail-closed: sin incremento confirmado, no se sigue procesando esa foto
      // (nada que insertar sin que la barrera lo sepa) y se avisa, en vez de
      // fallar en silencio. Como no hubo +1, tampoco se ejecuta el -1 gemelo:
      // no hay nada que compensar, y compensarlo de todos modos recortaría el
      // contador de OTRA foto que sí está en vuelo (`greatest(0,…)` no distingue
      // de quién es el crédito).
      const incrementado = await intakeDelta(viajeId, 1);
      if (incrementado == null) {
        logger.error('intake.incremento_fallido', { viaje: viajeId, tenant: op.tenantId });
        await say('No pude registrar tu foto en el orden correcto 😕. Reenvíala en un momento y, si ya escribiste *listo*, vuelve a escribirlo cuando te confirme que la recibí.');
        // Y SE LIBERA EL CLAIM, que faltaba. Este `return` dejaba el mensaje
        // marcado en `wa_mensaje_procesado` para siempre — el mismo patrón que el
        // `return` del mutex ocupado (abajo) arregló el mismo día, con su propio
        // comentario: "seguía reclamado PARA SIEMPRE... el modo de falla 'se
        // trabó' sin que nadie diga que se trabó".
        //
        // Aquí duele menos —se le pide al operador que reenvíe, y un reenvío
        // manual trae otro `waMessageId`— pero la asimetría es real: el catch
        // general y el mutex sí lo liberan. Un mensaje que no se procesó no puede
        // quedar contado como procesado.
        if (msg.waMessageId) await releaseMessageClaim(msg.waMessageId);
        return;
      }
      // La foto YA cuenta para la barrera, así que también cuenta para el
      // resumen: `vistas` es el "de tus N fotos" del mensaje de cierre. Va aquí
      // y no más abajo para que una foto que se cae en la descarga también se
      // cuente — el operador la mandó, y el resumen tiene que cuadrar con lo
      // que él mandó, no con lo que nosotros logramos procesar.
      //
      // `incrementado === 1` marca además el ARRANQUE de una ráfaga: no había
      // nada en vuelo, así que lo que quedara anotado es de una anterior que
      // murió sin cerrarse y no puede sumarse a ésta.
      anotarFoto(viajeId, incrementado === 1);
      // ¿ESTA FOTO LLEGÓ SOLA? El contador es atómico, así que `1` significa
      // exactamente eso: no hay otra en vuelo. Es la única situación en la que
      // contestarle por la foto NO produce una avalancha, y es la que preserva
      // el comportamiento de una foto suelta tal cual estaba.
      //
      // En ráfaga se anota y se calla; el `finally` lo dice todo junto. Ver
      // `intake/rafaga.ts` para por qué esa es la forma correcta aquí.
      const llegoSola = incrementado === 1;
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
            // EL SILENCIO ES CORRECTO… SALVO CUANDO ESA FOTO ES LA QUE SE PIDIÓ.
            //
            // Fallo del ensayo del 1-ago: se le pidió otra foto de un ticket con
            // la fecha mal leída, reenvió EL MISMO archivo, y esto lo descartó
            // antes del OCR sin decir nada. Hizo lo que se le pidió, no pasó
            // nada, y no tenía forma de enterarse — el peor modo de falla que
            // hay, porque desde su lado el sistema quedó mudo.
            //
            // Para un reenvío cualquiera (doble toque, reintento) el silencio
            // sigue siendo lo correcto: avisarle de cada foto repetida sería
            // ruido. Lo que cambia el caso es que el gasto que empata tenga la
            // fecha en duda, porque entonces esa foto NO puede aportar nada:
            // es la misma que ya se leyó mal.
            try {
              const [previo, v] = await Promise.all([
                gastoPorHash(viajeId, imgHash, op.tenantId),
                ventanaDesdeDB(op.tenantId, viajeId),
              ]);
              if (previo && v && fechaDudosa(previo.fecha, v)) {
                await say(`Esa es la *misma foto* que ya me habías mandado 🔁, así que la fecha sigue igual. Necesito una foto *nueva* de ese ticket de ${mxn(previo.monto)} —tomada otra vez, no reenviada— enfocando la parte donde viene la fecha. 📸`);
              }
            } catch (e) {
              // Best-effort: el dedup ya hizo su trabajo. Fallar aquí no puede
              // costar un gasto, solo un aviso.
              logger.warn('foto.dedup_aviso_falló', { err: e instanceof Error ? e.message : String(e) });
            }
            return; // ya la teníamos: no re-OCR, no duplicar gasto
          }
        }

        // LA FOTO SE GUARDA, y se arranca AQUÍ para que corra en paralelo con
        // la visión: esperarla después costaría segundos de pared que no hacen
        // falta, porque nadie la necesita hasta el `addGasto` de más abajo.
        //
        // Hasta hoy no se guardaba ninguna (22 gastos en producción, 0 con
        // `imagen_url`). El CFF art. 30 obliga a conservar el comprobante cinco
        // años, y un gasto con monto y folio pero sin el papel es una fila en
        // una tabla. Además es lo único que dirime un OCR discutido: sin la
        // foto, es la palabra del sistema contra la del operador.
        //
        // No se hace `await` aquí y `subirComprobante` nunca lanza: si falla, el
        // gasto entra sin imagen. Perder el comprobante por no poder guardar su
        // retrato sería cambiar un problema chico por el grande.
        const subida = subirComprobante(
          op.tenantId, viajeId, imgHash ?? randomUUID(), dataUrl,
        );

        // La foto también respeta el reloj: 25s de tope propio, o menos si ya se
        // gastó el presupuesto. Sin esto caía al default del SDK (10 min).
        //
        // AUDITORÍA 9 — REVERTIDO: aquí vivió `foto_pendiente`, un intento de
        // retener el ticket sin código unos segundos por si llegaba el
        // acercamiento, para pagar una sola visión en vez de dos. Dos
        // auditores independientes (agéntico, backend) encontraron que
        // `reclamarFotoPendiente(tenantId, { viajeId })` reclamaba CUALQUIER
        // foto pendiente del viaje sin verificar que fuera el par correcto:
        // un voucher o cualquier otra foto con código que llegara mientras un
        // ticket sin código esperaba se fusionaba con él, y el gasto real de
        // esa segunda foto desaparecía de la liquidación sin aviso. El ahorro
        // (~$0.015/ticket de dos fotos) no justificaba ese riesgo a 5 días del
        // demo — decisión explícita de Javier, 1-ago-2026. Cada foto vuelve a
        // pagar su propia visión, como antes de la auditoría 8.
        const extraccion = await extraerComprobante(dataUrl, reloj.senal(25_000));
        const { gasto, costo } = extraccion;
        await registrarCosto({ tenantId: op.tenantId, viajeId, fase: 'ocr', modelo: costo.modelo, tokensIn: costo.tokensIn, tokensOut: costo.tokensOut, costoUsd: costo.costoUsd });

        // Los gastos ya registrados se leen para EMPAREJAR: el acercamiento del
        // protocolo de dos fotos y el voucher de la terminal — y, desde el
        // 1-ago, también en el camino legible, por la corrección de fecha de
        // abajo.
        //
        // La lista tiene que coincidir con la de `decidirFoto`. Si aquí falta un
        // motivo que allá empareja, `gastos` llega vacío, `emparejarPorMonto` no
        // encuentra nada y el operador recibe "mándame el ticket" por uno que ya
        // mandó — sin error en ningún lado. `decidir_empareja.test.ts` fija las
        // dos listas juntas.
        const EMPAREJAN = ['solo_codigo', 'solo_pago'];
        // Una foto LEGIBLE también necesita los gastos y la ventana del viaje:
        // es lo que permite reconocer que ésta es la SEGUNDA foto de un ticket
        // cuya fecha no cuadraba, y re-fechar el gasto que ya existe en vez de
        // dar de alta otro. Sin eso, la foto que se le pidió al operador entra
        // como gasto nuevo y —si el ticket no trae folio, que es la llave del
        // dedup— cobra el mismo consumo dos veces.
        //
        // En paralelo para que cueste un viaje a la base y no tres. Al lado de
        // la llamada de visión que acaba de correr, es ruido.
        const [yaRegistrados, ventana] = await Promise.all([
          extraccion.legible || EMPAREJAN.includes(extraccion.motivo ?? '')
            ? getGastos(viajeId, op.tenantId) : Promise.resolve([]),
          // FAIL-OPEN a propósito: si esto falla, `ventana` queda `undefined` y
          // el intake se comporta como antes —sin corrección y sin petición—.
          // Tumbar la foto por no poder calcular una ventana sería cambiar una
          // mejora por una pérdida de comprobante.
          extraccion.legible
            ? ventanaDesdeDB(op.tenantId, viajeId).catch((e) => {
                logger.warn('foto.ventana_no_disponible', { err: e instanceof Error ? e.message : String(e) });
                return undefined;
              })
            : Promise.resolve(undefined),
        ]);
        const decision = decidirFoto(extraccion, yaRegistrados, ventana);

        // Pedir reenvío SOLO cuando reenviar arregla algo. Si el fallo fue
        // nuestro (truncamiento, provider caído), la misma foto falla igual:
        // decirle "mándala con mejor luz" lo manda a un bucle y le echa la culpa
        // de un bug nuestro.
        // ── FALLO NUESTRO: EL COMPROBANTE NO SE PIERDE ───────────────────────
        //
        // Era el ÚNICO camino de pérdida que no guardaba nada. Los otros dos
        // —la foto sin viaje abierto y la que llega tras liquidar— pasan por
        // `guardarHuerfano` y se le ofrecen al operador en su siguiente viaje;
        // éste se despedía con "hay que capturarlo aparte" y tiraba la foto.
        //
        // Y ese trámite NO EXISTE: `addGasto` es el único insert sobre `gasto`
        // en todo el repo y sus tres llamadores viven en este archivo, todos en
        // el camino de WhatsApp. No hay alta manual en el panel, ni en una API,
        // ni en ningún lado. O sea que el mensaje mandaba al operador a hacer
        // algo imposible con un papel que nadie iba a capturar — verificado el
        // 4-ago-2026 antes de tocar esta rama.
        //
        // Encima el disparador es SISTÉMICO: `fallo_tecnico` es un 429, un
        // truncamiento o el proveedor caído, así que en una ráfaga de 22 no
        // falla una, fallan las 22. Perderlas todas y decírselo 22 veces era el
        // peor par posible.
        if (decision.accion === 'avisar_falla') {
          // AHORA SÍ SE ESPERA LA SUBIDA. Aquí abajo la promesa se quedaba
          // flotando: la ruta del objeto se descartaba y, si la invocación se
          // congelaba antes de que resolviera, no quedaba ni la imagen.
          const ruta = await subida;
          const guardado = await guardarHuerfano(op.tenantId, op.operadorId, {
            gasto: ruta ? { ...gasto, imagenUrl: ruta } : gasto,
            // `fallo_ocr` y ya no `sin_viaje` (4-ago-2026). La nota anterior
            // decía que el motivo real era éste y que se dejaba pendiente por
            // no tocar `repo.ts`; se tocó, y la columna es `text` a secas sin
            // CHECK (0040), así que el valor honesto entra sin migración.
            // `sin_viaje` describía el efecto y escondía la causa: la foto no
            // se quedó fuera por no haber viaje —lo hay—, sino porque se cayó
            // NUESTRO OCR.
            motivo: 'fallo_ocr', rutaImagen: ruta,
          });
          logger.warn('foto.fallo_tecnico_guardado', { viaje: viajeId, tenant: op.tenantId, guardado, conImagen: Boolean(ruta) });
          // SE ANOTA SIEMPRE, se DICE solo si llegó sola. Anotarla también cuando
          // ya se contestó por ella es lo que hace que el resumen cuadre con lo
          // que el operador mandó: "de tus 22 fotos, 22 se me trabaron" en vez de
          // un mensaje suelto más un resumen que dice 21 y parece otra cosa.
          anotarIncidencia(viajeId, { tipo: 'fallo_tecnico' });
          if (llegoSola) {
            await say(guardado
              ? 'Se me trabó a mí al leer ese comprobante ⚙️ — no es tu foto. Ya lo guardé, así que *no se pierde*. ¿Me lo reenvías en un momento? Si no alcanza a entrar en este viaje, te lo ofrezco en el siguiente. 📸'
              : 'Se me trabó a mí al leer ese comprobante ⚙️ y tampoco lo pude guardar. Conserva el ticket y reenvíamelo en un rato, por favor. 🙏');
          }
          return;
        }
        if (decision.accion === 'pedir_reenvio') {
          // Mismo criterio: una gasolinera mal iluminada de noche no arruina una
          // foto, arruina las veintidós. Se consolidan en el resumen.
          anotarIncidencia(viajeId, { tipo: 'ilegible' });
          if (llegoSola) {
            await say('Esa foto salió difícil de leer 🔍. ¿Me la reenvías con buena luz y completo el ticket?');
          }
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
          // QUÉ SE LE PIDE DEPENDE DE QUÉ MANDÓ. A quien mandó el voucher de la
          // terminal se le decía «mándame el ticket completo», y de ese papel no
          // hay ticket más completo: se queda esperando algo que no existe. Lo
          // que le falta es OTRO documento — el del comercio, que es el que trae
          // los litros y el RFC para facturar.
          const pideOtroPapel = decision.porVoucher
            ? 'Ese es el comprobante de la *terminal* (el de la tarjeta) 💳, y ése no sirve para facturar. Mándame el ticket del *comercio* — el que trae los litros y el RFC. 🧾'
            : 'Ya tengo el código de ese ticket 👍. Mándame también la foto del *ticket completo* para registrar el gasto.';
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
          // UNA VEZ POR VIAJE, no una por acercamiento. Mismo criterio que el
          // acuse de la ráfaga, y por la misma razón: en el primer ensayo real
          // (1-ago) tres acercamientos seguidos produjeron TRES avisos idénticos
          // uno detrás de otro. El operador no necesita que se lo digan tres
          // veces; necesita entender el protocolo una vez.
          //
          // Se ata al PRIMER código pendiente del viaje, que es cuando de verdad
          // hace falta explicarlo. Y como el `guardarCodigoPendiente` de arriba
          // ya ocurrió, si esto devuelve 1 es que éste es el primero.
          //
          // La carrera —dos acercamientos simultáneos que guardan antes de que
          // cualquiera cuente— hace que se pierda el aviso, no que se duplique.
          // Igual que con el acuse: perder uno es molesto, mandar tres es un
          // producto que se ve roto.
          try {
            const pendientes = await getCodigosPendientes(viajeId, op.tenantId);
            if (pendientes.length <= 1) await say(pideOtroPapel);
          } catch {
            // Si no se puede contar, se avisa igual: es peor dejar al operador
            // sin instrucción que repetírsela.
            await say(pideOtroPapel);
          }
          return;
        }
        // LA FOTO QUE SE LE PIDIÓ: re-fecha el gasto que ya existe.
        //
        // No da de alta nada. Es el mismo papel, y darlo de alta otra vez lo
        // cobraría dos veces cuando el ticket no trae folio —la llave con la que
        // `copiasDeComprobante` deduplica—. Se toca UNA columna: la fecha.
        if (decision.accion === 'corregir_fecha') {
          try {
            await corregirFechaGasto(op.tenantId, decision.gastoId, decision.fecha);
            logger.info('foto.fecha_corregida', { viaje: viajeId, gasto: decision.gastoId, fecha: decision.fecha });
            await say(`Ya quedó ✅ — ese ticket de ${mxn(gasto.monto)} ahora tiene fecha *${fechaMx(decision.fecha)}*. No lo registré otra vez: es el mismo gasto, solo con la fecha corregida.`);
          } catch (e) {
            // Mismo hecho que en el alta: la liquidación de este viaje ya se
            // emitió y el trigger de la 0037 lo impide. Aquí el operador hizo
            // exactamente lo que se le pidió, así que callarlo sería peor que en
            // el alta: creería que su corrección entró.
            if (llegoTarde(e)) {
              logger.warn('foto.correccion_llego_tarde', { viaje: viajeId, gasto: decision.gastoId });
              await say(`Esa foto llegó después de que cerré tu liquidación, así que la fecha quedó como estaba. Pídele a la oficina que corrija el ticket de ${mxn(gasto.monto)}: la fecha buena es ${fechaMx(decision.fecha)}.`);
              return;
            }
            logger.error('foto.correccion_error', { err: e instanceof Error ? e.message : String(e) });
            await say(`No pude guardar la fecha corregida de ese ticket de ${mxn(gasto.monto)} ⚙️. Avísale a la oficina: la fecha buena es ${fechaMx(decision.fecha)}.`);
          }
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
          // Aquí sí se espera la subida: es lo único que faltaba del gasto, y
          // para este punto lleva corriendo todo el rato que tardó la visión.
          const imagenUrl = await subida;
          await addGasto(op.tenantId, viajeId, {
            ...gasto,
            ...(imgHash ? { imgHash } : {}),
            ...(imagenUrl ? { imagenUrl } : {}),
          });
        } catch (e) {
          // R1: dos fotos IDÉNTICAS en el mismo lote pasan el pre-check antes de
          // que cualquiera inserte; el índice único (mig. 0015) atrapa la 2ª con
          // 23505 → es un duplicado benigno, no un error. Se ignora en silencio.
          if (imgHash && violaIndice(e, 'uq_gasto_img_hash')) {
            // OJO: EL ÍNDICE ES `unique(tenant_id, img_hash)` — TODA LA FLOTA.
            //
            // El pre-chequeo de arriba mira UN VIAJE, así que aquí caen dos
            // casos que no son el mismo:
            //
            //   a) misma ráfaga, dos fotos idénticas → carrera benigna, silencio;
            //   b) la foto YA ESTÁ registrada en OTRO viaje → no es una carrera,
            //      y callarse deja al operador creyendo que la mandó bien.
            //
            // Se trataban las dos como (a). Medido el 1-ago con un operador que
            // reenvió su fajo: DIEZ fotos rechazadas, cero mensajes. Tercer caso
            // del mismo patrón en un día —descartar en silencio— y el que más
            // veces se repitió.
            //
            // SOLO SI LLEGÓ SOLA (`incrementado === 1`). En una ráfaga de
            // dieciocho, diez de estos serían diez mensajes seguidos —el mismo
            // antipatrón de siempre—; ahí lo cubre el resumen del cierre de
            // ráfaga, que dice cuántos comprobantes quedaron en el viaje.
            const donde = incrementado === 1
              ? await ubicarGastoPorHash(op.tenantId, imgHash).catch(() => null)
              : null;
            if (donde && donde.viajeId !== viajeId) {
              logger.info('foto.ya_en_otro_viaje', { viaje: viajeId, otro: donde.viajeId, monto: donde.monto });
              await say(`Ese comprobante de ${mxn(donde.monto)} ya estaba registrado en ${donde.folio ? `tu viaje *${donde.folio}*` : 'otro viaje tuyo'}, así que no lo agregué aquí para no cobrarlo dos veces. Si de verdad es de este viaje, dile a la oficina que lo mueva. 🙏`);
              return;
            }
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
          // LLEGÓ TARDE (mig. 0036): la liquidación de este viaje ya se emitió.
          //
          // NO es benigno como los dos de arriba, y por eso no se ignora en
          // silencio: en aquellos el gasto ya está registrado, aquí no está en
          // ningún lado. Antes esta foto entraba y hacía que el texto de
          // WhatsApp y el PDF ya emitido dijeran cifras distintas y de signo
          // contrario, con el gasto huérfano de por vida.
          //
          // Se le dice al operador, porque es lo único que le permite hacer algo
          // —abrir el viaje siguiente y mandarla ahí, o pedirle a la oficina que
          // reabra—. Tragárselo le quita el dinero sin avisarle.
          if (llegoTarde(e)) {
            // NO SE PIERDE: pasa a la sala de espera (mig. 0040) y se le ofrece
            // en su próximo viaje.
            //
            // Antes decía «NO entró. Guárdalo: mándalo en tu siguiente viaje o
            // pídele a la oficina que lo agregue», y eso mandaba al operador a
            // un trámite que NO EXISTE: no hay forma de que la oficina agregue
            // un comprobante a un viaje cerrado, ni desde el panel ni desde
            // ningún lado. El comprobante se perdía igual, solo que despacio y
            // con el operador cargando un papel que nadie iba a capturar.
            const ruta = await subida;
            const ok = await guardarHuerfano(op.tenantId, op.operadorId, {
              gasto: ruta ? { ...gasto, imagenUrl: ruta } : gasto,
              motivo: 'tras_liquidar', rutaImagen: ruta,
            });
            logger.warn('foto.llego_tarde', { viaje: viajeId, monto: gasto.monto, guardado: ok });
            await sendText(msg.from, ok
              ? mensajeGuardadoTrasLiquidar(gasto.monto)
              : `Ese comprobante de ${mxn(gasto.monto)} llegó después de que cerré tu liquidación y no lo pude guardar ⚙️. Consérvalo y mándalo en tu siguiente viaje.`);
            return;
          }
          throw e;
        }
        // ¿Había un acercamiento esperando por este comprobante? (el caso en que
        // el operador mandó primero el código y después el ticket).
        await pegarCodigoEnEspera(op.tenantId, viajeId, gasto);

        // FECHA QUE NO CUADRA → se le pide otra foto AHORA, no al cuadrar.
        //
        // Al cuadrar, la liquidación ya se emitió y el trigger de la 0037 impide
        // tocar el gasto: pedírsela entonces sería mandarlo a hacer algo que el
        // sistema ya no puede aceptar. Aquí todavía tiene el ticket en la mano.
        //
        // El gasto YA ENTRÓ y se queda: la fecha dudosa no lo invalida, y no
        // registrarlo por una fecha sospechosa le costaría al operador un gasto
        // que sí hizo. Si manda la foto buena, `corregir_fecha` la re-fecha; si
        // no la manda, el cuadre levanta `fecha_sospechosa` como siempre. Los
        // dos caminos siguen cerrados.
        const dudosa = ventana ? fechaDudosa(gasto.fecha, ventana) : null;
        if (dudosa) {
          const extra = (gasto.ocrExtra ?? {}) as Record<string, unknown>;
          logger.info('foto.fecha_dudosa', { viaje: viajeId, motivo: dudosa, fecha: gasto.fecha });
          // TAMBIÉN ES SISTÉMICO, y por eso entra al mismo resumen: el reloj mal
          // puesto de una terminal, o un ticket de año viejo mal impreso, salen
          // igual en todo el fajo de esa gasolinera. Con 22 fotos eran 22 de
          // estos mensajes —y son de los largos—, uno detrás de otro.
          anotarIncidencia(viajeId, {
            tipo: 'fecha_dudosa',
            monto: gasto.monto,
            etiqueta: etiquetaConcepto(gasto.concepto, extra),
          });
          if (llegoSola) {
            await say(mensajePideFechaOtraVez({
              etiqueta: etiquetaConcepto(gasto.concepto, extra),
              monto: gasto.monto,
              folio: gasto.folio,
              emisor: extra.emisor as string | undefined,
              estacion: extra.estacion as string | undefined,
              fecha: gasto.fecha!,
              fechaImpresa: extra.fechaImpresa as string | undefined,
              ejercicioHoy: ventana?.hoy ? Number(ventana.hoy.slice(0, 4)) : null,
            }, dudosa));
          }
        }
        // MANDAR UN COMPROBANTE ES ACEPTAR EL VIAJE.
        //
        // Cierra un hueco que habría salido en el primer demo: el chofer que
        // ignora la pregunta de confirmación y se pone a trabajar. Sin esto, a
        // las 5 h la escalación le dice al jefe "tu chofer no confirmó" mientras
        // el chofer lleva ocho tickets mandados, y el jefe le habla para
        // regañarlo por algo que sí hizo. Una foto es una aceptación más fuerte
        // que un "va": es trabajo hecho.
        // `op.operadorId` va al UPDATE: `confirmar_viaje.ts` documenta que este
        // llamador todavía no lo pasaba y que por eso el filtro por chofer no se
        // aplicaba. Hoy ya se puede — el viaje viene de `getOpenViaje(tenantId,
        // operadorId)`, así que el filtro no cambia nada, y deja de estar a un
        // llamador nuevo de marcar como aceptado el viaje de un compañero.
        await aceptarPorActividad(op.tenantId, viajeId, op.operadorId);

        // ── ¿SE LE CONTESTA POR ESTA FOTO? ───────────────────────────────────
        //
        // Tres peldaños, en `acuse_ticket.ts`. Aquí solo llegan comprobantes que
        // YA se guardaron: la foto ilegible se atajó mucho antes, sin insertar.
        //
        // El SILENCIO es el peldaño bueno, y no por ahorrar mensajes. Un viaje
        // trae ~22 comprobantes; acusarlos todos hace que el chofer deje de
        // leerlos al quinto, y entonces el único que importaba —el del monto
        // dudoso— se pierde entre los que no. Callar en los buenos es lo que
        // hace que el del malo se lea.
        try {
          const extraAcuse = (gasto.ocrExtra ?? {}) as Record<string, unknown>;
          const lectura: LecturaTicket = {
            montoMxn: gasto.monto,
            concepto: etiquetaConcepto(gasto.concepto, extraAcuse),
            fecha: gasto.fecha ?? null,
            confianza: gasto.ocrConfianza ?? null,
            deCfdi: Boolean(gasto.cfdiUuid),
            esRepeticion: false,
          };
          let d = decidirAcuse(lectura);

          // Solo si íbamos a callar vale la pena preguntar si le debíamos una
          // respuesta: si se le pidió otra foto, se le contesta aunque la
          // segunda salga perfecta. Callar tras un "mándame otra" se lee como
          // "volvió a fallar", y manda una tercera.
          if (d.peldano === 'silencio' && !lectura.deCfdi) {
            const conv = await loadConversation(op.tenantId, msg.from, viajeId);
            const ultimo = [...conv.turns].reverse().find((t) => t.role === 'assistant');
            if (ultimo && esPeticionDeFoto(String(ultimo.content ?? ''))) {
              lectura.esRepeticion = true;
              d = decidirAcuse(lectura);
            }
          }
          logger.info('foto.acuse', { viaje: viajeId, peldano: d.peldano, porque: d.porque });

          if (d.peldano === 'confirmar') {
            // ── EL TOPE ESTABA ESCRITO Y NO ESTABA CABLEADO ────────────────────
            //
            // `MAX_CONFIRMACIONES_SEGUIDAS` existía desde que se escribió este
            // módulo, con su párrafo explicando que doce tickets térmicos
            // arrugados producen doce mensajes con botones —"justo el ruido que
            // este módulo existe para evitar"— y ni un solo `import`. La
            // constante describía una protección que nadie aplicaba.
            //
            // El turno se pide ANTES de mandar: es lo que hace que el tope
            // cuente confirmaciones ENVIADAS y no fotos vistas.
            const turno = pedirTurnoDeConfirmacion(viajeId);
            if (turno > MAX_CONFIRMACIONES_SEGUIDAS) {
              // Pasado el tope no se calla: se anota, y el resumen del cierre
              // dice cuántas quedaron sin confirmar. Un tope que no se anuncia
              // se lee como "todo salió bien", que es la peor lectura posible.
              logger.info('foto.acuse_sobre_tope', { viaje: viajeId, turno, tope: MAX_CONFIRMACIONES_SEGUIDAS });
              anotarIncidencia(viajeId, { tipo: 'duda', monto: gasto.monto, etiqueta: lectura.concepto });
            } else {
              const estado = await estadoDelViaje(op.tenantId, viajeId);
              const m = mensajeConfirmar(gasto.id, lectura, estado);
              // Si el botón no sale —fuera de la ventana de 24 h, Meta caído— se
              // degrada a texto en vez de perderse: `sendButtons` devuelve null sin
              // lanzar, y quedarse sin confirmación es peor que quedarse sin botón.
              const enviado = await sendButtons(msg.from, m.cuerpo, m.botones);
              if (!enviado) await say(`${m.cuerpo}\n\nContéstame *sí* o *no*.`);
            }
          } else if (d.peldano === 'refoto') {
            // Mismo tope y mismo contador: para el chofer, "confírmame esto" y
            // "mándamela otra vez" son el mismo ruido, y en una ráfaga de doce
            // tickets malos llegan mezclados. Contarlos por separado dejaría
            // pasar ocho mensajes en vez de cuatro.
            const turno = pedirTurnoDeConfirmacion(viajeId);
            if (turno > MAX_CONFIRMACIONES_SEGUIDAS) {
              logger.info('foto.refoto_sobre_tope', { viaje: viajeId, turno, tope: MAX_CONFIRMACIONES_SEGUIDAS });
              anotarIncidencia(viajeId, { tipo: 'duda', monto: gasto.monto, etiqueta: lectura.concepto });
            } else {
              const pedida = mensajeRefoto(d.porque);
              // SE GUARDA LO QUE SE LE PIDIÓ, no solo se manda. Es lo único que
              // le permite a la SIGUIENTE foto saber que es la repetición que
              // pedimos y contestarle. Ver `recordarPeticionDeFoto`.
              if (await say(pedida)) await recordarPeticionDeFoto(op.tenantId, msg.from, viajeId, pedida);
            }
          }
        } catch (e) {
          // Best-effort: el gasto YA está guardado. Un acuse que no sale es
          // molesto; tumbar aquí dispararía el reproceso del webhook, y con él
          // el de la foto — que sí cuesta dinero.
          logger.warn('foto.acuse_falló', { err: e instanceof Error ? e.message : String(e) });
        }

        // ACUSE UNA SOLA VEZ POR VIAJE, no "cuando el contador va de 0 a 1".
        //
        // Esa era la condición anterior, y el comentario decía otra cosa: creía
        // marcar la primera foto de la RÁFAGA. Pero el contador se decrementa en
        // el `finally` de cada foto, así que vuelve a 0 entre una y otra. Un
        // operador que fotografía 17 tickets en la gasolinera y los manda de uno
        // en uno —adjuntar, enviar, ~15 s de interacción humana— deja que cada
        // OCR termine antes de que llegue el siguiente: las 17 ven `enVuelo === 1`
        // y recibe DIECISIETE veces el mismo mensaje. El guion del demo promete
        // justo lo contrario.
        //
        // Se ata al primer COMPROBANTE del viaje, que es cuando el operador de
        // verdad necesita saber cómo funciona el flujo. Cuesta un `count` por
        // foto, que es despreciable al lado de la llamada de visión ($0.015).
        //
        // La carrera posible —dos fotos simultáneas que insertan antes de que
        // cualquiera cuente— hace que se pierda el acuse, no que se dupliquen.
        // Perder un acuse es molesto; mandar diecisiete es un producto roto.
        try {
          const registrados = await getGastos(viajeId, op.tenantId);
          if (registrados.length === 1) {
            await say('📸 Voy recibiendo tus comprobantes. Mándalos todos y cuando termines escribe *listo* para cerrar tu liquidación. 🚛');
          }
        } catch (e) {
          // En su propio try: un fallo aquí, ya guardado el gasto, NO debe
          // disparar reproceso — el comprobante ya está registrado.
          logger.warn('ack.send', { viaje: viajeId, err: e instanceof Error ? e.message : String(e) });
        }
      } finally {
        const quedan = await intakeDelta(viajeId, -1); // libera el contador pase lo que pase

        // ── RESUMEN AL CERRAR LA RÁFAGA ────────────────────────────────────────
        //
        // El problema que arregla, medido el 1-ago: un operador mandó DIECIOCHO
        // fotos de golpe y no recibió una sola palabra sobre ellas. Diez ya
        // estaban registradas en otro viaje, tres eran acercamientos a códigos y
        // dos eran idénticas a fotos de este viaje — todos caminos correctos, y
        // todos SILENCIOSOS. Desde su lado: mandó dieciocho fotos y no pasó nada.
        //
        // Y avisar por foto no es la salida: serían diez mensajes seguidos, que
        // es el antipatrón que ya hizo ver roto este producto tres veces (el
        // acuse de ráfaga, el aviso de acercamiento, los avisos de fecha).
        //
        // `quedan === 0` significa que ESTA fue la última foto en vuelo: el
        // contador es atómico, así que exactamente una invocación lo ve. Y solo
        // se resume si de verdad hubo RÁFAGA (`incrementado > 1`): para una foto
        // suelta, su propio camino ya habló y esto sería un mensaje de más.
        //
        // `quedan === null` TAMBIÉN cierra, y eso es nuevo. Significa que la RPC
        // no contestó, así que no se sabe si quedaba alguna en vuelo — y con la
        // libreta de la ráfaga ya llena, no cerrar equivale a tragarse el único
        // aviso de que tres comprobantes no entraron. El peor caso de cerrar de
        // más es un resumen partido en dos mensajes; el de no cerrar es el
        // silencio, que es exactamente lo que esta ronda vino a quitar.
        try {
          const ultima = quedan === 0 || quedan === null;
          // Lo que se anotó mientras la ráfaga corría. Se cierra SIEMPRE que
          // ésta sea la última —aunque no haya nada anotado— para no dejar la
          // libreta viva sobre un viaje cuya ráfaga ya terminó.
          const rafaga = ultima ? cerrarRafaga(viajeId) : null;
          const incidencias = rafaga ? lineaIncidencias(rafaga.vistas, rafaga.incidencias) : null;
          // HUBO RÁFAGA si por aquí pasó más de una foto (`vistas`) o si el
          // contador vio más de una en vuelo (`incrementado`). Se miran las dos
          // porque cada una ve una mitad: `incrementado` es el instante en que
          // ESTA foto se registró —la primera de una ráfaga simultánea ve 1— y
          // `vistas` es todo lo que pasó por este proceso.
          //
          // Con UNA sola foto no se resume: su propio camino ya habló, y decirlo
          // dos veces es el mismo ruido que esto vino a quitar.
          if (ultima && rafaga && (rafaga.vistas > 1 || incrementado > 1)) {
            const puestos = await getGastos(viajeId, op.tenantId);
            const total = puestos.reduce((s, g) => s + (g.monto > 0 ? g.monto : 0), 0);
            // Las que se pasaron del tope de botones llevan su propia frase, que
            // es la que `mensajeDemasiadasDudas` ya escribía y nadie llamaba.
            const dudas = rafaga.incidencias.filter((i) => i.tipo === 'duda').length;
            const cola = dudas
              ? `\n\n${mensajeDemasiadasDudas(dudas, await estadoDelViaje(op.tenantId, viajeId).catch(() => null))}`
              : '';
            logger.info('foto.resumen_rafaga', {
              viaje: viajeId, gastos: puestos.length,
              vistas: rafaga.vistas, incidencias: rafaga.incidencias.length,
            });
            await sendText(msg.from,
              `📸 Ya revisé tus fotos. En este viaje llevo *${puestos.length} ${puestos.length === 1 ? 'comprobante' : 'comprobantes'}* por *${mxn(total)}*.\n\n` +
              (incidencias ? `${incidencias}\n\n` : '') +
              `Si te falta alguno, mándalo otra vez. Cuando termines, escribe *listo*. 👍${cola}`);
          }
        } catch (e) {
          // Best-effort puro: el resumen es información, no el dinero.
          logger.warn('foto.resumen_falló', { err: e instanceof Error ? e.message : String(e) });
        }
      }
      return; // no corre el agente por foto
    }

    // ── DOCUMENTO: XML del CFDI (NIVEL 2 del complemento de hidrocarburos) ────
    // El operador/oficina reenvía el XML que la gasolinera manda por correo. NO
    // requiere e.firma ni portales. Silencioso (acuse consolidado): la validación
    // se refleja en el cuadre al cerrar.
    //
    // AUDITORÍA 8, ALTO (agéntico) — LA BARRERA NO LO VEÍA. La foto hace +1/-1
    // al contador de intake y el "listo" la espera; el XML no hacía nada de
    // eso, y su ruta es lenta (dos `fetch` a la Graph API, hasta 30s). Un
    // operador que reenvía el XML y escribe "listo" 4s después podía cerrar
    // ANTES de que la descarga terminara: `esperarIntake` veía el contador en
    // 0 (nadie lo tocó) y el estímulo/IVA acreditable de esa carga se perdía
    // para siempre — el motor solo cuenta litros e IVA de gastos con
    // `xml_verificado`. Mismo contrato fail-closed que la foto: si el +1 no
    // se confirma, no se sigue procesando (nada que insertar sin que la
    // barrera lo sepa).
    if (msg.type === 'document' && msg.mediaId) {
      const incrementado = await intakeDelta(viajeId, 1);
      if (incrementado == null) {
        logger.error('intake.incremento_fallido', { viaje: viajeId, tenant: op.tenantId });
        await say('No pude registrar tu XML en el orden correcto 😕. Reenvíalo en un momento y, si ya escribiste *listo*, vuelve a escribirlo cuando te confirme que lo recibí.');
        if (msg.waMessageId) await releaseMessageClaim(msg.waMessageId);
        return;
      }
      try {
        const xmlText = await downloadMediaAsText(msg.mediaId);
        const xml = xmlText ? parseCfdiXml(xmlText) : null;
        if (!xml || !xml.uuid) {
          await say('Recibí un documento, pero necesito el *XML* del CFDI (el archivo .xml que te manda la gasolinera por correo), no el PDF. ¿Me lo reenvías? 📎');
          return;
        }

        // ── AUDITORÍA 10, CRÍTICO FISCAL — CONSOLIDADO, NO TICKET 1:1 ───────
        // Un CFDI de monedero/TAG ampara MUCHAS transacciones de MUCHOS días
        // — nunca es "el ticket de este viaje". El camino de abajo
        // (`emparejarXmlConTicket` + `getGastos(viajeId,...)`) asume 1 CFDI =
        // 1 gasto DE ESTE viaje, así que un consolidado tiene que resolverse
        // ANTES, contra el `gasto` del TENANT completo, no solo del viaje
        // abierto. NO toma `xmlLock` (ese mutex protege la escritura de ESTE
        // viaje contra otro XML del mismo viaje en la misma ráfaga; el
        // consolidado escribe en gastos de otros viajes, y su propia
        // idempotencia por `(tenant_id, cfdi_uuid)` es la que lo protege).
        if (esConsolidado(xml)) {
          const resumen = await guardarYConciliarConsolidado(op.tenantId, xml, xmlText!);
          logger.info('xml.consolidado', { tenant: op.tenantId, viaje: viajeId, uuid: xml.uuid, ...resumen });
          await sendText(msg.from, mensajeConsolidadoRecibido(resumen));
          return;
        }

        // AUDITORÍA 9, MEDIO agéntico — MUTEX, porque esto es read-modify-write
        // sobre una fila COMPARTIDA, no un insert nuevo como la foto. Sin él, dos
        // XML del mismo total en el mismo lote (Meta los entrega juntos,
        // `route.ts:72` los corre con `Promise.all`) leían el mismo `gastos`
        // ANTES de que ninguno escribiera, los dos emparejaban con el MISMO
        // ticket sin `cfdi_uuid`, y el segundo `updateGastoCfdiXml` pisaba al
        // primero: su UUID, RFC emisor, IVA e IEPS desaparecían sin aviso —
        // `saveCfdiXmlRaw` seguía conservando el XML crudo del primero, apuntando
        // a un gasto que ya no traía su propio UUID. El mismo mutex que ya
        // protege el "listo" contra el doble cierre protege aquí el
        // emparejamiento contra la carrera. Si sigue ocupado tras esperar, se le
        // pide al operador que reenvíe en vez de proceder sin exclusividad —
        // proceder es exactamente la carrera que esto existe para cerrar.
        const xmlLock = await acquireViajeLock(viajeId, { maxWaitMs: reloj.acotar(12_000) });
        if (!xmlLock) {
          logger.warn('xml.lock_ocupado', { viaje: viajeId, tenant: op.tenantId });
          await sendText(msg.from, 'Estoy terminando de procesar otro XML de tu viaje 🙏. Reenvía este en un momento.');
          return;
        }
        try {
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
            //
            // AUDITORÍA 8, ALTO (modelo de datos + agéntico): este UPDATE puede
            // cambiar monto/IVA/IEPS de un gasto que ya forma parte de una
            // liquidación emitida — la 0037 lo bloquea en la base (mismo SQLSTATE
            // `CU001` que la 0036), pero sin este catch el operador recibía "se me
            // trabó tantito" en vez de la verdad, igual que el brazo de imagen ya
            // corrige más abajo con `llegoTarde`.
            try {
              await updateGastoCfdiXml(op.tenantId, match.id, eraTicket
                ? { ...xml, uuid: xml.uuid, rfcEmisor: xml.rfcEmisor, rfcReceptor: xml.rfcReceptor, total: xml.total, fecha: xml.fecha }
                : xml);
            } catch (e) {
              if (llegoTarde(e)) {
                logger.warn('xml.llego_tarde', { viaje: viajeId, gasto: match.id });
                await sendText(msg.from, `El XML que mandaste llegó después de que cerré tu liquidación, así que NO se aplicó. Guárdalo: mándalo en tu siguiente viaje o pídele a la oficina que lo agregue.`);
                return;
              }
              throw e;
            }
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
            // AUDITORÍA 8, ALTO (agéntico): sin este try/catch, un XML sin foto
            // previa que llega tarde chocaba con la 0036 (CU001) igual que el
            // camino de arriba, pero saltaba al catch general — "se me trabó
            // tantito" para un hecho que no es transitorio.
            try {
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
                // Auditoría 12 (fiscal, ALTO): el XML 1:1 trae la cantidad
                // (Cantidad="113.00" ClaveUnidad="LTR") y sin esto el gasto
                // nacía con 0 litros — el estímulo no se acreditaba.
                ocrExtra: xml.claveUnidad === 'LTR' && xml.cantidad != null
                  ? { litros: xml.cantidad } : undefined,
              });
            } catch (e) {
              if (llegoTarde(e)) {
                logger.warn('xml.llego_tarde', { viaje: viajeId, gasto: gastoId });
                await sendText(msg.from, `El XML que mandaste llegó después de que cerré tu liquidación, así que NO se aplicó. Guárdalo: mándalo en tu siguiente viaje o pídele a la oficina que lo agregue.`);
                return;
              }
              throw e;
            }
          }
          // 1.8: conservar el XML crudo (CFF 30). Best-effort.
          await saveCfdiXmlRaw(op.tenantId, xml.uuid, gastoId, xmlText!);
        } finally {
          await releaseViajeLock(viajeId);
        }
      } finally {
        await intakeDelta(viajeId, -1); // libera el contador pase lo que pase
      }
      return; // silencioso
    }

    // ── TEXTO: corre el agente UNA vez → respuesta consolidada ───────────────
    if (!(msg.type === 'text' && msg.text)) {
      await say('Por ahora solo proceso texto, fotos de comprobantes y el XML del CFDI. Mándame la foto de tu ticket o el XML. 📸');
      return;
    }

    // ── BOTÓN APRETADO ───────────────────────────────────────────────────────
    //
    // Llega como TEXTO con el id del botón —así lo mapea el webhook— y se atiende
    // ANTES que nada: es la respuesta a una pregunta concreta que hicimos, no
    // algo que el agente deba interpretar. Mandarle "ok:<uuid>" al modelo cuesta
    // una llamada y puede contestar cualquier cosa.
    const boton = leerBoton(msg.text);
    if (boton) {
      const est = viajeId ? await estadoDelViaje(op.tenantId, viajeId) : null;
      if (boton.accion === 'ok') {
        logger.info('acuse.confirmado', { viaje: viajeId, gasto: boton.gastoId });
        await say(mensajeConfirmado(est));
      } else {
        // NO se toca el gasto. El chofer dijo que el monto está mal, pero no dijo
        // cuál es el bueno: corregirlo a un número inventado sería peor que
        // dejarlo mal leído, y ponerlo en cero le quitaría un gasto que sí hizo.
        // Se le pide la cifra y la corrección entra por el camino normal del
        // agente, que ya sabe corregir un comprobante.
        logger.warn('acuse.rechazado', { viaje: viajeId, gasto: boton.gastoId });
        await say(mensajeCorregir());
      }
      return;
    }

    // ── "¿CUÁNTO LLEVO?" ─────────────────────────────────────────────────────
    //
    // Se contesta con una consulta y una plantilla, SIN modelo. No es por
    // ahorrar: la cifra sale de la base, y un modelo en medio no puede mejorarla
    // pero sí puede equivocarla. `null` = no era una consulta, sigue al agente.
    const respEstado = await responderConsulta(msg.text, op.tenantId, viajeId);
    if (respEstado) {
      logger.info('consulta.estado', { viaje: viajeId });
      await say(respEstado);
      return;
    }

    // ── ¿ESTÁ CONFIRMANDO SU VIAJE? ──────────────────────────────────────────
    //
    // Va DESPUÉS de la consulta de estado y ANTES del agente. El orden importa:
    // un viaje que el chofer no ha aceptado tampoco lo puede haber terminado,
    // así que su "listo" aquí significa "listo para arrancar", no "ya acabé".
    //
    // `decidirInicio` es puro y no elige por él: con dos viajes asignados y un
    // "sí" pelón devuelve `ambiguo` y vuelve a preguntar. Arrancar el que no era
    // mete los comprobantes de una ruta en la liquidación de otra, y eso se
    // descubre hasta el cuadre, con el papel ya entregado.
    //
    // TODO EL BLOQUE VA EN try/catch, Y NO CONTRADICE "fallar cerrado". Esa
    // regla protege de AFIRMAR algo falso; aquí no se afirma nada: es un atajo
    // delante del agente, y si no se puede consultar, el mensaje sigue su camino
    // normal y lo contesta el agente. Lanzar rompería CADA mensaje de CADA
    // chofer mientras la base tosa —incluidos los de quienes ya arrancaron su
    // viaje y no tienen nada que confirmar—, que es un daño mucho mayor que
    // perder una confirmación recuperable (el viaje escala a las 5 h y se ve en
    // el panel).
    try {
      const conv0 = await loadConversation(op.tenantId, msg.from, viajeId);
      // Cuántas veces se le ha preguntado ya. Sin este conteo, "se repregunta
      // UNA vez" no se puede cumplir: `decidirInicio` no tiene memoria, y a
      // alguien manejando se le acabaría preguntando en bucle.
      //
      // ── EL BUCLE ERA REAL, Y ESTABA EN DOS PIEZAS ──────────────────────────
      //
      // El conteo se hacía leyendo el TEXTO de los turnos con
      // `/confirma|¿cu[áa]l de|arranco/i`, y esa expresión no empata con NINGUNO
      // de los mensajes que este flujo manda: "¿Arrancas este viaje?", "✅ Va,
      // arrancamos:", "Sí, pero ¿cuál? Traes 2.". Y aunque hubiera empatado, el
      // atajo de abajo salía con `say(...); return;` sin pasar nunca por
      // `saveConversation` —el único de todo el archivo, al final del camino del
      // agente—, así que las preguntas jamás entraban a `conv.turns` y el filtro
      // corría sobre una lista vacía.
      //
      // Dos fallas independientes, un mismo efecto: `intento` valía 1 para
      // siempre, la rama `intento >= 2` de `dudar()` —el freno que manda con el
      // encargado— era inalcanzable, y el chofer recibía "Perdón, no te entendí"
      // indefinidamente.
      //
      // Ahora el número lo lleva la conversación (`MarcasConversacion`) y el
      // turno se guarda aquí abajo. Editar un texto ya no puede romperlo.
      const intento = (conv0.intentosConfirmacion ?? 0) + 1;

      const c = await atenderConfirmacion({
        tenantId: op.tenantId,
        operadorId: op.operadorId,
        texto: msg.text,
        viajeActual: viajeId,
        intento,
      });
      if (c.mensaje) {
        logger.info('viaje.inicio', { viaje: c.viajeConfirmado ?? viajeId, intento, estado: c.estado });
        const entregado = await say(c.mensaje);
        // ── EL TURNO SE GUARDA ───────────────────────────────────────────────
        //
        // Mismo criterio que el cierre del agente: los turnos del OPERADOR se
        // guardan siempre (ocurrieron), y el del asistente solo si Meta lo
        // aceptó — un mensaje rebotado que quedara en el historial haría que el
        // agente diera por dicho algo que el chofer nunca leyó, y que el
        // contador de intentos cobrara una pregunta que no salió.
        const turnos: ConvTurn[] = [...conv0.turns, { role: 'user', content: msg.text }];
        await saveConversation(
          conv0.id,
          entregado ? [...turnos, { role: 'assistant', content: c.mensaje }] : turnos,
          viajeId,
          {
            // Solo cuentan las veces que se le VOLVIÓ A PREGUNTAR. Un "no" o un
            // viaje confirmado cierran el asunto: dejar el contador arriba haría
            // que la primera duda del SIGUIENTE viaje lo mandara con el
            // encargado sin haberle preguntado nunca.
            intentosConfirmacion:
              entregado && (c.estado === 'ambiguo' || c.estado === 'esperando_confirmacion') ? intento : 0,
            cierreSinComprobantes: conv0.cierreSinComprobantes,
          },
        );
        return;
      }
    } catch (e) {
      logger.error('viaje.confirmacion_no_consultada', {
        viaje: viajeId, err: e instanceof Error ? e.message : String(e),
      });
    }

    // ── COMPROBANTES QUE ESPERABAN VIAJE (mig. 0040) ─────────────────────────
    //
    // Ya hay viaje, así que por fin hay dónde ponerlos. NO se adjuntan solos: un
    // ticket del viaje anterior metido en éste es dinero en la liquidación
    // equivocada, y nadie lo nota hasta que el contralor paga. Se enseña qué hay
    // y se pregunta.
    //
    // Todo este bloque es best-effort: `getHuerfanos` devuelve [] ante un error
    // de lectura, y no poder leer la sala de espera NO puede impedirle al
    // operador cerrar el viaje que sí tiene.
    // SOLO SE OFRECE LO QUE TIENE MONTO. Desde que el fallo técnico de OCR
    // guarda huérfano (arriba), la sala de espera puede contener comprobantes
    // cuyo monto NO se pudo leer: el `gasto` que dejó `extraerComprobante` en
    // esa rama trae `monto: 0`. Adjuntarlos metería una línea de $0.00 en la
    // liquidación del contralor —una cifra que no es una medición— y el
    // ofrecimiento le enseñaría al operador "• Otro · $0.00", que no le dice
    // nada. Se conservan (la foto y la fila son la evidencia de que existió) y
    // se recuperan reenviando la foto, que es lo que su propio mensaje le pide.
    const enEspera = (await getHuerfanos(op.tenantId, op.operadorId))
      .filter((h) => h.gasto.monto > 0);
    if (enEspera.length) {
      const ofrecidos = enEspera.filter((h) => h.ofrecidoEn);
      const comoLista = (hs: typeof enEspera) => hs.map((h) => ({
        monto: h.gasto.monto,
        etiqueta: etiquetaConcepto(h.gasto.concepto, h.gasto.ocrExtra as Record<string, unknown> | undefined),
      }));

      if (ofrecidos.length && esAfirmacion(msg.text)) {
        // Se marcan DESPUÉS de insertar, no antes: si un `addGasto` falla a
        // medias, lo que queda es una fila todavía pendiente —que se vuelve a
        // ofrecer— y no un comprobante marcado como puesto que no está.
        const puestos: string[] = [];
        for (const h of ofrecidos) {
          try {
            await addGasto(op.tenantId, viajeId, h.gasto);
            puestos.push(h.id);
          } catch (e) {
            // Un duplicado benigno también cuenta como resuelto: el comprobante
            // YA está en el viaje, que es lo que el operador pidió.
            if (violaIndice(e, 'uq_gasto_img_hash') || violaIndice(e, 'uq_gasto_cfdi_uuid')) { puestos.push(h.id); continue; }
            logger.error('huerfano.adjuntar_error', { err: e instanceof Error ? e.message : String(e) });
          }
        }
        await resolverHuerfanos(op.tenantId, puestos, 'adjuntado', viajeId);
        const ok = ofrecidos.filter((h) => puestos.includes(h.id));
        logger.info('huerfano.adjuntados', { viaje: viajeId, cuantos: ok.length, de: ofrecidos.length });
        // EL NETO, con el MISMO `copiasDeComprobante` que usan el motor y el PDF.
        // Un segundo cálculo aquí se separaría del cuadre en silencio, que es el
        // error que este repo ya ha pagado tres veces.
        const neto = await (async () => {
          try {
            const todos = await getGastos(viajeId, op.tenantId);
            const copias = copiasDeComprobante(todos);
            const comprobado = todos.reduce(
              (s, g) => (copias.has(g.id) || !(g.monto > 0) ? s : s + g.monto), 0);
            return { copias: copias.size, comprobado };
          } catch { return undefined; } // sin neto se calla, no se arriesga la cifra
        })();
        await say(ok.length
          ? mensajeAdjuntados(comoLista(ok), neto)
          : 'No pude agregarlos ⚙️. Siguen guardados; lo intento otra vez en un momento.');
        return;
      }

      if (ofrecidos.length && esNegacion(msg.text)) {
        await resolverHuerfanos(op.tenantId, ofrecidos.map((h) => h.id), 'descartado', null);
        logger.info('huerfano.descartados', { viaje: viajeId, cuantos: ofrecidos.length });
        // "dime cuál y lo pongo" ERA IMPOSIBLE POR PARTIDA DOBLE, y se decía
        // JUSTO DESPUÉS de descartarlos: `resolverHuerfanos` acaba de poner
        // `resuelto_en`, y `getHuerfanos` filtra por `resuelto_en is null`, así
        // que esos papeles ya no existen para el sistema. Aunque siguieran
        // existiendo, no hay ningún camino que lea "el de diésel" y adjunte uno
        // solo: `esAfirmacion` y `esNegacion` son todo o nada a propósito.
        //
        // Lo que SÍ funciona es reenviar la foto: entra como alta normal, y como
        // el huérfano descartado nunca llegó a `gasto`, no hay contra qué
        // duplicar.
        await say('Va, no los agrego a este viaje 👍. Ya no te los vuelvo a ofrecer. Si alguno sí era de aquí, mándame otra vez su foto y lo registro.');
        return;
      }

      // AÚN NO SE LE HA PREGUNTADO. Se aparta cuando el mensaje parece un
      // cierre: interceptar un "listo" con una pregunta lo obligaría a
      // escribirlo dos veces, y en una sala eso se ve como que no entendió.
      // Perder la oferta este turno no cuesta nada — se le vuelve a hacer.
      // (La condición vive en `pareceCierre`, arriba: la comparte con el freno
      // del cierre sin comprobantes.)
      if (!ofrecidos.length && !pareceCierre(msg.text)) {
        const viaje = await getViaje(viajeId, op.tenantId).catch(() => null);
        await marcarHuerfanosOfrecidos(op.tenantId, enEspera.map((h) => h.id));
        logger.info('huerfano.ofrecidos', { viaje: viajeId, cuantos: enEspera.length });
        await say(mensajeOfrecer(comoLista(enEspera), viaje?.destino ? `${viaje.origen ?? ''}${viaje.origen ? '→' : ''}${viaje.destino}` : undefined));
        return;
      }
    }

    // BARRERA DE RÁFAGA: espera a que terminen los OCR de fotos en vuelo antes de
    // cuadrar — así "listo" nunca cierra sobre datos parciales. NUNCA es infinito:
    // si vence, se cuadra con lo que haya y se avisa al operador.
    const intakeOk = await esperarIntake(viajeId, reloj.acotar(20_000));
    if (!intakeOk) logger.warn('intake.barrera_timeout', { viaje: viajeId, restanteMs: reloj.restante() });

    // Mutex para serializar cierres concurrentes (dos "listo" a la vez).
    //
    // Si NO se consigue, se ABANDONA el turno. Antes solo se dejaba un warn y se
    // seguía de largo sin mutex, que es justo lo que el mutex viene a impedir:
    // dos "listo" seguidos y el segundo corre el agente completo también. La BD
    // impide la doble fila (upsert), pero como el upsert no lanza, ambas
    // ejecuciones reportan éxito → el operador recibe el cierre y el PDF DOS
    // veces, y se paga el LLM dos veces.
    //
    // Abandonar es seguro porque `false` significa una sola cosa: otro turno
    // tiene el lease vigente y ESE va a responder. Los errores de la RPC no
    // llegan aquí — `acquireViajeLock` es fail-open ante RPC ausente o fallo
    // persistente, y devuelve `true`.
    //
    // AUDITORÍA 7, ALTO — SE ABANDONABA EN SILENCIO Y PARA SIEMPRE. El comentario
    // que justificaba el `return` tenía razón en que "otro turno va a
    // responder" — pero a SU mensaje, no al que se acaba de abandonar. Con dos
    // mensajes de texto en la ventana del agente (p. ej. "¿cuánto llevo?" y
    // "listo" 3s después), el segundo nunca corría el agente, nunca entraba a
    // `wa_conversacion.estado.turns`, y seguía reclamado en
    // `wa_mensaje_procesado` PARA SIEMPRE (este `return` no pasaba por
    // `releaseMessageClaim`). El operador veía sus dos palomitas azules y
    // ninguna respuesta a ese mensaje específico — el modo de falla "se trabó"
    // sin que nadie diga que se trabó.
    //
    // Fix acotado (la cola de verdad —con reintento real del turno perdido— es
    // FASE 3, deuda documentada en GUIA_BUILD.md): se AVISA en vez de callar, y
    // se libera el claim para que el mensaje no quede atascado. No resuelve
    // "el segundo mensaje se contesta", pero sí "el operador sabe que no se
    // perdió, y puede volver a mandarlo".
    if (await acquireViajeLock(viajeId, { maxWaitMs: reloj.acotar(12_000) })) {
      lockedViaje = viajeId;
    } else {
      logger.warn('viaje.lock_ocupado_abandona', { viaje: viajeId, tenant: op.tenantId, restanteMs: reloj.restante() });
      try {
        await say('Un momento, todavía estoy procesando tu mensaje anterior 🙏. En cuanto termine, vuelve a escribirme esto si sigue pendiente.');
      } catch { /* best-effort: el aviso es una cortesía, no puede tumbar la liberación del claim */ }
      if (msg.waMessageId) await releaseMessageClaim(msg.waMessageId);
      return;
    }

    // Doble "listo": tras tomar el lock, re-verifica que el viaje SIGA abierto. Si
    // otro "listo" ya lo cerró, no re-corras el agente (evita doble cuadre/costo).
    if ((await getOpenViaje(op.tenantId, op.operadorId)) !== viajeId) {
      await say('Ese viaje ya quedó cerrado 👍. Si te falta algo, tu flota te abre el siguiente.');
      return;
    }

    const tenant = await getTenantContext(op.tenantId);
    const conv = await loadConversation(op.tenantId, msg.from, viajeId);

    // ── EL CIERRE NO SE HACE SOLO PORQUE ALGUIEN ESCRIBIÓ "YA" ───────────────
    //
    // `guardar_liquidacion` cerraba con CERO comprobantes exactamente igual que
    // con veintidós, y el cierre es IRREVERSIBLE: los triggers de la 0036/0037
    // bloquean después cualquier alta o corrección sobre ese viaje. Con cero
    // comprobados la liquidación sale con el anticipo ENTERO en contra del
    // chofer, y basta un "ya voy" mal leído —`pareceCierre` empata "ya" seguido
    // de cualquier cosa— o un turno en que el modelo se adelante a la tool.
    //
    // El freno pregunta UNA sola vez por viaje. No se vuelve a preguntar aunque
    // insista, y por eso se guarda la marca: repreguntar en bucle es el otro
    // modo de falla de este archivo, el que dejó al chofer recibiendo "Perdón,
    // no te entendí" para siempre.
    //
    // EN EL CASO NORMAL NO CUESTA NADA: solo se consulta si el mensaje parece un
    // cierre, y con un solo comprobante registrado el freno no existe.
    if (pareceCierre(msg.text) && !conv.cierreSinComprobantes) {
      // FAIL-OPEN: si no se puede contar, no se frena. Un error de lectura no
      // puede impedirle cerrar a quien SÍ mandó sus comprobantes; el freno
      // existe para el caso raro, no para volverse el camino.
      const cuantos = await getGastos(viajeId, op.tenantId)
        .then((g) => g.filter((x) => x.monto > 0).length)
        .catch((e) => {
          logger.warn('cierre.freno_no_contado', { viaje: viajeId, err: e instanceof Error ? e.message : String(e) });
          return -1;
        });
      if (cuantos === 0) {
        logger.warn('cierre.sin_comprobantes_preguntado', { viaje: viajeId, tenant: op.tenantId });
        const aviso = 'Ojo antes de cerrar ⚠️ — no tengo *ningún comprobante* registrado en este viaje.\n\n' +
          'Si lo cierro así, tu liquidación va a decir que no comprobaste nada y el anticipo completo queda en tu contra. ' +
          'Y una vez cerrada ya no puedo agregarte tickets.\n\n' +
          'Si te faltan fotos, mándalas ahora. Si de verdad no traes comprobantes, escríbeme *listo* otra vez y lo cierro así.';
        const entregado = await say(aviso);
        const turnos: ConvTurn[] = [...conv.turns, { role: 'user', content: msg.text }];
        await saveConversation(
          conv.id,
          entregado ? [...turnos, { role: 'assistant', content: aviso }] : turnos,
          viajeId,
          // La marca solo se pone si el aviso SALIÓ. Si rebotó, el chofer no vio
          // la advertencia y su siguiente "listo" no puede contar como respuesta
          // a una pregunta que nunca leyó.
          { intentosConfirmacion: conv.intentosConfirmacion, cierreSinComprobantes: entregado },
        );
        return;
      }
    }

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
      // "Listo. 👍" SOLO si de verdad se hizo algo. Un turno sin texto y sin
      // ninguna tool no es un turno exitoso y callado: es un turno en el que no
      // pasó nada, y confirmarlo hace que el chofer deje de mandar comprobantes
      // creyendo que su viaje cerró. Cuando sí corrieron tools, el silencio del
      // modelo sí es benigno: el efecto ya ocurrió.
      reply = res.finalText || (res.toolCalls.length > 0
        ? 'Listo. 👍'
        : 'Perdón, no alcancé a procesar eso. ¿Me lo repites?');
      agentTools = res.toolCalls;
      closed = res.toolCalls.some((t) => t.toolName === 'guardar_liquidacion' && !t.error);
      ctxCerro = closed;
      // AUDITORÍA 10, MEDIO REINCIDENTE: si el ciclo cruzó de proveedor a medio
      // camino (primario en 3 rondas + fallback en la 4ª), `res.model` es solo
      // el modelo de la ÚLTIMA ronda — una sola fila con esa etiqueta le
      // atribuye TODO el gasto a un modelo que solo respondió una parte.
      // `res.costoPorModelo` viene de `generateWithTools` partido por modelo
      // real; con más de uno, se registra UNA FILA POR MODELO. Con uno solo
      // (el caso normal, sin fallback) o si el campo no viene —algún mock
      // viejo en pruebas— se conserva EXACTO el camino de siempre: una fila,
      // `res.model`.
      const modelosDelCiclo = Object.keys(res.costoPorModelo ?? {});
      if (modelosDelCiclo.length > 1) {
        for (const modelo of modelosDelCiclo) {
          const c = res.costoPorModelo[modelo];
          await registrarCosto({ tenantId: op.tenantId, viajeId, fase: faseDeModelo(modelo, 'cuadre'), modelo, tokensIn: c.tokensIn, tokensOut: c.tokensOut, costoUsd: c.cost });
        }
      } else {
        await registrarCosto({ tenantId: op.tenantId, viajeId, fase: faseDeModelo(res.model, 'cuadre'), modelo: res.model, tokensIn: res.tokensIn, tokensOut: res.tokensOut, costoUsd: res.costUsd });
      }
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

      // LO QUE SE GASTÓ ANTES DE CAERSE TAMBIÉN SE PAGÓ. Esta rama nunca llamaba
      // a `registrarCosto`, así que una liquidación recuperada por cierre parcial
      // salía con su PDF y su costo real quedaba invisible. En un negocio que
      // cobra POR LIQUIDACIÓN, el costo unitario se subestima justo en el caso
      // que más consume. Va antes del `if` para que se registre igual aunque el
      // cierre no se pueda recuperar: el dinero se fue de todos modos.
      if (e instanceof PartialExecutionError && (e.tokensIn > 0 || e.tokensOut > 0)) {
        try {
          await registrarCosto({
            tenantId: op.tenantId, viajeId, fase: faseDeModelo('', 'cuadre'),
            modelo: 'parcial', tokensIn: e.tokensIn, tokensOut: e.tokensOut, costoUsd: e.cost,
          });
        } catch (err2) {
          logger.error('agent.costo_parcial_no_registrado', { viaje: viajeId, err: err2 instanceof Error ? err2.message : String(err2) });
        }
      }
      const cierreParcial =
        recuperar && parcial?.find((t) => t.toolName === 'guardar_liquidacion' && !t.error);
      if (cierreParcial) {
        agentTools = parcial!;
        closed = true;
        // AUDITORÍA 7, ALTO REINCIDENTE de ronda 6: `ctxCerro` es el Único campo
        // que el log del catch general trae para distinguir "no pasó nada" de
        // "la liquidación YA se cerró y el operador se quedó sin nada". Faltaba
        // esta línea gemela a la de la línea ~623 (camino feliz) — sin ella, si
        // algo tronaba DESPUÉS de esta recuperación (p. ej. `saveConversation`),
        // el log mentía diciendo `cerroSinEntregar: false` sobre un cierre real.
        ctxCerro = closed;
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
        // Con tenant y viaje: sin ellos, a las 3am el log dice que algo falló
        // pero no qué liquidación, y hay que cruzarlo a mano con la hora.
        logger.error('agent.fail', { tenant: op.tenantId, viaje: viajeId, operador: op.operadorId, err: e instanceof Error ? e.message : String(e) });
        reply = 'Perdón, se me trabó el sistema tantito. ¿Me reenvías tu último mensaje?';
      }
    }

    // GUARDIA DETERMINÍSTICA (código, no prompt): el LLM NUNCA reporta cifras que
    // no vengan de una tool. Si la respuesta trae dinero y no hubo cuadrar_viaje,
    // se descarta el texto del modelo y se responde con el cuadre REAL. (f/g)
    let textoDeterminista = false;
    try {
      const g = await guardiaCifras(reply, agentTools, op.tenantId, viajeId);
      if (g.forzado) {
        logger.warn('agent.cifras_forzadas', { viaje: viajeId });
        reply = g.reply;
        textoDeterminista = true;
      }
    } catch (e) {
      logger.warn('guardia.fail', { err: e instanceof Error ? e.message : String(e) });
    }

    // GUARDIA DE FUNDAMENTO: el modelo solo puede citar una norma que una tool le
    // devolvió EN ESTE TURNO. Lo demás se le quita del mensaje.
    //
    // Va DESPUÉS de la guardia de cifras a propósito: si aquella sustituyó el
    // texto por el resumen determinístico, este ya no trae citas y esto no hace
    // nada. Al revés se estaría limpiando un texto que iba a descartarse.
    //
    // Se lee de lo que las tools DEVOLVIERON, no de lo que el modelo diga que le
    // devolvieron: leerlo del texto sería preguntarle a la guardia por sí misma.
    //
    // NO CORRE SI EL TEXTO YA ES DETERMINÍSTICO. Cuando `guardiaCifras` sustituye
    // la respuesta por `resumenCuadre`, ese texto lo escribió el MOTOR y sus
    // citas salen de `engine.ts`, no del modelo. Correr esta guardia encima con
    // `permitidas` vacío se las quitaba: la guardia corrompiendo justamente la
    // fuente autoritativa que existe para no depender del modelo.
    //
    // (Aquí había un comentario que afirmaba que ese texto "ya no trae citas".
    // Era falso, y lo demostró la auditoría 3.)
    // AUDITORÍA 8, ALTO REINCIDENTE (AG-2): sin ninguna tool en el turno,
    // `permitidas` salía vacío y la guardia borraba a media frase CUALQUIER
    // cita — incluida la que el propio sistema ya le mandó al operador en un
    // turno anterior de este MISMO viaje (el resumen de `engine.ts`, o una
    // respuesta de `consultar_politica` que ya pasó por esta misma guardia).
    // Repetir una cita que YA se entregó no es alucinar: es memoria.
    //
    // AUDITORÍA 9, ALTO: ese arreglo concedía la memoria por `norma_id` SOLO,
    // sin comprobar que la afirmación actual fuera la misma que la justificó
    // la primera vez — "RFA 2026 regla 2.9" (tope de diésel en efectivo) se
    // podía pegar sin tool en una frase sobre una caseta, y la guardia la
    // dejaba pasar porque el id ya se había visto en el viaje. Por eso ya no
    // se calcula aquí una lista de ids permitidos por memoria: se le pasa a
    // `guardiaFundamento` el HISTORIAL crudo, y es ella quien decide —oración
    // por oración, por tema— si la cita de hoy es la misma afirmación de ayer.
    //
    // `turns` (arriba) trae el historial persistido más el mensaje del
    // operador de ESTE turno; se filtra a `assistant` porque lo que el
    // operador escribe no pasa por aquí — ampliar el permiso con texto del
    // usuario sería dejar que él mismo se autorizara una cita.
    if (!textoDeterminista) try {
      const historialAsistente = turns.filter((t) => t.role === 'assistant').map((t) => t.content).join('\n');
      const permitidas = normasDeToolCalls(agentTools.filter((t) => !t.error).map((t) => t.result));
      const f = guardiaFundamento(reply, permitidas, historialAsistente);
      if (f.forzado) {
        logger.warn('agent.fundamento_forzado', { viaje: viajeId, tenant: op.tenantId, quitadas: f.quitadas });
        reply = f.reply;
      }
    } catch (e) {
      logger.warn('guardia_fundamento.fail', { err: e instanceof Error ? e.message : String(e) });
    }

    // ── La afirmación de ESTADO, contra el hecho que el servidor ya tiene ─────
    //
    // `guardiaCifras` impide inventar un número; nada impedía inventar un HECHO.
    // "Ya quedó cerrada tu liquidación ✅" pasaba entera con `toolCalls: []`: el
    // viaje seguía `abierto`, no había liquidación ni PDF, y el operador dejaba
    // de mandar comprobantes esperando algo que nadie iba a generar.
    //
    // No es una heurística sobre el mundo: `closed` sale de las tool calls, así
    // que la guardia no adivina, COTEJA. Va después del fundamento y antes de
    // `say` porque es lo último que puede desmentir el texto.
    if (!textoDeterminista) {
      // `entrego` NO es `false` aquí, y esa fue la regresión de la auditoría 6:
      // el PDF se intenta 30 líneas más abajo, así que en este punto el envío
      // está PENDIENTE, no descartado. Con `false` la guardia leía como mentira
      // cualquier pretérito del modelo y sustituía el mensaje por "todavía no he
      // cerrado tu liquidación" — justo antes de mandar el PDF de la liquidación
      // cerrada. Ver `EstadoReal.entrego`.
      const est = guardiaEstado(reply, { cerro: closed, entrego: closed ? 'pendiente' : false });
      if (est.forzado) {
        logger.error('agent.estado_falso', { viaje: viajeId, tenant: op.tenantId, motivos: est.motivos });
        reply = est.reply;
      }
    }

    const entregado = await say(reply);

    // Si la barrera de intake venció (un OCR tardó demasiado), avisa que se
    // cuadró con lo que alcanzó — falla visible, no silenciosa.
    // EL `try` ENVUELVE TAMBIÉN EL `getGastos`, y esa es la corrección.
    //
    // Estaba FUERA: si `getGastos` lanzaba —un blip de Supabase, justo cuando la
    // barrera venció porque la base ya iba lenta— el control saltaba al `catch`
    // general, que está DESPUÉS del bloque del PDF. Resultado con la liquidación
    // ya cerrada y los dos PDF ya en storage: el operador recibía "Perdón, se me
    // trabó tantito, ¿me reenvías tu último mensaje?", obedecía, y `getOpenViaje`
    // ya no encontraba nada porque el viaje estaba `liquidado`. Callejón sin
    // salida: liquidación cerrada, PDF existente, y ningún camino por el que
    // llegue. `pdf.no_entregado` tampoco se disparaba, porque vive dentro del
    // bloque que se saltó.
    //
    // Un aviso accesorio no puede tirar la entrega del entregable.
    //
    // AUDITORÍA 8, ALTO: "reenvíalo y escribe *listo* otra vez" se escribió
    // cuando reenviar funcionaba. Con `closed`, la liquidación YA se emitió y
    // las dos instrucciones son imposibles: reenviar truena con el trigger de
    // la 0036 (`trg_gasto_no_tras_liquidar`) y "listo" ya no encuentra viaje
    // abierto. El consejo se distingue por `closed`, igual que el mensaje
    // gemelo de `llegoTarde` (arriba, línea ~526) para el mismo hecho.
    // AUDITORÍA 9, MEDIO agéntico: la primera mitad del aviso ("cuadré con los
    // N comprobantes") afirmaba un cuadre que, sin `closed`, no ocurrió —el
    // agente pudo simplemente haber contestado un saludo sin llamar ninguna
    // tool, el viaje sigue `abierto`, y no hay liquidación ni PDF. Es la misma
    // clase de mentira que `guardiaEstado` existe para tapar, solo que este
    // texto no pasa por ninguna guardia. Se bifurca la frase ENTERA por
    // `closed`, no solo el consejo (que ya se bifurcaba desde la ronda 8).
    if (!intakeOk) {
      try {
        const n = (await getGastos(viajeId, op.tenantId)).length;
        const aviso = closed
          ? `⚠️ Ojo: cuadré con los ${n} comprobantes que alcancé a procesar. Guárdalo: mándalo en tu siguiente viaje o pídele a la oficina que lo agregue desde el panel.`
          : `⚠️ Ojo: uno de tus comprobantes tardó más de lo normal en procesarse — llevo ${n} guardados de este viaje, pero todavía no cuadro nada. Si te faltó alguno, reenvíalo y escribe *listo* cuando quieras que cuadre.`;
        await say(aviso);
      } catch (e) {
        logger.warn('intake.aviso', { viaje: viajeId, tenant: op.tenantId, err: e instanceof Error ? e.message : String(e) });
      }
    }

    if (closed) {
      // `guardar_liquidacion` devuelve `pdf_generado` y ese dato se tiraba. Si el
      // PDF no se generó —o el upload a storage falló— se pedía igual una URL
      // firmada de un objeto que no existe: `createSignedUrl` no lanza, devuelve
      // `{ data: null, error }`, el error se descartaba en el destructuring, no
      // había `else` y el `catch` nunca se disparaba. El operador se queda
      // esperando el documento que el prompt le prometió, y en los logs no hay
      // NADA. En el demo es el paso 3 del guion fallando en silencio.
      const guardado = agentTools.find((t) => t.toolName === 'guardar_liquidacion' && !t.error);
      const pdfGenerado = Boolean((guardado?.result as { pdf_generado?: boolean } | undefined)?.pdf_generado);
      // AUDITORÍA 8/9, MEDIO REINCIDENTE (backend): el ejemplar del CONTRALOR
      // —quien decide la compra— es el que queda en `liquidacion.pdf_path` y
      // el botón de descarga del panel. Su fallo era invisible: nada lo
      // revisaba, así que un upload roto solo del lado del contralor pasaba
      // exactamente igual que el camino feliz. No hay a quién avisarle por
      // WhatsApp (el contralor no tiene este chat), así que la única
      // reparación disponible es hacerlo RUIDOSO en el log — mismo criterio
      // que ya usa `pdf.no_entregado` dos líneas abajo para el caso gemelo
      // del operador.
      const pdfContralorGenerado = Boolean((guardado?.result as { pdf_contralor_generado?: boolean } | undefined)?.pdf_contralor_generado);
      if (!pdfContralorGenerado) {
        const liqId = (guardado?.result as { liquidacion_id?: string } | undefined)?.liquidacion_id;
        logger.error('pdf.contralor_no_generado', { tenant: op.tenantId, viaje: viajeId, liqId });
      }
      try {
        if (!pdfGenerado) throw new Error('la tool reportó pdf_generado=false');
        // El ejemplar del OPERADOR, no el completo: ver `tools.ts`.
        const path = `${op.tenantId}/${viajeId}-operador.pdf`;
        // AUDITORÍA 8, ALTO REINCIDENTE: `createSignedUrl` seguía crudo, sin
        // `acotada` — el único de los 13 pasos del cierre que faltaba en este
        // archivo. Ya está dentro de un try/catch que lo maneja bien; lo que
        // faltaba era no colgarse 300s antes de llegar a ese catch.
        //
        // AUDITORÍA 9, MEDIO REINCIDENTE ×4 (rondas 5, 6, 8 y 9): el TTL seguía
        // en 3600s aunque el único consumidor es Meta, que descarga en
        // segundos, y el objeto lleva folio y montos de un ticket de un bucket
        // privado. `api/export/pdf/[id]/route.ts:59` ya nació con el TTL
        // correcto (60s, "la necesidad dura lo que tarda la descarga") — se
        // copia el mismo número aquí en vez del que se copió de más viejo.
        const { data, error } = await acotada(supabaseAdmin().storage.from('liquidaciones').createSignedUrl(path, 60), 'createSignedUrl');
        if (error || !data?.signedUrl) throw new Error(error?.message ?? 'storage no devolvió URL firmada');
        // AUDITORÍA 12, ALTO (backend, reincidente de ronda 10): `sendDocument`
        // NO lanza — devuelve { ok: false, error } cuando Meta rechaza el
        // documento. Sin comprobar el resultado, un PDF rechazado por Meta se
        // leía como entregado: el chofer se queda esperando su liquidación y en
        // los logs no hay NADA. Mismo criterio que `pdf.contralor_no_generado`
        // dos bloques arriba: la reparación es hacerlo RUIDOSO.
        const enviado = await sendDocument(msg.from, data.signedUrl, 'liquidacion.pdf', 'Aquí está tu liquidación 📄');
        if (!enviado.ok) {
          logger.error('pdf.no_entregado', {
            viaje: viajeId, tenant: op.tenantId, codigo: enviado.codigo, error: enviado.error,
          });
          // AUDITORÍA 13, BAJO (residual del cierre de la ronda 12): el rechazo
          // de Meta dejaba rastro pero SILENCIO en el teléfono del chofer — se
          // quedaba esperando el PDF que el prompt le prometió. Se le dice la
          // verdad y a quién pedirlo; la liquidación ya está cerrada y el
          // contralor la tiene en el panel.
          await sendText(msg.from, 'Tu liquidación ya quedó cerrada ✅, pero el PDF no se te entregó por un problema del chat. Pídeselo a tu contralor: él ya lo tiene en el panel. 🙏').catch(() => {});
        } else {
          await registrarCostoWhatsApp(op.tenantId, viajeId);
        }

        // ── Y LA OFICINA SE ENTERA, CON EL PDF ───────────────────────────────
        //
        // Cierra el circuito: el trabajo entró por WhatsApp y el resultado sale
        // por WhatsApp. Si para tener el PDF hubiera que entrar a una pantalla,
        // la mitad de las veces nadie entra — y la liquidación existe pero no la
        // mira quien tiene que firmarla.
        //
        // BEST-EFFORT DURO: la liquidación YA está cerrada y el chofer YA tiene
        // su PDF. Un jefe sin teléfono registrado o un WhatsApp caído no pueden
        // costar una liquidación, así que esto no puede lanzar hacia arriba.
        // SE ESPERA, no se deja flotando. En serverless una promesa suelta puede
        // quedarse a medias cuando la invocación termina: el aviso al jefe
        // saldría "a veces", que es peor que no salir nunca porque nadie lo
        // reproduce. El try/catch es lo que impide que este await cueste el
        // cierre; son dos lecturas y un envío, no un presupuesto.
        try {
          const rj = await avisarCierreAlJefe({ tenantId: op.tenantId, viajeId, urlPdf: data.signedUrl });
          if (!rj.enviado) logger.warn('cierre.jefe_no_avisado', { viaje: viajeId, motivo: rj.motivo });
        } catch (e) {
          logger.error('cierre.aviso_jefe_falló', { viaje: viajeId, err: e instanceof Error ? e.message : String(e) });
        }
      } catch (e) {
        // Ruidoso a propósito: la liquidación SÍ quedó cerrada en la base, así que
        // esto no es recuperable por reintento y nadie lo va a notar salvo por el log.
        logger.error('pdf.no_entregado', {
          tenant: op.tenantId, viaje: viajeId, pdfGenerado,
          err: e instanceof Error ? e.message : String(e),
        });
        // Y se le dice al operador, en vez de dejarlo esperando: el cierre es
        // real, lo que falta es el papel.
        try {
          await say('Tu liquidación ya quedó cerrada ✅, pero no pude generarte el PDF. Tu contralor ya la tiene en el panel; si necesitas el documento, pídeselo. 🙏');
        } catch { /* best-effort */ }
      }
    }

    // LA CONVERSACIÓN GUARDA LO QUE EL OPERADOR LEYÓ, no lo que se intentó
    // decirle. Si el envío rebotó, ese turno NO entra: dejarlo haría que el
    // agente diera por dicho algo que el operador nunca vio, y en el siguiente
    // mensaje respondiera desde una charla que solo existió de este lado.
    //
    // Los turnos del OPERADOR sí se guardan siempre: ésos sí ocurrieron, y
    // perderlos borraría lo único que él sí mandó.
    await saveConversation(
      conv.id,
      entregado ? [...turns, { role: 'assistant', content: reply }] : turns,
      closed ? null : viajeId,
      // Las marcas se ARRASTRAN, no se recalculan: este turno no las tocó. Si se
      // omitieran, `saveConversation` las borraría (reescribe el jsonb entero) y
      // un error transitorio del atajo de confirmación —que cae al agente por su
      // try/catch— reiniciaría el contador de intentos.
      { intentosConfirmacion: conv.intentosConfirmacion, cierreSinComprobantes: conv.cierreSinComprobantes },
    );
    if (!entregado) logger.error('wa.respuesta_no_entregada', { tenant: op.tenantId, viaje: viajeId });
  } catch (e) {
    // CR-2: si el procesamiento crashea, liberar el claim para que el retry de
    // Meta lo reprocese (at-least-once). El OCR/agente ya tienen sus propios
    // catch; esto atrapa lo inesperado (descarga, DB, red) antes de perder dinero.
    //
    // `ConsultaFallida` se distingue a propósito: significa que la BASE NO
    // CONTESTÓ, no que el operador o su viaje no existan. Antes esa misma
    // situación devolvía `null` y el producto afirmaba un hecho falso —"no te
    // tengo registrado", "ese viaje ya quedó cerrado 👍"— sobre un operador dado
    // de alta y un viaje abierto. Aquí no se afirma nada: se dice que no se pudo
    // consultar, que es lo único cierto, y se le pide reintentar.
    const noSePudoConsultar = e instanceof ConsultaFallida;
    const ambiguo = e instanceof OperadorAmbiguo;
    logger.error(
      ambiguo ? 'processInbound.operador_ambiguo'
        : noSePudoConsultar ? 'processInbound.consulta_fallida'
        : 'processInbound.fail',
      {
        id: msg.waMessageId, de: msg.from,
        tenant: ctxTenant, viaje: ctxViaje,
        // Si esto sale `true`, la liquidación YA está cerrada en la base y el
        // operador acaba de recibir "se me trabó": hay un PDF sin entregar y
        // reenviar el mensaje NO lo va a arreglar, porque el viaje ya no está
        // abierto. Es la señal de que alguien tiene que entrar a mano.
        cerroSinEntregar: ctxCerro,
        err: e instanceof Error ? e.message : String(e),
      },
    );
    if (msg.waMessageId) await releaseMessageClaim(msg.waMessageId);
    // Al operador se le dice lo que es cierto en cada caso. Reintentar sirve
    // cuando falló la red; NO sirve cuando su número está duplicado en la base,
    // y decirle "inténtalo de nuevo" ahí lo deja en un bucle.
    const aviso = ambiguo
      ? 'Tu número aparece dado de alta más de una vez y no puedo saber a qué viaje pertenece 😕 Avísale a tu flota para que lo corrija; ya lo reporté.'
      : noSePudoConsultar
        ? 'No pude consultar tus datos en este momento 😕 No es que no estés registrado: es que la conexión falló. Vuelve a intentarlo en un minuto.'
        : 'Perdón, se me trabó tantito. ¿Me reenvías tu último mensaje? 🙏';
    try { await sendText(msg.from, aviso); } catch { /* best-effort */ }
  } finally {
    if (lockedViaje) await releaseViajeLock(lockedViaje);
  }
}
