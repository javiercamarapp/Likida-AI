import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { verificarFirma, mensajeDeRechazo } from '@/lib/correo/firma_entrante';
import { tokenDeDestinatarios } from '@/lib/correo/buzon';
import { parseCfdiXml } from '@/lib/likida/intake/cfdi_xml';
import { guardarFacturaProveedor, estadoSatDeCfdi } from '@/lib/likida/proveedores';
import { estaApagado } from '@/lib/likida/interruptores';
import { registrarCorrida } from '@/lib/likida/agentes/corridas';
import { sanitizarTexto } from '@/lib/likida/intake/sanitizar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/correo/entrante — el buzón de facturas de proveedor.
//
// Las facturas de talleres, refaccionarias y diésel llegan POR CORREO, no por
// WhatsApp. Es la pieza que multiplica a los agentes de Peajes y Proveedores, y
// la que Transportes Innovativos pidió con todas sus letras.
//
// ── EL ORDEN DE LAS COMPROBACIONES NO ES ARBITRARIO ──────────────────────
//
//  1. FIRMA primero, antes de leer una sola cosa del cuerpo. Este endpoint es
//     un POST sin autenticar y lo que dispara no es inocuo: mete una factura
//     con su RFC, su monto y su UUID a la contabilidad de un cliente. Sin
//     firma, Likida sería un buzón por el que cualquiera empuja gasto falso.
//  2. TENANT después, y desde el DESTINATARIO —el buzón al que escribieron—,
//     nunca desde el remitente. El `from` de un correo se falsifica en dos
//     líneas; el token del destinatario no se adivina.
//  3. IDEMPOTENCIA al final: Resend reintenta ante cualquier respuesta que no
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
    attachments?: AdjuntoEntrante[];
  };
}

/** Los tipos que sabemos leer. Un CFDI es XML; el PDF entra porque muchos
 *  proveedores mandan los dos y el XML a veces viene dentro de un zip que
 *  todavía no abrimos. Cualquier otra cosa se ignora sin ruido. */
const PROCESABLES = /\.(xml|pdf)$/i;

/** El adjunto más grande que se descarga. El mismo tope que el panel le pone
 *  al XML por pantalla (`MAX_XML_BYTES`, dashboard/agentes/peajes/page.tsx):
 *  un CFDI pesa decenas de KB — 4 MB ya es un archivo equivocado, no una
 *  factura grande. Sin esto, un correo hostil con un adjunto gigante se
 *  materializaría entero en memoria. */
const MAX_ADJUNTO_BYTES = 4 * 1024 * 1024;


// El tope de la función, DECLARADO: de él sale el presupuesto de las descargas
// (ver `finPresupuesto` abajo). Sin un número explícito aquí, el presupuesto se
// calcularía contra un default de la plataforma que puede cambiar sin avisar.
export const maxDuration = 60;

