import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { cuerpoAcotado } from '../_cuerpo';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { httpsPublico } from '@/lib/http/https_publico';
import { verificarFirma, mensajeDeRechazo } from '@/lib/correo/firma_entrante';
import { tokenDeDestinatarios, dominioBuzon } from '@/lib/correo/buzon';
import { atenderCorreoCartaPorte, tokenCpDeDestinatarios } from '@/lib/likida/carta_porte_docs/correo_entrante';
import { atenderCorreoPeajes, tokenPjDeDestinatarios } from '@/lib/likida/peajes/correo_entrante';
import { descargadorResend } from '@/lib/likida/carta_porte_docs/resend';
import { direccionDeCampana, esRespuestaACampana, procesarRespuestaCampana } from '@/lib/correo/respuesta_campana';
import { atenderAdjuntosBuzon, registrarAdjuntoDescartado, type AdjuntoBuzon } from '@/lib/likida/buzon/servicio';
import { estaApagado } from '@/lib/likida/interruptores';
import { registrarCorrida } from '@/lib/likida/agentes/corridas';
import { sanitizarTexto } from '@/lib/likida/intake/sanitizar';
import { rateLimit, clientIp } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/correo/entrante — el buzón de facturas de proveedor.
//
// Las facturas de talleres, refaccionarias y diésel llegan POR CORREO, no por
// WhatsApp. Es la pieza que multiplica a los agentes de Peajes y Proveedores, y
// la que el cliente de demo pidió con todas sus letras.
//
// ── EL ORDEN DE LAS COMPROBACIONES NO ES ARBITRARIO ──────────────────────
//
//  1. RATE LIMIT por IP, antes de leer nada — mismo patrón que
//     `/api/peajes/ingesta` (:44). La firma HMAC de Svix hace inviable
//     forjar un webhook sin `RESEND_WEBHOOK_SECRET`, pero una vez que SÍ hay
//     firma válida (cuenta de Resend comprometida, o un reenvío legítimo en
//     bucle) no había techo de cuántos correos/adjuntos por minuto podía
//     absorber un buzón. El BUZÓN (destinatario) solo se conoce tras leer y
//     parsear el cuerpo, así que aquí el identificador es la IP — igual que
//     peajes/ingesta antes de resolver la flota.
//  2. FIRMA después, antes de leer una sola cosa del cuerpo. Este endpoint es
//     un POST sin autenticar y lo que dispara no es inocuo: mete una factura
//     con su RFC, su monto y su UUID a la contabilidad de un cliente. Sin
//     firma, Likida sería un buzón por el que cualquiera empuja gasto falso.
//  3. TENANT después, y desde el DESTINATARIO —el buzón al que escribieron—,
//     nunca desde el remitente. El `from` de un correo se falsifica en dos
//     líneas; el token del destinatario no se adivina.
//  4. IDEMPOTENCIA al final: Resend reintenta ante cualquier respuesta que no
//     sea 2xx, y sin esto un reintento duplicaría la factura.
//
// ── QUÉ SE CONTESTA DESPUÉS DE LA FIRMA: 200 O 503, SEGÚN LA CLASE ───────
//
// Un 4xx/5xx hace que Resend reintente. Reintentar tiene sentido cuando el
// fallo es NUESTRO y transitorio (la base no contestó, la DESCARGA de un
// adjunto se cayó): ahí va 503, porque un 200 haría que ese CFDI no volviera
// jamás. No lo tiene cuando el correo simplemente no era para nosotros (buzón
// desconocido, sin adjuntos, un humano respondiendo "gracias") ni cuando el
// contenido no sirve (no es CFDI, pasa del tope de tamaño): el reintento trae
// exactamente lo mismo, y devolver error ahí genera una cola de reintentos que
// nunca va a tener éxito y ensucia el log donde vive lo que sí importa. Eso
// se registra y se responde 200.
// ═══════════════════════════════════════════════════════════════════════════

