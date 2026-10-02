import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';
import { traerTodo, conteo } from '../pg';
import { leerDescripcionPrimerConcepto, compararReceptor } from '../proveedores';
import type { CfdiXmlData } from '../intake/cfdi_xml';
import type { EstadoSat } from '../intake/sat';
import { aBuffer } from './bytes';
import type { DatosPdfFactura } from './pdf_factura';

// ═══════════════════════════════════════════════════════════════════════════
// EL REPOSITORIO DEL BUZÓN (0530) — recepción por archivo, PDF en el bucket
// privado `buzon-facturas`, emparejado PDF↔CFDI y la bitácora para la pantalla.
//
// Toda consulta ancla por `tenant_id` (el tenant sale del token del DESTINATARIO,
// nunca del remitente). Las que atiende el correo devuelven POR VALOR o lanzan
// según lo que el llamador necesite: un fallo de base es TRANSITORIO y hace que
// el correo se reintente (503), no un archivo descartado.
// ═══════════════════════════════════════════════════════════════════════════

export const BUCKET_BUZON = 'buzon-facturas';

export type EstadoRecepcion = 'procesada' | 'duplicada' | 'revision' | 'descartada' | 'ignorada' | 'rechazada' | 'error';
export type TipoRecepcion = 'xml' | 'pdf' | 'zip' | 'otro';

export interface NuevaRecepcion {
  emailId: string;
  nombre: string;
  zipOrigen?: string | null;
  tipo: TipoRecepcion;
  bytes: number;
  sha256: string;
  estado: EstadoRecepcion;
  motivo?: string | null;
  cfdiUuid?: string | null;
  facturaId?: string | null;
  confianza?: number | null;
  storageRuta?: string | null;
}

export interface Recepcion extends Required<Omit<NuevaRecepcion, 'emailId'>> {
  id: string;
  recibidoEn: string;
  decididoPor: string | null;
  decididoEn: string | null;
}

/** Un nombre de archivo del remitente, saneado para guardarlo y mostrarlo. */
export function nombreVisible(nombre: string): string {
  // eslint-disable-next-line no-control-regex
  return nombre.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160) || 'sin nombre';
}

/** Anota (o ACTUALIZA, si el correo se reintenta) la recepción de un archivo. LANZA si no se puede: sin el
 *  rastro, el correo no puede darse por procesado. */
export async function registrarRecepcion(tenantId: string, r: NuevaRecepcion): Promise<void> {
  const { error } = await acotada(supabaseAdmin()
    .from('buzon_recepcion')
    .upsert({
      tenant_id: tenantId, email_id: r.emailId, nombre: nombreVisible(r.nombre),
      zip_origen: r.zipOrigen ? nombreVisible(r.zipOrigen) : null,
      tipo: r.tipo, bytes: r.bytes, sha256: r.sha256, estado: r.estado,
      motivo: r.motivo ? r.motivo.slice(0, 300) : null,
      cfdi_uuid: r.cfdiUuid ?? null, factura_id: r.facturaId ?? null,
      confianza: r.confianza === null || r.confianza === undefined ? null : Math.round(r.confianza * 100) / 100,
      storage_ruta: r.storageRuta ?? null,
    }, { onConflict: 'tenant_id,email_id,sha256' }), 'buzon.registrar_recepcion');
  if (error) throw new Error(`registrarRecepcion: ${error.message}`);
}

/** ¿Ese MISMO archivo ya se procesó antes (en otro correo)? Evita volver a pagar la visión. */
export async function recepcionPrevia(tenantId: string, sha256: string): Promise<{ estado: EstadoRecepcion; cfdiUuid: string | null; facturaId: string | null } | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('buzon_recepcion')
    .select('estado, cfdi_uuid, factura_id')
    .eq('tenant_id', tenantId)
    .eq('sha256', sha256)
    .in('estado', ['procesada', 'revision'])
    .order('recibido_en', { ascending: false })
    .order('id', { ascending: false })
    .limit(1), 'buzon.recepcion_previa');
  if (error) throw new Error(`recepcionPrevia: ${error.message}`);
  const f = (data ?? [])[0] as { estado: EstadoRecepcion; cfdi_uuid: string | null; factura_id: string | null } | undefined;
  return f ? { estado: f.estado, cfdiUuid: f.cfdi_uuid, facturaId: f.factura_id } : null;
}