export async function POST(req: Request) {
  // El cuerpo CRUDO: `JSON.parse` + `stringify` reordena llaves y la firma
  // dejaría de cuadrar. Ver `firma_entrante.ts`.
  const crudo = await req.text();

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
  const token = tokenDeDestinatarios([...(d.to ?? []), ...(d.cc ?? [])]);
  if (!token) {
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

  // ── IDEMPOTENCIA, ANTES DE PROCESAR NADA ─────────────────────────────────
  //
  // El insert ES la comprobación: si el `email_id` ya está, la llave primaria
  // lo rechaza y sabemos que este correo ya se procesó. Preguntar primero y
  // escribir después dejaría una ventana entre las dos operaciones por la que
  // se cuelan dos entregas simultáneas — el mismo patrón que `conv.ts` usa
  // para WhatsApp desde la mig. 0002.
  const { error: errDedup } = await supabaseAdmin()
    .from('correo_procesado').insert({ email_id: emailId });

  if (errDedup) {
    // 23505 = unique_violation: ya lo procesamos. Es un reintento de Resend, no
    // un error — se contesta 200 para que deje de reintentar.
    if (errDedup.code === '23505') {
      logger.info('correo_entrante.repetido', { emailId, tenantId: flota.id });
      return NextResponse.json({ ok: true, ignorado: 'ya_procesado' });
    }
    // Cualquier otro fallo SÍ es nuestro y transitorio: que reintente, porque
    // procesar sin poder marcar es lo que duplica facturas.
    logger.error('correo_entrante.dedup', { emailId, err: errDedup.message });
    return NextResponse.json({ error: 'no se pudo registrar el correo' }, { status: 503 });
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
  let guardadas = 0;
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

  for (const adj of adjuntos) {
    // Sin id no hay qué pedirle a Resend, y el reintento trae el MISMO
    // payload: permanente.
    if (!adj.id) { ignoradas++; continue; }
    try {
      // La `download_url` viene firmada y CADUCA, así que se pide justo antes
      // de usarla en vez de guardarla.
      // Sin tiempo para intentarlo siquiera, se cuenta como caída: el 503 de
      // abajo devuelve el correo a la cola de Resend con todo por hacer.
      if (restanteMs() === 0) { caidas++; continue; }

      const meta = await fetch(
        `https://api.resend.com/emails/${emailId}/attachments/${adj.id}`,
        { headers: { Authorization: `Bearer ${llave}` }, signal: AbortSignal.timeout(restanteMs()) },
      );
      if (!meta.ok) { caidas++; continue; }
      const { download_url: url } = (await meta.json()) as { download_url?: string };
      if (!url) { caidas++; continue; }

      if (restanteMs() === 0) { caidas++; continue; }
      const bin = await fetch(url, { signal: AbortSignal.timeout(restanteMs()) });
      if (!bin.ok) { caidas++; continue; }

      // El TOPE, con el doble chequeo de `leerCuerpo` (api/v1/_escritura.ts):
      // primero lo DECLARADO, para ni siquiera materializar un cuerpo gigante;
      // después el largo REAL, porque una transferencia chunked no declara
      // nada. Pasarse es fallo PERMANENTE — el reintento trae el mismo
      // archivo—, se loguea con nombre (saneado: lo escribió el emisor) y
      // tamaño para que sea visible, y los demás adjuntos siguen.
      const declarado = Number(bin.headers.get('content-length') || 0);
      if (declarado > MAX_ADJUNTO_BYTES) {
        logger.warn('correo_entrante.adjunto_gigante', {
          emailId, archivo: sanitizarTexto(adj.filename), bytes: declarado,
        });
        ignoradas++; continue;
      }
      const texto = await bin.text();
      if (texto.length > MAX_ADJUNTO_BYTES) {
        logger.warn('correo_entrante.adjunto_gigante', {
          emailId, archivo: sanitizarTexto(adj.filename), bytes: texto.length,
        });
        ignoradas++; continue;
      }

      // Solo el XML se puede leer como CFDI. Un PDF llega, se cuenta y se
      // ignora: extraerle el CFDI es OCR, y eso ya tiene su propio camino.
      const xml = parseCfdiXml(texto);
      if (!xml) { ignoradas++; continue; }

      // El estatus SAT se consulta AQUÍ, con el adjunto ya en la mano:
      // `consultarCFDI` jamás lanza (timeout 4s → 'pendiente'), así que un
      // SAT caído no convierte este adjunto en `caida` ni frena el correo.
      const estadoSat = await estadoSatDeCfdi(xml);
      const r = await guardarFacturaProveedor(flota.id as string, xml, texto, (flota.rfc as string) ?? null, 'correo', estadoSat);
      if (r.ok) guardadas++; else ignoradas++;
    } catch (e) {
      // Aquí solo pueden lanzar los fetch y sus lecturas (`parseCfdiXml`
      // atrapa adentro y devuelve null; `guardarFacturaProveedor` reporta por
      // valor): es la red — transitorio. Un adjunto caído NO tumba a los
      // demás: el resto del correo se sigue intentando.
      logger.warn('correo_entrante.adjunto', { emailId, err: e instanceof Error ? e.message : String(e) });
      caidas++;
    }
  }

  if (caidas > 0) {
    // ── EL CORREO NO QUEDA CONSUMIDO ─────────────────────────────────────
    // Registrar-antes-de-procesar sigue siendo la regla (ver arriba); pero con
    // una descarga caída, dejar la fila perdería el CFDI PARA SIEMPRE: Resend
    // no reintenta un 200, y el reintento de un 503 chocaría con la llave
    // primaria y saldría "ya_procesado" sin haber guardado nada. Se libera la
    // fila y se contesta 503 para que Resend reintente.
    //
    // Y si ALGUNOS adjuntos ya se guardaron, el 503 sigue siendo seguro:
    // `factura_proveedor` tiene unique(tenant_id, cfdi_uuid) (mig. 0091) y
    // `guardarFacturaProveedor` convierte ese choque en `duplicada` — el
    // reintento recupera los caídos y los ya guardados rebotan sin segunda
    // fila.
    //
    // CARRERA ACEPTADA: entre este DELETE y el reintento puede colarse otra
    // entrega concurrente del mismo correo; su insert vuelve a tomar la llave
    // primaria y la que llegue después sale por "ya_procesado". Inofensivo:
    // alguien procesa, nadie duplica.
    const { error: errLiberar } = await supabaseAdmin()
      .from('correo_procesado').delete().eq('email_id', emailId);
    if (errLiberar) {
      // Best-effort: sin liberar, el reintento va a salir "ya_procesado" y
      // estos adjuntos SÍ se pierden — por eso es error y no warn.
      logger.error('correo_entrante.liberar_dedup', { emailId, err: errLiberar.message });
    }
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
    resumen: { accion: 'correo_entrante', guardadas, ignoradas },
  });

  logger.info('correo_entrante.procesado', {
    emailId, tenantId: flota.id, guardadas, ignoradas, total: adjuntos.length,
  });

  return NextResponse.json({ ok: true, guardadas, ignoradas });
}