interface AdjuntoEntrante { id?: string; filename?: string; content_type?: string }
interface EventoCorreo {
  type?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    cc?: string[];
    subject?: string;
    /** El cuerpo de la respuesta — Resend lo entrega en el payload del
     *  email.received; lo lee SOLO el circuito de respuestas de campaña
     *  (c5-2) para detectar la BAJA. */
    text?: string;
    html?: string;
    attachments?: AdjuntoEntrante[];
  };
}

/** Los tipos que el buzón lee (Agente 9, 0530): XML (el CFDI), PDF (solo, o pareja del XML) y ZIP (con los
 *  límites de `buzon/zip_seguro.ts`). Cualquier otra cosa se ignora sin ruido. */
const PROCESABLES = /\.(xml|pdf|zip)$/i;

/** El adjunto más grande que se descarga. Un XML pesa decenas de KB — 4 MB ya es un archivo equivocado, no
 *  una factura grande; un PDF o un zip de varias facturas sí puede pesar más, hasta 12 MB. Sin tope, un
 *  correo hostil con un adjunto gigante se materializaría entero en memoria. */
const MAX_ADJUNTO_BYTES = 4 * 1024 * 1024;
const MAX_ADJUNTO_PDF_ZIP_BYTES = 12 * 1024 * 1024;
/** Lo que un solo correo puede acumular en memoria entre todos sus adjuntos. */
const MAX_BYTES_CORREO = 30 * 1024 * 1024;
/** A37-S09-04: tope de adjuntos que se intentan por correo (igual que `MAX_HOJAS_POR_CORREO` de la ingesta). */
const MAX_ADJUNTOS_POR_CORREO = 60;
/** Descargas simultáneas por correo: acota la memoria (4 × 12 MB) y cabe en el presupuesto de 57 s. */
const CONCURRENCIA_DESCARGA = 4;
const topeDe = (nombre: string): number => (/\.xml$/i.test(nombre) ? MAX_ADJUNTO_BYTES : MAX_ADJUNTO_PDF_ZIP_BYTES);
/** El webhook no necesita un JSON enorme: Resend solo entrega metadatos y la
 * descarga de los adjuntos va por otra URL. Limitarlo ANTES de verificar HMAC
 * evita que un POST sin firma nos haga materializar decenas de MB. */
const MAX_WEBHOOK_BYTES = 256 * 1024;


// El tope de la función, DECLARADO: de él sale el presupuesto de las descargas
// (ver `finPresupuesto` abajo). Sin un número explícito aquí, el presupuesto se
// calcularía contra un default de la plataforma que puede cambiar sin avisar.
export const maxDuration = 60;

/**
 * AUDITORÍA ADVERSARIAL ALTO #1 (A9) — SSRF EN LA DESCARGA DE ADJUNTOS.
 *
 * Las dos peticiones a Resend (los metadatos del adjunto y, con la
 * `download_url` que esos metadatos entregan, el binario) usaban `fetch()`
 * directo. Las demás salidas de red de este repo a un destino que NO es un
 * literal fijo propio pasan por `httpsPublico` (`peajes/pull.ts`,
 * `conectores/tms/sesion.ts`): DNS validado CONTRA la IP que de verdad abre el
 * socket (sin la ventana de DNS-rebinding de un `fetch` que resuelve dos
 * veces), sin credenciales en la URL y sin seguir redirects a ciegas. La
 * `download_url` la fabrica Resend, pero sigue siendo una URL dinámica que
 * esta función no controla — el mismo estándar aplica.
 *
 * No se siguen redirects (a propósito, a diferencia del investigador de
 * prospectos): un adjunto no necesita esa flexibilidad, y seguir un redirect a
 * ciegas en una descarga binaria es la clase de bypass de SSRF que esta
 * función existe para evitar. Si Resend alguna vez redirige esta descarga,
 * cuenta como fallo transitorio (503, Resend reintenta) — no un bypass.
 */
