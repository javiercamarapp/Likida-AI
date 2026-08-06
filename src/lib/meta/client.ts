// ═══════════════════════════════════════════════════════════════════════════
// Meta WhatsApp Cloud API — envío de mensajes y descarga de media entrante.
// Verificación HMAC del webhook (timing-safe).
// ═══════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';
import { logger } from '@/lib/logger';

const GRAPH = 'https://graph.facebook.com/v21.0';
const DOWNLOAD_TIMEOUT_MS = 15_000;
// AUDITORÍA 8, ALTO REINCIDENTE: `sendText`/`sendDocument` seguían con `fetch`
// pelado, sin `signal` — el mismo hueco que `repo.ts` ya cerró para Supabase.
// El default de undici (300s) contra un `maxDuration` de 120 significa que un
// solo envío colgado se lleva la invocación entera, y es el paso final del
// cierre: el PDF ya se generó, el operador solo se queda sin el mensaje que
// lo entrega.
const SEND_TIMEOUT_MS = 10_000;

function token(): string {
  const t = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!t) throw new Error('WHATSAPP_ACCESS_TOKEN no configurado');
  return t;
}
function phoneNumberId(): string {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!id) throw new Error('WHATSAPP_PHONE_NUMBER_ID no configurado');
  return id;
}

/** Verifica el token del GET de configuración del webhook (timing-safe). */
export function verifyWebhookChallenge(mode: string | null, verifyToken: string | null): boolean {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN ?? '';
  if (mode !== 'subscribe' || !expected || !verifyToken) return false;
  const a = Buffer.from(verifyToken);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Valida la firma HMAC-SHA256 del POST (X-Hub-Signature-256). */
export function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * El número al que WhatsApp acepta que le escribas, que NO es el que te manda.
 *
 * Medido contra la Graph API el 28-jul-2026, mismo destinatario, mismo token:
 *
 *   to: 5219993700779  →  (#131030) Recipient phone number not in allowed list
 *   to: 529993700779   →  aceptado, y contesta wa_id 5219993700779
 *
 * O sea: Meta ENTREGA los mensajes entrantes con el "1" mexicano en el `wa_id`,
 * y RECHAZA los salientes que lo lleven. Como el código contestaba al mismo
 * `from` que recibía, la respuesta rebotaba SIEMPRE — a todos los operadores
 * mexicanos, que son todo el mercado.
 *
 * Y rebotaba callando: `sendText` solo escribe en el log y no lanza, así que la
 * liquidación se daba por terminada con éxito mientras el operador no recibía
 * nada. El 200 del webhook y el `agent.run` en verde decían que todo iba bien.
 *
 * El "1" es una herencia de la numeración mexicana que WhatsApp dejó de usar
 * para enviar en 2020 pero sigue emitiendo en los `wa_id`. Se quita solo cuando
 * la forma es exactamente 52 + 1 + diez dígitos: ninguna otra lada se toca.
 */
export function destinatarioWhatsApp(telefono: string): string {
  const d = telefono.replace(/[^\d]/g, '');
  const mx = /^521(\d{10})$/.exec(d);
  return mx ? `52${mx[1]}` : d;
}

/**
 * Devuelve el wamid si Meta ACEPTÓ el mensaje, o `null` si lo rechazó.
 *
 * Devolvía `void`, y eso hacía imposible que un llamador supiera si su mensaje
 * salió. La constancia del aviso de privacidad se escribía antes de enviar y
 * nadie podía comprobar después: el 28-jul la base afirmó que un operador
 * recibió su aviso 10 minutos ANTES del commit que arregló el destinatario
 * mexicano que Meta rechazaba. El operador nunca lo recibió y la constancia
 * sigue ahí.
 *
 * Ojo con lo que este valor NO promete: un wamid significa aceptado, no
 * entregado. La entrega se confirma —o se desmiente— por el webhook de acuses.
 */
export async function sendText(to: string, body: string): Promise<string | null> {
  const res = await fetch(`${GRAPH}/${phoneNumberId()}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: destinatarioWhatsApp(to), type: 'text', text: { body } }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) { logger.error('wa.sendText', { status: res.status, body: await res.text().catch(() => '') }); return null; }
  // El ÉXITO también deja rastro. Sin esta línea, "se envió" y "nunca se llamó"
  // se ven igual en los logs —los dos, en blanco— y distinguirlos costó veinte
  // minutos de la primera prueba real. El id del mensaje es lo que permite
  // rastrearlo después en Meta.
  const id = await idDeRespuesta(res);
  logger.info('wa.sendText.ok', { id });
  return id ?? null;
}

// ── BOTONES INTERACTIVOS ────────────────────────────────────────────────────
//
// Límites de Meta, verificados en la documentación oficial de Cloud API
// ("Interactive reply buttons messages", consultada el 4-ago-2026). No son
// preferencias nuestras: pasarse de cualquiera de ellos hace que Meta rechace
// el mensaje ENTERO, no que lo recorte.
const MAX_BOTONES = 3;
const MAX_TITULO_BOTON = 20;    // caracteres del rótulo que ve el chofer
const MAX_ID_BOTON = 256;       // el id que nos devuelve el webhook al apretarlo
const MAX_CUERPO_BOTONES = 1024;

export interface BotonAcuse { id: string; titulo: string }

/**
 * Lo que hace que Meta rechace un mensaje de botones, dicho ANTES de mandarlo.
 *
 * Devuelve el meta del log —no una excepción— porque el contrato de `sendButtons`
 * es el de `sendText`: `null` y una línea en el log, nunca un throw.
 */
function motivoBotonesInvalidos(cuerpo: string, botones: BotonAcuse[]): Record<string, unknown> | null {
  if (botones.length === 0 || botones.length > MAX_BOTONES) {
    return { motivo: 'cantidad', botones: botones.length, max: MAX_BOTONES };
  }
  if (cuerpo.length > MAX_CUERPO_BOTONES) {
    return { motivo: 'cuerpo_largo', largo: cuerpo.length, max: MAX_CUERPO_BOTONES };
  }
  const titulosVistos = new Set<string>();
  for (const b of botones) {
    if (!b.id.trim()) return { motivo: 'id_vacio', titulo: b.titulo };
    if (b.id.length > MAX_ID_BOTON) return { motivo: 'id_largo', largo: b.id.length, max: MAX_ID_BOTON };
    if (!b.titulo.trim()) return { motivo: 'titulo_vacio', id: b.id };
    if (b.titulo.length > MAX_TITULO_BOTON) {
      return { motivo: 'titulo_largo', id: b.id, titulo: b.titulo, largo: b.titulo.length, max: MAX_TITULO_BOTON };
    }
    // Meta exige que los títulos sean ÚNICOS dentro del mensaje. Y aunque no lo
    // exigiera: dos botones con el mismo rótulo y distinto id son la misma cosa
    // para el chofer, que decide por lo que lee, no por el id que no ve.
    if (titulosVistos.has(b.titulo)) return { motivo: 'titulo_repetido', titulo: b.titulo };
    titulosVistos.add(b.titulo);
  }
  return null;
}

/**
 * Manda botones de respuesta rápida (`interactive` / `button`). Devuelve el wamid
 * si Meta ACEPTÓ el mensaje, o `null` si lo rechazó — mismo contrato que
 * `sendText`, y con la misma advertencia: aceptado no es entregado.
 *
 * ═══ SOLO DENTRO DE LA VENTANA DE 24 H ═══
 * Un mensaje interactivo NO es una plantilla. WhatsApp lo entrega únicamente
 * dentro de las 24 h desde el último mensaje DEL USUARIO, exactamente igual que
 * el texto libre de `sendText`. Fuera de esa ventana Meta responde 131047
 * ("Re-engagement message") y esto devuelve `null` sin que nada más lo delate:
 * quien lo llame para INICIAR una conversación —recordar un cierre, pedir un
 * POD— va a ver un envío que no sale y no va a entender por qué. Para eso está
 * `sendTemplate`, que es lo único que abre la ventana.
 *
 * ═══ UN TÍTULO QUE NO CABE NO SE MANDA RECORTADO ═══
 * Meta ya rechaza el mensaje entero cuando un título pasa de 20 caracteres, así
 * que truncar no evitaría el fallo: solo cambiaría cuál es. Y las dos formas de
 * "arreglarlo" en silencio hacen daño donde más duele:
 *   · un título recortado le enseña al chofer un botón DISTINTO del que se
 *     programó ("No cerrar todavía" → "No cerrar todaví"), y él aprieta lo que
 *     lee mientras el sistema recibe el id de otra cosa;
 *   · un cuerpo recortado puede partir una cifra a la mitad ($12,450 → $12,4),
 *     que es la regla que este producto no rompe.
 * Por eso se valida ANTES de llamar a Meta y se falla cerrado, dejando en el log
 * el botón culpable y su largo: el mismo `null` que da un rechazo de Meta, pero
 * ya diagnosticado.
 */
export async function sendButtons(to: string, cuerpo: string, botones: BotonAcuse[]): Promise<string | null> {
  const invalido = motivoBotonesInvalidos(cuerpo, botones);
  if (invalido) { logger.error('wa.sendButtons.invalido', invalido); return null; }

  const res = await fetch(`${GRAPH}/${phoneNumberId()}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: destinatarioWhatsApp(to),   // el "1" mexicano rebota igual aquí
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: cuerpo },
        action: { buttons: botones.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.titulo } })) },
      },
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) { logger.error('wa.sendButtons', { status: res.status, body: await res.text().catch(() => '') }); return null; }
  // El ÉXITO también deja rastro (misma lección que `sendText`): sin esta línea,
  // "se envió" y "nunca se llamó" se ven igual en los logs.
  const id = await idDeRespuesta(res);
  logger.info('wa.sendButtons.ok', { id, botones: botones.length });
  return id ?? null;
}