// ── Storage del PDF ─────────────────────────────────────────────────────────

export async function subirPdf(tenantId: string, sha256: string, bytes: Uint8Array): Promise<string> {
  const ruta = `${tenantId}/${sha256}.pdf`;
  const res = await acotada(supabaseAdmin().storage.from(BUCKET_BUZON).upload(ruta, aBuffer(bytes), { contentType: 'application/pdf', upsert: true }), 'buzon.subir_pdf');
  if (res.error) throw new Error(`buzon subir: ${res.error.message}`);
  return ruta;
}

export async function descargarPdf(ruta: string): Promise<Uint8Array> {
  const res = await acotada(supabaseAdmin().storage.from(BUCKET_BUZON).download(ruta), 'buzon.descargar_pdf');
  if (res.error || !res.data) throw new Error(`buzon descargar: ${res.error?.message ?? 'sin contenido'}`);
  return new Uint8Array(await res.data.arrayBuffer());
}

export async function firmarPdf(ruta: string, ttlSegundos = 300): Promise<string> {
  const res = await acotada(supabaseAdmin().storage.from(BUCKET_BUZON).createSignedUrl(ruta, ttlSegundos), 'buzon.firmar_pdf');
  if (res.error || !res.data?.signedUrl) throw new Error(`buzon firmar: ${res.error?.message ?? 'sin URL'}`);
  return res.data.signedUrl;
}

export async function borrarPdf(ruta: string): Promise<void> {
  const res = await acotada(supabaseAdmin().storage.from(BUCKET_BUZON).remove([ruta]), 'buzon.borrar_pdf');
  if (res.error) throw new Error(`buzon borrar: ${res.error.message}`);
}

// ── Facturas: emparejar, completar, guardar desde PDF ───────────────────────

export interface FacturaExistente { id: string; estado: 'pendiente' | 'aprobada' | 'rechazada'; tieneXml: boolean; tienePdf: boolean }

export async function facturaPorUuid(tenantId: string, uuid: string): Promise<FacturaExistente | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('factura_proveedor')
    .select('id, estado, xml_crudo, pdf_ruta')
    .eq('tenant_id', tenantId)
    .eq('cfdi_uuid', uuid.toLowerCase())
    .limit(1), 'buzon.factura_por_uuid');
  if (error) throw new Error(`facturaPorUuid: ${error.message}`);
  const f = (data ?? [])[0] as { id: string; estado: FacturaExistente['estado']; xml_crudo: string | null; pdf_ruta: string | null } | undefined;
  return f ? { id: f.id, estado: f.estado, tieneXml: f.xml_crudo !== null, tienePdf: f.pdf_ruta !== null } : null;
}