async function bajarAdjuntoResend(
  url: string, tope: number, timeoutMs: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; motivo: 'tope'; declarado: number } | { ok: false; motivo: 'http' }> {
  let declarado = 0;
  try {
    const r = await httpsPublico({
      url,
      metodo: 'GET',
      // El tope de ESTE adjunto (4 MB para XML, 12 MB para PDF/zip) con el
      // techo absoluto correspondiente: sin `maxBytesAbsoluto` el techo global
      // de `httpsPublico` (8 MiB) habría rechazado un PDF/zip legítimo de entre
      // 8 y 12 MB que el buzón siempre aceptó.
      maxBytes: tope,
      maxBytesAbsoluto: MAX_ADJUNTO_PDF_ZIP_BYTES,
      aceptar: (estado, encabezados) => {
        declarado = Number(encabezados['content-length'] ?? '') || 0;
        return true;
      },
    }, timeoutMs);
    if (r.estado < 200 || r.estado >= 300) return { ok: false, motivo: 'http' };
    return { ok: true, bytes: r.bytes };
  } catch (e) {
    // `httpsPublico` lanza tanto por red/timeout (transitorio) como por tope de
    // tamaño excedido (permanente: el reintento trae el mismo archivo). El
    // DECLARADO se capturó en `aceptar` ANTES de que el tope cortara la
    // descarga, así que el log de arriba puede decir el tamaño real sin
    // inventar una cifra para el caso chunked sin `content-length` (ahí queda
    // en 0: se dice honestamente que no se conoce, no se aproxima).
    const msg = e instanceof Error ? e.message : '';
    if (declarado > tope || /supera el límite/.test(msg)) return { ok: false, motivo: 'tope', declarado };
    return { ok: false, motivo: 'http' };
  }
}

