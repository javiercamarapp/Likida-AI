import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { verificarFirma, mensajeDeRechazo } from '@/lib/correo/firma_entrante';
import { tokenDeDestinatarios } from '@/lib/correo/buzon';
import { parseCfdiXml } from '@/lib/likida/intake/cfdi_xml';
import { guardarFacturaProveedor } from '@/lib/likida/proveedores';

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
// ── POR QUÉ SIEMPRE SE CONTESTA 200 DESPUÉS DE LA FIRMA ──────────────────
//
// Un 4xx/5xx hace que Resend reintente. Reintentar tiene sentido cuando el
// fallo es NUESTRO y transitorio; no lo tiene cuando el correo simplemente no
// era para nosotros (buzón desconocido, sin adjuntos, un humano respondiendo
// "gracias"). Devolver error ahí genera una cola de reintentos que nunca va a
// tener éxito y ensucia el log donde vive lo que sí importa. Lo que no se pudo
// procesar se registra y se responde 200.
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
  const llave = process.env.RESEND_API_KEY;
  if (!llave) {
    logger.error('correo_entrante.sin_llave', { emailId });
    return NextResponse.json({ error: 'canal no configurado' }, { status: 503 });
  }

  let guardadas = 0;
  let ignoradas = 0;

  for (const adj of adjuntos) {
    if (!adj.id) { ignoradas++; continue; }
    try {
      // La `download_url` viene firmada y CADUCA, así que se pide justo antes
      // de usarla en vez de guardarla.
      const meta = await fetch(
        `https://api.resend.com/emails/${emailId}/attachments/${adj.id}`,
        { headers: { Authorization: `Bearer ${llave}` } },
      );
      if (!meta.ok) { ignoradas++; continue; }
      const { download_url: url } = (await meta.json()) as { download_url?: string };
      if (!url) { ignoradas++; continue; }

      const bin = await fetch(url);
      if (!bin.ok) { ignoradas++; continue; }
      const texto = await bin.text();

      // Solo el XML se puede leer como CFDI. Un PDF llega, se cuenta y se
      // ignora: extraerle el CFDI es OCR, y eso ya tiene su propio camino.
      const xml = parseCfdiXml(texto);
      if (!xml) { ignoradas++; continue; }

      const r = await guardarFacturaProveedor(flota.id as string, xml, texto, (flota.rfc as string) ?? null);
      if (r.ok) guardadas++; else ignoradas++;
    } catch (e) {
      // Un adjunto que truena NO tumba a los demás: un correo con cinco
      // facturas donde la tercera viene corrupta debe guardar las otras cuatro.
      logger.warn('correo_entrante.adjunto', { emailId, err: e instanceof Error ? e.message : String(e) });
      ignoradas++;
    }
  }

  logger.info('correo_entrante.procesado', {
    emailId, tenantId: flota.id, guardadas, ignoradas, total: adjuntos.length,
  });

  return NextResponse.json({ ok: true, guardadas, ignoradas });
}