/**
 * Envía una PLANTILLA aprobada — lo único que WhatsApp permite cuando Likida
 * INICIA la conversación.
 *
 * POR QUÉ EXISTE Y `sendText` NO BASTA. WhatsApp solo deja mandar texto libre
 * dentro de la ventana de 24 h desde el último mensaje DEL USUARIO. Fuera de
 * ella, `sendText` no falla de forma obvia: Meta contesta un error que
 * `sendText` traga con un `logger.error` y un `null`, así que el panel daba por
 * mandado un recordatorio que nunca salió. Todo lo que Likida inicia —pedir un
 * POD, avisar de un anticipo, recordar un cierre— tiene que ir por aquí.
 *
 * DEVUELVE EL ERROR, NO LO TRAGA. `sendText` devuelve `null` tanto si falló
 * como si no se llamó, y esa ambigüedad ya costó veinte minutos una vez. Aquí
 * el que llama necesita distinguir "la plantilla no está aprobada" de "el
 * número no está en la lista de pruebas" para poder DECIRLO en pantalla: un
 * botón que falla en silencio es peor que no tenerlo.
 *
 * `idioma` es `es_MX` y no `es`: son plantillas distintas en Meta y pedir la
 * que no existe devuelve (#132001) con el mensaje sin enviar.
 */