/** Cuelga el PDF de una factura que aún no lo tiene. `false` = ya tenía uno (no se pisa). */
export async function adjuntarPdfAFactura(
  tenantId: string, facturaId: string, pdf: { ruta: string; sha256: string; nombre: string },
): Promise<boolean> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('factura_proveedor')
    .update({ pdf_ruta: pdf.ruta, pdf_sha256: pdf.sha256, pdf_nombre: nombreVisible(pdf.nombre) })
    .eq('tenant_id', tenantId)
    .eq('id', facturaId)
    .is('pdf_ruta', null)
    .select('id'), 'buzon.adjuntar_pdf');
  if (error) throw new Error(`adjuntarPdfAFactura: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * El XML llegó DESPUÉS del PDF: la factura que se había leído de un PDF se completa con el dato duro y deja de
 * pedir revisión. Solo si sigue PENDIENTE y aún sin XML: una factura ya aprobada no cambia de cifras por detrás.
 */
export async function completarFacturaConXml(
  tenantId: string, uuid: string, xml: CfdiXmlData, xmlCrudo: string, rfcFlota: string | null, estadoSat: EstadoSat | null,
): Promise<boolean> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('factura_proveedor')
    .update({
      xml_crudo: xmlCrudo, fuente_datos: 'xml', requiere_revision: false, revision_motivo: null,
      emisor_rfc: xml.rfcEmisor ?? null, receptor_rfc: xml.rfcReceptor ?? null,
      receptor_es_flota: compararReceptor(xml.rfcReceptor, rfcFlota),
      fecha: xml.fecha ? xml.fecha.slice(0, 10) : null,
      sub_total: typeof xml.subTotal === 'number' ? xml.subTotal : null,
      iva: xml.ivaTraslado || null, total: xml.total,
      descripcion: leerDescripcionPrimerConcepto(xmlCrudo),
      conceptos: Math.max(1, xml.conceptos.length),
      estado_sat: estadoSat,
    })
    .eq('tenant_id', tenantId)
    .eq('cfdi_uuid', uuid.toLowerCase())
    .eq('estado', 'pendiente')
    .is('xml_crudo', null)
    .select('id'), 'buzon.completar_con_xml');
  if (error) throw new Error(`completarFacturaConXml: ${error.message}`);
  return (data ?? []).length > 0;
}

export type ResultadoFacturaPdf = { ok: true; facturaId: string; receptorEsFlota: boolean | null } | { ok: false; motivo: 'duplicada' | 'error' };

/** Guarda la factura leída de un PDF: la cifra es LECTURA (ocr_confianza), nunca dato duro, y el IVA no se
 *  guarda (el desglose exige el XML). Marca revisión cuando la confianza no alcanza. */
export async function guardarFacturaDePdf(
  tenantId: string, d: DatosPdfFactura, rfcFlota: string | null,
  opciones: { requiereRevision: boolean; pdf?: { ruta: string; sha256: string; nombre: string } },
): Promise<ResultadoFacturaPdf> {
  const receptorEsFlota = compararReceptor(d.rfcReceptor, rfcFlota);
  const notas = d.notas.length > 0 ? `: ${d.notas.join('; ')}` : '';
  const { data, error } = await acotada(supabaseAdmin()
    .from('factura_proveedor')
    .insert({
      tenant_id: tenantId, cfdi_uuid: d.uuid.toLowerCase(), emisor_rfc: d.rfcEmisor, emisor_nombre: null,
      receptor_rfc: d.rfcReceptor, receptor_es_flota: receptorEsFlota,
      fecha: d.fecha ? d.fecha.slice(0, 10) : null, sub_total: d.subTotal, iva: null, total: d.total,
      descripcion: null, conceptos: 1, xml_crudo: null, origen: 'correo',
      ocr_confianza: Math.round(d.confianza * 100) / 100,
      fuente_datos: d.fuente,
      requiere_revision: opciones.requiereRevision,
      revision_motivo: opciones.requiereRevision
        ? `lectura de PDF con confianza ${Math.round(d.confianza * 100) / 100} (umbral 0.8)${notas}`.slice(0, 300)
        : null,
      ...(opciones.pdf ? { pdf_ruta: opciones.pdf.ruta, pdf_sha256: opciones.pdf.sha256, pdf_nombre: nombreVisible(opciones.pdf.nombre) } : {}),
    })
    .select('id')
    .single(), 'buzon.guardar_factura_pdf');
  if (error) {
    if (error.code === '23505') return { ok: false, motivo: 'duplicada' };
    logger.error('buzon.guardar_factura_pdf_fallo', { tenantId, err: error.message });
    return { ok: false, motivo: 'error' };
  }
  return { ok: true, facturaId: (data as { id: string }).id, receptorEsFlota };
}

// ── Para la pantalla de estado ──────────────────────────────────────────────

const COLUMNAS_RECEPCION = 'id, nombre, zip_origen, tipo, bytes, sha256, estado, motivo, cfdi_uuid, factura_id, confianza, storage_ruta, recibido_en, decidido_por, decidido_en';

function aRecepcion(f: Record<string, unknown>): Recepcion {
  return {
    id: f.id as string, nombre: f.nombre as string, zipOrigen: (f.zip_origen as string) ?? null,
    tipo: f.tipo as TipoRecepcion, bytes: Number(f.bytes), sha256: f.sha256 as string,
    estado: f.estado as EstadoRecepcion, motivo: (f.motivo as string) ?? null, cfdiUuid: (f.cfdi_uuid as string) ?? null,
    facturaId: (f.factura_id as string) ?? null,
    confianza: f.confianza === null || f.confianza === undefined ? null : Number(f.confianza),
    storageRuta: (f.storage_ruta as string) ?? null, recibidoEn: f.recibido_en as string,
    decididoPor: (f.decidido_por as string) ?? null, decididoEn: (f.decidido_en as string) ?? null,
  };
}

/** Los últimos archivos recibidos (más nuevo primero). LANZA si no puede leer: un tablero ciego no es «nada llegó». */
export async function listarRecepciones(tenantId: string, limite = 50): Promise<Recepcion[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('buzon_recepcion')
    .select(COLUMNAS_RECEPCION)
    .eq('tenant_id', tenantId)
    .order('recibido_en', { ascending: false })
    .order('id', { ascending: false })
    .limit(limite), 'buzon.listar_recepciones');
  if (error) throw new Error(`listarRecepciones: ${error.message}`);
  return (data ?? []).map(aRecepcion);
}

export interface ConteoBuzon {
  porEstado: Record<EstadoRecepcion, number>;
  total: number;
  ultimaRecepcionEn: string | null;
  /** Facturas leídas de PDF/foto que esperan que una persona las cotejen. */
  facturasPorRevisar: number;
}

/** Cuenta TODO lo recibido en los últimos `dias`, paginado y demostrado (no un `.limit()` recortado). */
export async function conteoBuzon(tenantId: string, ahora: Date, dias = 30): Promise<ConteoBuzon> {
  const desde = new Date(ahora.getTime() - dias * 86_400_000).toISOString();
  const filas = await traerTodo<{ estado: EstadoRecepcion; recibido_en: string }>(
    (d, h) => supabaseAdmin()
      .from('buzon_recepcion')
      .select('estado, recibido_en', conteo(d))
      .eq('tenant_id', tenantId)
      .gte('recibido_en', desde)
      .order('recibido_en', { ascending: false })
      .order('id', { ascending: false })
      .range(d, h),
    'buzon.conteo',
  );
  const porEstado: Record<EstadoRecepcion, number> = { procesada: 0, duplicada: 0, revision: 0, descartada: 0, ignorada: 0, rechazada: 0, error: 0 };
  for (const f of filas) porEstado[f.estado] = (porEstado[f.estado] ?? 0) + 1;
  const { count, error } = await acotada(supabaseAdmin()
    .from('factura_proveedor')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('estado', 'pendiente')
    .eq('requiere_revision', true), 'buzon.facturas_por_revisar');
  if (error || typeof count !== 'number') throw new Error(`conteoBuzon: ${error?.message ?? 'sin conteo'}`);
  return { porEstado, total: filas.length, ultimaRecepcionEn: filas[0]?.recibido_en ?? null, facturasPorRevisar: count };
}

/** Una persona descarta un archivo en revisión (no era una factura). Borra el PDF guardado. */
export async function descartarRecepcion(tenantId: string, id: string, por: string): Promise<{ error?: string }> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('buzon_recepcion')
    .update({ estado: 'descartada', decidido_por: por, decidido_en: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .eq('estado', 'revision')
    .is('factura_id', null)
    .select('id, storage_ruta'), 'buzon.descartar');
  if (error) {
    logger.error('buzon.descartar_fallo', { tenantId, id, err: error.message });
    return { error: 'No se pudo descartar el archivo. Inténtalo de nuevo.' };
  }
  const fila = (data ?? [])[0] as { storage_ruta: string | null } | undefined;
  if (!fila) return { error: 'Ese archivo ya no está esperando revisión.' };
  if (fila.storage_ruta) {
    // Best-effort: un PDF que se descartó y no se pudo borrar ahora lo barre la retención.
    await borrarPdf(fila.storage_ruta).catch((e) => logger.warn('buzon.pdf_descartado_no_borrado', { tenantId, err: e instanceof Error ? e.message : String(e) }));
  }
  return {};
}

/** La URL firmada (5 min) del PDF de una recepción, anclada por tenant. */
export async function urlPdfDeRecepcion(tenantId: string, id: string): Promise<string | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('buzon_recepcion')
    .select('storage_ruta')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle(), 'buzon.url_pdf');
  if (error) throw new Error(`urlPdfDeRecepcion: ${error.message}`);
  const ruta = (data as { storage_ruta: string | null } | null)?.storage_ruta;
  return ruta ? firmarPdf(ruta) : null;
}