export async function POST(req: Request) {
  // RATE LIMIT por IP, antes de leer el cuerpo o verificar el secreto — mismo
  // límite que `/api/peajes/ingesta` (60/min). El volumen esperado aquí es
  // comparable (un buzón recibe facturas sueltas de proveedor, no ráfagas),
  // así que no hay razón para un tope distinto.
  if (!(await rateLimit(`correo-entrante:ip:${clientIp(req)}`, 60, 60_000))) {
    logger.warn('correo_entrante.rate_limit', {});
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }

  // El cuerpo CRUDO: `JSON.parse` + `stringify` reordena llaves y la firma
  // dejaría de cuadrar. Ver `firma_entrante.ts`.
  const crudo = await cuerpoAcotado(req, MAX_WEBHOOK_BYTES);
  if (crudo === null) {
    logger.warn('correo_entrante.cuerpo_excede', { maxBytes: MAX_WEBHOOK_BYTES });
    return new NextResponse('Payload too large', { status: 413 });
  }

  const firma = verificarFirma(
    crudo,
    {
      id: req.headers.get('svix-id'),
      timestamp: req.headers.get('svix-timestamp'),
      signature: req.headers.get('svix-signature'),
    },
    process.env.RESEND_WEBHOOK_SECRET,
    Date.now(),
  );

  if (!firma.ok) {
    // El motivo real solo al log: distinguir "firma inválida" de "fuera de
    // tiempo" le enseñaría a quien lo intenta cómo ajustar su siguiente prueba.
    logger.warn('correo_entrante.firma', { motivo: firma.motivo });
    return new NextResponse(mensajeDeRechazo(), { status: 401 });
  }

  let evento: EventoCorreo;
  try {
    evento = JSON.parse(crudo) as EventoCorreo;
  } catch {
    logger.warn('correo_entrante.json_ilegible', {});
    return NextResponse.json({ ok: true, ignorado: 'json_ilegible' });
  }

  if (evento.type !== 'email.received') {
    return NextResponse.json({ ok: true, ignorado: 'otro_evento' });
  }

  const d = evento.data ?? {};
  const emailId = d.email_id;
  if (!emailId) {
    logger.warn('correo_entrante.sin_id', {});
    return NextResponse.json({ ok: true, ignorado: 'sin_id' });
  }

  // ── A QUÉ FLOTA ──────────────────────────────────────────────────────────
  // Del DESTINATARIO, jamás del remitente. Y se miran `to` y `cc` porque un
  // reenvío suele poner nuestro buzón en copia.
  const destinatarios = [...(d.to ?? []), ...(d.cc ?? [])];

  // ── CARTA PORTE MULTI-FORMATO (Agente 3, mig. 0420) ──────────────────────
  // El buzón `cp-<token>@…` es OTRO canal que comparte este webhook (mismo dominio, misma firma
  // Svix, ya verificada arriba). La flota sale del token del DESTINATARIO, igual que en el buzón de
  // facturas. Va ANTES del buzón de facturas: un correo a `cp-…` jamás se lee como factura.
  const tokenCp = tokenCpDeDestinatarios(destinatarios, dominioBuzon());
  if (tokenCp) {
    const finCp = Date.now() + (maxDuration * 1000 - 3_000);
    const restanteCp = () => finCp - Date.now();
    const r = await atenderCorreoCartaPorte(
      tokenCp,
      { emailId, from: d.from, subject: d.subject, text: d.text, html: d.html, attachments: d.attachments },
      { descargar: descargadorResend(process.env.RESEND_API_KEY ?? '', restanteCp), restanteMs: restanteCp },
    );
    return NextResponse.json(r.cuerpo, { status: r.status });
  }
  // ── PEAJES (Agente 2, mig. 0563) ─────────────────────────────────────────
  // El buzón `pj-<token>@…` recibe el desglose del proveedor de telepeaje: mismo dominio, misma firma
  // Svix ya verificada, y la flota sale del token del DESTINATARIO. Va antes del buzón de facturas.
  const tokenPj = tokenPjDeDestinatarios(destinatarios, dominioBuzon());
  if (tokenPj) {
    const finPj = Date.now() + (maxDuration * 1000 - 3_000);
    const restantePj = () => finPj - Date.now();
    const r = await atenderCorreoPeajes(
      tokenPj,
      { emailId, from: d.from, subject: d.subject, text: d.text, html: d.html, attachments: d.attachments },
      { descargar: descargadorResend(process.env.RESEND_API_KEY ?? '', restantePj) },
    );
    return NextResponse.json(r.cuerpo, { status: r.status });
  }
  const token = tokenDeDestinatarios(destinatarios);
  if (!token) {
    // ── LA RESPUESTA DE CAMPAÑA (c5-2) ─────────────────────────────────────
    // Antes de descartar como sin_buzon: si el destinatario es el buzón del
    // que SALE la campaña (avisos@), esto es una respuesta a un correo de
    // prospección — la BAJA se honra, la respuesta va al historial (detiene
    // al SDR) y el operador recibe el aviso. Un fallo al escribir contesta
    // 503 para que Resend reintente: perder la respuesta deja a la máquina
    // insistiéndole a quien ya contestó.
    const buzonCampana = direccionDeCampana();
    if (buzonCampana && esRespuestaACampana(destinatarios, buzonCampana)) {
      const r = await procesarRespuestaCampana(d);
      if (!r.ok) {
        logger.error('correo_entrante.respuesta_campana', { emailId, motivo: r.motivo });
        return NextResponse.json({ error: 'no se pudo registrar la respuesta' }, { status: 503 });
      }
      return NextResponse.json({ ok: true, campana: r.resultado });
    }
    // No se registra el correo del remitente: es un dato personal y este log no
    // es el lugar. El `email_id` alcanza para rastrearlo en Resend.
    logger.warn('correo_entrante.sin_buzon', { emailId });
    return NextResponse.json({ ok: true, ignorado: 'sin_buzon' });
  }

  const { data: flota, error: errFlota } = await supabaseAdmin()
    .from('tenant').select('id, rfc').eq('buzon_token', token).maybeSingle();

  if (errFlota) {
    // ESTE sí es un fallo nuestro y transitorio: aquí SÍ conviene que Resend
    // reintente, porque el correo era válido y se perdería.
    logger.error('correo_entrante.lectura_flota', { emailId, err: errFlota.message });
    return NextResponse.json({ error: 'no se pudo resolver la flota' }, { status: 503 });
  }
  if (!flota) {
    // Token con forma buena que no corresponde a nadie: un buzón rotado. No se
    // reintenta.
    logger.warn('correo_entrante.buzon_desconocido', { emailId });
    return NextResponse.json({ ok: true, ignorado: 'buzon_desconocido' });
  }

  const adjuntos = (d.attachments ?? []).filter((a) => PROCESABLES.test(a.filename ?? ''));
  if (adjuntos.length === 0) {
    // Un humano contestando "gracias" al hilo. No es un error.
    logger.info('correo_entrante.sin_adjuntos', { emailId, tenantId: flota.id });
    return NextResponse.json({ ok: true, ignorado: 'sin_adjuntos' });
  }

  // ── EL KILL SWITCH (0110), ANTES DE CONSUMIR EL CORREO ──────────────────
  // Fase 1 del blueprint (15-ago-2026): `agente:proveedores` existía en el
  // catálogo y NINGÚN call site lo preguntaba — apagarlo no apagaba nada.
  // Va DESPUÉS de los descartes (un "gracias" sin adjuntos sigue saliendo
  // 200 con el agente apagado: no hay nada que perder) y ANTES del dedup,
  // para que el correo no quede consumido. Se contesta 503 y NO 200 a
  // propósito — al revés que el cron de facturar/cola—: aquí un 200 le diría
  // a Resend que no reintente y ese CFDI se perdería PARA SIEMPRE; el 503
  // hace que vuelva cuando enciendan la palanca. Fail-closed: si el
  // interruptor no se puede LEER, no se procesa (estaApagado devuelve
  // apagado con grito en el log — ver interruptores.ts).
  if (await estaApagado('agente:proveedores')) {
    logger.warn('correo_entrante.saltado', { emailId, tenantId: flota.id, interruptor: 'agente:proveedores' });
    return NextResponse.json({ error: 'el agente de proveedores está apagado' }, { status: 503 });
  }

  // ── LA LLAVE DEL CANAL, ANTES DE CONSUMIR EL CORREO ──────────────────────
  // Se comprueba ANTES de registrar en `correo_procesado`: registrar y luego
  // contestar 503 dejaría el correo consumido — el reintento de Resend
  // chocaría con la llave primaria, saldría como "ya_procesado" sin haber
  // guardado nada, y ese CFDI no volvería jamás.
  const llave = process.env.RESEND_API_KEY;
  if (!llave) {
    logger.error('correo_entrante.sin_llave', { emailId });
    return NextResponse.json({ error: 'canal no configurado' }, { status: 503 });
  }

  // ── CLAIM DURABLE, ANTES DE PROCESAR NADA ────────────────────────────────
  // `insert` + `delete` parecía idempotencia, pero pierde el correo con dos
  // entregas concurrentes: A toma la fila, B ve duplicado y recibe 200; si A
  // muere antes del delete/finalize, Meta ya no volverá a mandar B. La RPC 0177
  // entrega un token con lease. `busy` devuelve 503 para que B siga viva hasta
  // que A aplique o el lease venza; solo `applied` es un acuse definitivo.
  const { data: datosClaim, error: errClaim } = await supabaseAdmin().rpc('reclamar_correo', {
    p_email_id: emailId, p_lease_seconds: 90,
  });
  if (errClaim) {
    logger.error('correo_entrante.claim', { emailId, err: errClaim.message });
    return NextResponse.json({ error: 'no se pudo reclamar el correo' }, { status: 503 });
  }
  const claim = (datosClaim ?? [])[0] as { resultado?: string; token?: string | null } | undefined;
  if (claim?.resultado === 'applied') {
    logger.info('correo_entrante.repetido', { emailId, tenantId: flota.id });
    return NextResponse.json({ ok: true, ignorado: 'ya_procesado' });
  }
  if (claim?.resultado !== 'claimed' || !claim.token) {
    logger.info('correo_entrante.en_curso', { emailId, tenantId: flota.id });
    return NextResponse.json({ error: 'correo en proceso' }, { status: 503, headers: { 'Retry-After': '15' } });
  }
  const claimToken = claim.token;

  async function finalizar(ok: boolean, error?: string): Promise<boolean> {
    const { data, error: errFinalizar } = await supabaseAdmin().rpc('finalizar_correo', {
      p_email_id: emailId, p_token: claimToken, p_ok: ok, p_error: error ?? null,
    });
    if (errFinalizar || data !== true) {
      logger.error('correo_entrante.finalizar_claim', {
        emailId, ok, err: errFinalizar?.message ?? 'el claim ya no pertenece a esta entrega',
      });
      return false;
    }
    return true;
  }

  // ── LOS ADJUNTOS ─────────────────────────────────────────────────────────
  //
  // Dos clases de fallo, y la línea divisoria es si llegamos a TENER el
  // adjunto en la mano:
  //
  //  · TRANSITORIO (red, timeout, Resend caído, URL que no contesta): el
  //    contenido nunca llegó. Reintentar SÍ lo arregla — el correo no debe
  //    quedar consumido; ver el bloque del 503 abajo del loop.
  //  · PERMANENTE (no es XML, no es CFDI, pasa del tope): el contenido llegó
  //    y no sirve. El reintento trae el mismo archivo — se cuenta como
  //    ignorado y el correo cierra en 200, como siempre.
  let ignoradas = 0;
  // Adjuntos cuya DESCARGA se cayó: ni guardados ni descartados. Si este
  // correo quedara marcado como procesado, estarían perdidos para siempre.
  let caidas = 0;
  // Para la bitácora de corridas (0108): el agente de Proveedores "corrió"
  // desde que empezó a procesar adjuntos.
  const inicioCorrida = new Date();

  // ── EL PRESUPUESTO DE TIEMPO (23-ago-2026) ───────────────────────────────
  //
  // Los dos `fetch` de abajo no tenían timeout. Un Resend que acepta la
  // conexión y calla dejaba la función esperando hasta que la mataba la
  // plataforma — y ahí está el daño: al morir NO corre el `delete` que libera
  // la fila de dedup, así que el correo queda marcado como procesado sin
  // haberlo sido. El reintento de Resend choca con la llave primaria, sale por
  // "ya_procesado", y el CFDI se pierde para siempre. Silenciosamente.
  //
  // El presupuesto es por CORRIDA, no por petición: se reserva un margen para
  // que, pase lo que pase con los adjuntos, quede tiempo de ejecutar la
  // liberación y contestar 503. Un adjunto que no cabe en el tiempo cuenta como
  // CAÍDA (transitorio) — que es exactamente lo que es.
  const RESERVA_PARA_LIBERAR_MS = 3_000;
  const finPresupuesto = Date.now() + (maxDuration * 1000 - RESERVA_PARA_LIBERAR_MS);
  /** Lo que queda, acotado: nunca más de 8 s por descarga ni menos de 0. */
  const restanteMs = () => Math.max(0, Math.min(8_000, finPresupuesto - Date.now()));

  // ── 1. DESCARGAR (bytes, no texto: un PDF o un zip no son UTF-8) ──────────
  // A37-S09-04: tope de adjuntos por correo (el excedente se RECHAZA con rastro, no se pierde en silencio) y
  // descarga con un pool de `CONCURRENCIA_DESCARGA`, no serial: con ~150 adjuntos pequeños la descarga serial
  // agotaba los 57 s, todo el resto contaba como «caída», el 503 de Resend reiniciaba por el primero y los
  // últimos jamás se alcanzaban.
  // A37-S09-03: todo adjunto DESCARTADO (sin id, gigante, correo gigante, excedente) deja una fila `rechazada`
  // en `buzon_recepcion`, visible a la flota; antes solo había un `logger.warn` y el correo se daba por bueno.
  const aProcesar = adjuntos.slice(0, MAX_ADJUNTOS_POR_CORREO);
  const excedentes = adjuntos.slice(MAX_ADJUNTOS_POR_CORREO);
  const descargados: AdjuntoBuzon[] = [];
  let bytesCorreo = 0;

  /** Anota el descarte con rastro visible. Si la base no contesta es un fallo TRANSITORIO: cuenta como caída
   *  (503, Resend reintenta; el upsert por (tenant, email, sha) es idempotente). */
  const descartar = async (nombre: string, motivo: string, bytes: number): Promise<void> => {
    ignoradas++;
    try {
      await registrarAdjuntoDescartado(flota.id as string, emailId, nombre, motivo, bytes);
    } catch (e) {
      caidas++;
      logger.warn('correo_entrante.descarte_sin_rastro', { emailId, err: e instanceof Error ? e.message : String(e) });
    }
  };

  const bajarUno = async (adj: AdjuntoEntrante): Promise<{ nombre: string; bytes: Uint8Array } | null> => {
    const nombre = adj.filename ?? 'sin nombre';
    // Sin id no hay qué pedirle a Resend, y el reintento trae el MISMO payload: permanente.
    if (!adj.id) { await descartar(nombre, 'adjunto sin identificador en el correo: no se pudo descargar', 0); return null; }
    try {
      // La `download_url` viene firmada y CADUCA, así que se pide justo antes
      // de usarla en vez de guardarla.
      // Sin tiempo para intentarlo siquiera, se cuenta como caída: el 503 de
      // abajo devuelve el correo a la cola de Resend con todo por hacer.
      if (restanteMs() === 0) { caidas++; return null; }

      const meta = await httpsPublico({
        url: `https://api.resend.com/emails/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(adj.id)}`,
        metodo: 'GET',
        encabezados: { Authorization: `Bearer ${llave}`, Accept: 'application/json' },
      }, restanteMs());
      if (meta.estado < 200 || meta.estado >= 300) { caidas++; return null; }
      const { download_url: url } = JSON.parse(meta.cuerpo) as { download_url?: string };
      if (!url) { caidas++; return null; }

      if (restanteMs() === 0) { caidas++; return null; }
      // El TOPE, con el doble chequeo de `leerCuerpo` (api/v1/_escritura.ts):
      // primero lo DECLARADO (vía `aceptar`, dentro de `bajarAdjuntoResend`),
      // para ni siquiera materializar un cuerpo gigante; después el largo REAL
      // — `httpsPublico` corta la conexión en vuelo ante una transferencia
      // chunked que no declara nada, así que tampoco ahí se materializa de
      // más. Pasarse es fallo PERMANENTE — el reintento trae el mismo
      // archivo—, se loguea con nombre (saneado: lo escribió el emisor) y
      // tamaño para que sea visible, y los demás adjuntos siguen.
      const tope = topeDe(nombre);
      const descarga = await bajarAdjuntoResend(url, tope, restanteMs());
      if (!descarga.ok) {
        if (descarga.motivo === 'tope') {
          logger.warn('correo_entrante.adjunto_gigante', {
            emailId, archivo: sanitizarTexto(adj.filename),
            // 0 cuando el proveedor no declaró `content-length` (chunked): no se
            // inventa una cifra, se dice que no se conoce el tamaño exacto.
            bytes: descarga.declarado > 0 ? descarga.declarado : null,
          });
          await descartar(nombre, `adjunto demasiado grande (tope ${Math.round(tope / (1024 * 1024))} MB): no se procesó`, descarga.declarado);
        } else {
          caidas++;
        }
        return null;
      }
      const bytes = descarga.bytes;
      // Suma y comprobación SÍNCRONAS tras el `await`: con el pool no hay carrera.
      if (bytesCorreo + bytes.length > MAX_BYTES_CORREO) {
        logger.warn('correo_entrante.correo_gigante', { emailId, archivo: sanitizarTexto(adj.filename), bytes: bytesCorreo + bytes.length });
        await descartar(nombre, 'el correo supera el total de 30 MB de adjuntos: este archivo no se procesó', bytes.length);
        return null;
      }
      bytesCorreo += bytes.length;
      return { nombre, bytes };
    } catch (e) {
      // Aquí solo puede lanzar el JSON mal formado de los metadatos (`bajarAdjuntoResend` ya clasifica sus
      // propios fallos sin lanzar): es la red o un cuerpo ilegible — transitorio. Un adjunto caído NO tumba
      // a los demás: el resto del correo se sigue intentando.
      logger.warn('correo_entrante.adjunto', { emailId, err: e instanceof Error ? e.message : String(e) });
      caidas++;
      return null;
    }
  };

  // Pool: `CONCURRENCIA_DESCARGA` trabajadores toman el siguiente índice; el resultado se guarda POR ÍNDICE
  // para que el orden de proceso siga siendo el del correo.
  const resultados: Array<{ nombre: string; bytes: Uint8Array } | null> = new Array(aProcesar.length).fill(null);
  let siguiente = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA_DESCARGA, aProcesar.length) }, async () => {
    while (siguiente < aProcesar.length) {
      const i = siguiente++;
      resultados[i] = await bajarUno(aProcesar[i]);
    }
  }));
  for (const r of resultados) if (r) descargados.push(r);

  if (excedentes.length > 0) {
    logger.warn('correo_entrante.exceso_adjuntos', { emailId, tenantId: flota.id, total: adjuntos.length, tope: MAX_ADJUNTOS_POR_CORREO });
    ignoradas += excedentes.length;
    try {
      await registrarAdjuntoDescartado(
        flota.id as string, emailId, `(+${excedentes.length} adjuntos omitidos)`,
        `el correo trae ${adjuntos.length} adjuntos y el tope es ${MAX_ADJUNTOS_POR_CORREO}: se omitieron ${excedentes.length}; reenvíelos en otro correo`, 0,
      );
    } catch (e) {
      caidas++;
      logger.warn('correo_entrante.descarte_sin_rastro', { emailId, err: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── 2. PROCESAR: XML, PDF solo, ZIP y parejas (buzon/ingesta.ts) ───────────
  // Los fallos transitorios de la ingesta (base, visión, reloj) suman a `caidas`; lo permanente (zip bomba, XXE,
  // PDF corrupto) queda registrado por archivo en `buzon_recepcion` y NO reintenta.
  const resumen = descargados.length > 0
    ? await atenderAdjuntosBuzon({ tenantId: flota.id as string, emailId, rfcFlota: (flota.rfc as string) ?? null, finPresupuesto }, descargados)
    : { guardadas: 0, duplicadas: 0, revision: 0, rechazadas: 0, ignoradas: 0, caidas: 0, documentos: [] };
  caidas += resumen.caidas;
  ignoradas += resumen.ignoradas;
  const guardadas = resumen.guardadas;

  if (caidas > 0) {
    // Libera el claim que NOS pertenece. A diferencia del DELETE anterior, si
    // una entrega posterior ya tomó el lease no puede borrar su estado.
    await finalizar(false, 'no se pudieron descargar todos los adjuntos');
    logger.warn('correo_entrante.descarga_caida', {
      emailId, tenantId: flota.id, caidas, guardadas, ignoradas, total: adjuntos.length,
    });
    return NextResponse.json({ error: 'no se pudieron descargar todos los adjuntos' }, { status: 503 });
  }

  // ── LA CORRIDA SE ANOTA (0108) ───────────────────────────────────────────
  // Solo la corrida que TERMINÓ: el camino de descargas caídas salió arriba
  // con 503 y Resend lo va a reintentar — anotar cada intento fallido llenaría
  // la ficha con el mismo correo N veces. `registrarCorrida` jamás lanza.
  // tareas = adjuntos procesables; hechas = los que quedaron en la bandeja
  // (un PDF ignorado no es un fallo del agente, y el resumen lo desglosa).
  await registrarCorrida(flota.id as string, 'proveedores', {
    inicio: inicioCorrida,
    fin: new Date(),
    estado: 'ok',
    disparo: 'correo',
    tareasHechas: guardadas,
    tareasTotal: adjuntos.length,
    resumen: {
      accion: 'correo_entrante', guardadas, ignoradas,
      duplicadas: resumen.duplicadas, revision: resumen.revision, rechazadas: resumen.rechazadas,
    },
  });

  // Sellar después de todos los efectos. Si el proceso muere antes, el lease
  // vence y Resend puede reintentar; los únicos fiscales vuelven inocuo el
  // at-least-once. Si falla el sello, tampoco mentimos con un 200.
  if (!await finalizar(true)) {
    return NextResponse.json({ error: 'no se pudo finalizar el correo' }, { status: 503 });
  }

  logger.info('correo_entrante.procesado', {
    emailId, tenantId: flota.id, guardadas, ignoradas, duplicadas: resumen.duplicadas,
    revision: resumen.revision, rechazadas: resumen.rechazadas, total: adjuntos.length,
  });

  return NextResponse.json({
    ok: true, guardadas, ignoradas, duplicadas: resumen.duplicadas, revision: resumen.revision, rechazadas: resumen.rechazadas,
  });
}