export async function sendTemplate(
  to: string,
  plantilla: string,
  opciones: { idioma?: string; parametros?: string[] } = {},
): Promise<{ ok: true; id: string | null } | { ok: false; error: string; codigo?: number }> {
  const { idioma = 'es_MX', parametros = [] } = opciones;

  const componentes = parametros.length > 0
    ? [{ type: 'body', parameters: parametros.map((t) => ({ type: 'text', text: t })) }]
    : undefined;

  let res: Response;
  try {
    res = await fetch(`${GRAPH}/${phoneNumberId()}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: destinatarioWhatsApp(to),
        type: 'template',
        template: { name: plantilla, language: { code: idioma }, components: componentes },
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error('wa.sendTemplate.red', { plantilla, error });
    return { ok: false, error: `No se pudo contactar a WhatsApp: ${error}` };
  }

  if (!res.ok) {
    const crudo = await res.text().catch(() => '');
    let codigo: number | undefined;
    let mensaje = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(crudo) as { error?: { message?: string; code?: number } };
      codigo = j.error?.code;
      if (j.error?.message) mensaje = j.error.message;
    } catch { /* el crudo ya va en el log */ }
    logger.error('wa.sendTemplate', { plantilla, status: res.status, codigo, body: crudo.slice(0, 400) });
    return { ok: false, error: mensaje, codigo };
  }

  const id = await idDeRespuesta(res);
  logger.info('wa.sendTemplate.ok', { plantilla, id });
  return { ok: true, id: id ?? null };
}

/**
 * Traduce el error de Meta a algo que el encargado pueda accionar.
 *
 * Los dos que de verdad van a pasar en el demo son el 132001 (la plantilla no
 * existe o no está aprobada) y el 131030 (el número no está en la lista de
 * pruebas de la cuenta). Los dos se leen igual de crípticos en crudo y tienen
 * arreglos completamente distintos.
 */
export function motivoDeFalloWhatsApp(error: string, codigo?: number): string {
  switch (codigo) {
    case 132001:
      return 'La plantilla no está aprobada todavía en Meta. Mientras siga en revisión, este mensaje no puede salir.';
    case 131030:
      return 'Ese número no está en la lista de pruebas de la cuenta de WhatsApp. Mientras la cuenta esté en modo prueba, solo entrega a los teléfonos dados de alta a mano en Meta.';
    case 131047:
      return 'Pasaron más de 24 h desde el último mensaje del chofer y la plantilla no pudo abrir la conversación.';
    case 190:
      return 'El token de WhatsApp expiró. Hay que renovarlo en Meta.';
    default:
      return `WhatsApp lo rechazó: ${error}`;
  }
}

/** El wamid que devuelve Meta, para poder seguir el mensaje del lado de ellos. */
async function idDeRespuesta(res: Response): Promise<string | undefined> {
  try {
    const j = (await res.json()) as { messages?: { id?: string }[] };
    return j.messages?.[0]?.id;
  } catch { return undefined; }
}

/**
 * Envía un documento (PDF de liquidación) por link público o media id.
 *
 * DEVUELVE EL MISMO CONTRATO QUE `sendTemplate`, y no `void`, que es lo que
 * devolvía antes. El PDF es EL entregable del producto, y era justo el único
 * envío del archivo que no le decía al llamador si había salido:
 *
 *   · un rechazo de Meta (`!res.ok`) se registraba y se devolvía NORMAL, así
 *     que `processor.ts` cobraba el mensaje en la línea siguiente
 *     (`registrarCostoWhatsApp`) aunque el chofer no hubiera recibido nada, y
 *     `avisarCierreAlJefe` contestaba `{enviado:true}` sin una sola
 *     confirmación;
 *   · y un fallo de RED sí lanzaba, porque el `fetch` no estaba en try/catch —
 *     o sea que las dos mitades del mismo fallo se comportaban al revés.
 *
 * Ahora las dos devuelven `{ok:false, error, codigo}` y ninguna lanza, igual
 * que `sendTemplate`. Los DOS call sites ya revisan el resultado (cerrado en
 * las rondas 12-13): `avisar_cierre.ts` loguea `cierre.pdf_al_jefe_falló` y
 * `processor.ts` registra `pdf.no_entregado` y le avisa al chofer.
 */
export async function sendDocument(
  to: string,
  link: string,
  filename: string,
  caption?: string,
): Promise<{ ok: true; id: string | null } | { ok: false; error: string; codigo?: number }> {
  let res: Response;
  try {
    res = await fetch(`${GRAPH}/${phoneNumberId()}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: destinatarioWhatsApp(to),   // el PDF rebotaba igual que el texto
        type: 'document',
        document: { link, filename, caption },
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error('wa.sendDocument.red', { filename, error });
    return { ok: false, error: `No se pudo contactar a WhatsApp: ${error}` };
  }

  if (!res.ok) {
    const crudo = await res.text().catch(() => '');
    let codigo: number | undefined;
    let mensaje = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(crudo) as { error?: { message?: string; code?: number } };
      codigo = j.error?.code;
      if (j.error?.message) mensaje = j.error.message;
    } catch { /* el crudo ya va en el log */ }
    logger.error('wa.sendDocument', { filename, status: res.status, codigo, body: crudo.slice(0, 400) });
    return { ok: false, error: mensaje, codigo };
  }

  // Igual que en `sendText`: el envío del PDF es EL entregable, y su éxito no
  // dejaba ninguna huella. Meta acepta el mensaje y descarga el `link` después,
  // por su cuenta; sin el wamid no hay forma de preguntarle qué pasó con él.
  const id = await idDeRespuesta(res);
  logger.info('wa.sendDocument.ok', { id, filename });
  return { ok: true, id: id ?? null };
}

/**
 * Un `!res.ok` de la descarga de media, dicho en voz alta.
 *
 * Los cuatro `if (!res.ok) return null` de las dos descargas estaban FUERA del
 * `catch`, así que devolvían `null` sin una sola línea. Con el token de WhatsApp
 * vencido —que fue exactamente lo que pasó el 28-jul a las 12:00— TODAS las
 * fotos de TODOS los operadores fallan en silencio absoluto, y el producto le
 * responde al operador que reenvíe la foto: un remedio que no puede funcionar
 * nunca, porque el problema no está en su foto.
 *
 * Es la misma lección que `fc760c3` (el éxito también deja rastro), viva treinta
 * líneas más abajo del comentario que la documenta.
 */
async function avisarFalloMedia(paso: string, mediaId: string, res: Response): Promise<void> {
  logger.error('wa.media_no_descargada', {
    paso, mediaId, status: res.status,
    // El cuerpo de Meta es lo que distingue un token vencido (401/190) de un
    // media caducado (404): sin él, los dos se ven igual y llevan a arreglos
    // distintos.
    body: await res.text().catch(() => ''),
  });
}

/** Descarga un media entrante de Meta como TEXTO (para el XML del CFDI). */
export async function downloadMediaAsText(mediaId: string): Promise<string | null> {
  try {
    const meta = await fetch(`${GRAPH}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token()}` },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!meta.ok) { await avisarFalloMedia('metadatos', mediaId, meta); return null; }
    const { url } = (await meta.json()) as { url: string };
    const bin = await fetch(url, {
      headers: { Authorization: `Bearer ${token()}` },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!bin.ok) { await avisarFalloMedia('contenido', mediaId, bin); return null; }
    return await bin.text();
  } catch (e) {
    logger.warn('wa.downloadMediaText', { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** Descarga un media entrante de Meta y lo devuelve como data-URL para el OCR. */
export async function downloadMediaAsDataUrl(mediaId: string): Promise<string | null> {
  try {
    const meta = await fetch(`${GRAPH}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token()}` },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!meta.ok) { await avisarFalloMedia('metadatos', mediaId, meta); return null; }
    const { url, mime_type } = (await meta.json()) as { url: string; mime_type: string };
    const bin = await fetch(url, {
      headers: { Authorization: `Bearer ${token()}` },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!bin.ok) { await avisarFalloMedia('contenido', mediaId, bin); return null; }
    const buf = Buffer.from(await bin.arrayBuffer());
    return `data:${mime_type || 'image/jpeg'};base64,${buf.toString('base64')}`;
  } catch (e) {
    logger.warn('wa.downloadMedia', { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/**
 * Envía la RESPUESTA de una solicitud ARCO al titular (auditoría 15/16).
 * Texto libre: funciona dentro de la ventana de 24h desde el mensaje
 * PRIVACIDAD del titular (Meta permite responder en ese canal sin plantilla).
 * Fuera de la ventana devuelve false — la flota entrega por otro canal, y la
 * UI lo dice (no se miente como "recibió su respuesta").
 */
export async function enviarRespuestaArco(telefono: string, respuesta: string): Promise<{ ok: boolean; error?: string }> {
  const envia = (body: Record<string, unknown>) => fetch(`${GRAPH}/${phoneNumberId()}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: destinatarioWhatsApp(telefono), ...body }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });

  // 1. Texto libre: funciona DENTRO de la ventana de 24h desde el PRIVACIDAD
  //    del titular (Meta permite responder en ese canal sin plantilla).
  const res = await envia({ type: 'text', text: { body: respuesta } });
  if (res.ok) { logger.info('arco.envio_ok', { telefono }); return { ok: true }; }
  const crudo = await res.text().catch(() => '');

  // 2. Fuera de la ventana, Meta exige plantilla. La plantilla `respuesta_arco_v2`
  //    (creada 6-ago-2026) lleva {{1}} = razón social de la flota y {{2}} = la
  //    respuesta; aún en revisión de Meta — falla cerrado si no está aprobada.
  if (res.status === 400 || res.status === 403) {
    try {
      const j = JSON.parse(crudo) as { error?: { code?: number } };
      const FUERA_VENTANA = [131047, 131026, 131042];
      if (j.error?.code && FUERA_VENTANA.includes(j.error.code)) {
        const tpl = await envia({
          type: 'template',
          template: {
            name: 'respuesta_arco_v2', language: { code: 'es' },
            components: [{ type: 'body', parameters: [{ type: 'text', text: 'la flota' }, { type: 'text', text: respuesta }] }],
          },
        });
        if (tpl.ok) { logger.info('arco.envio_plantilla_ok', { telefono }); return { ok: true }; }
        const tplCrudo = await tpl.text().catch(() => '');
        logger.warn('arco.envio_plantilla_fallido', { telefono, status: tpl.status, body: tplCrudo.slice(0, 200) });
        return { ok: false, error: 'fuera de la ventana de 24h y la plantilla no está aprobada todavía' };
      }
    } catch { /* el crudo no era JSON — se reporta abajo */ }
  }
  logger.warn('arco.envio_fallido', { telefono, status: res.status, body: crudo.slice(0, 300) });
  return { ok: false, error: `HTTP ${res.status}` };
}
