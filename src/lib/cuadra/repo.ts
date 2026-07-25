// Acceso a datos de Cuadra (service-role, scoping por tenant a mano).
// Mapea filas de Postgres ↔ tipos del dominio.

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import type { Gasto, Liquidacion, Viaje, Operador } from '@/types/cuadra';
import type { PoliticaGasto } from './cuadre/engine';

/**
 * Conserva el XML CRUDO del CFDI (CFF art. 30). Best-effort: un fallo aquí NO
 * tumba la liquidación (el gasto ya está capturado). 1.8.
 */
export async function saveCfdiXmlRaw(tenantId: string, cfdiUuid: string, gastoId: string | null, xml: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('cfdi_xml')
    .upsert({ tenant_id: tenantId, cfdi_uuid: cfdiUuid, gasto_id: gastoId, xml }, { onConflict: 'tenant_id,cfdi_uuid' });
  if (error) logger.warn('cfdi_xml.save', { err: error.message });
}

export async function getPolitica(tenantId: string): Promise<PoliticaGasto[]> {
  const { data, error } = await supabaseAdmin()
    .from('politica_gasto')
    .select('concepto, ruta, tope_monto, requiere_cfdi')
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`politica: ${error.message}`);
  return (data ?? []).map((r) => ({
    concepto: r.concepto as string,
    ruta: (r.ruta as string) || undefined,
    topeMonto: r.tope_monto != null ? Number(r.tope_monto) : undefined,
    requiereCfdi: Boolean(r.requiere_cfdi),
  }));
}

export async function getViaje(viajeId: string, tenantId: string): Promise<Viaje | null> {
  const { data, error } = await supabaseAdmin()
    .from('viaje')
    .select('id, folio, origen, destino, anticipo, fecha_inicio, fecha_fin')
    .eq('id', viajeId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(`viaje: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id as string,
    folio: (data.folio as string) || undefined,
    origen: (data.origen as string) || undefined,
    destino: (data.destino as string) || undefined,
    anticipo: Number(data.anticipo ?? 0),
    fechaInicio: (data.fecha_inicio as string) || undefined,
    fechaFin: (data.fecha_fin as string) || undefined,
  };
}

export async function getOperador(operadorId: string, tenantId: string): Promise<Operador | null> {
  const { data, error } = await supabaseAdmin()
    .from('operador')
    .select('id, nombre, telefono, terminal:terminal_id(nombre)')
    .eq('id', operadorId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(`operador: ${error.message}`);
  if (!data) return null;
  const terminal = data.terminal as { nombre?: string } | null;
  return {
    id: data.id as string,
    nombre: data.nombre as string,
    telefono: data.telefono as string,
    terminal: terminal?.nombre,
  };
}

export async function addGasto(tenantId: string, viajeId: string, g: Gasto): Promise<void> {
  const { error } = await supabaseAdmin().from('gasto').insert({
    id: g.id,
    tenant_id: tenantId,
    viaje_id: viajeId,
    concepto: g.concepto,
    monto: g.monto,
    fecha: g.fecha ?? null,
    folio: g.folio ?? null,
    rfc_emisor: g.rfcEmisor ?? null,
    rfc_receptor: g.rfcReceptor ?? null,
    cfdi_uuid: g.cfdiUuid ?? null,
    imagen_url: g.imagenUrl ?? null,
    ocr_confianza: g.ocrConfianza ?? null,
    cfdi_valido: g.cfdiValido ?? null,
    estado_sat: g.estadoSat ?? null,
    efos: g.efos ?? null,
    efos_revisar: g.efosRevisar ?? null,
    clave_prod_serv: g.claveProdServ ?? null,
    clave_unidad: g.claveUnidad ?? null,
    tipo_comprobante: g.tipoComprobante ?? null,
    complemento_hidrocarburos: g.complementoHidrocarburos ?? null,
    cfdi_esquema_alterno: g.cfdiEsquemaAlterno ?? null,
    xml_verificado: g.xmlVerificado ?? null,
    forma_pago: g.formaPago ?? null,
    sub_total: g.subTotal ?? null,
    ieps_traslado: g.iepsTraslado ?? null,
    iva_traslado: g.ivaTraslado ?? null,
    folio_norm: g.folioNorm ?? null,
    ocr_extra: g.ocrExtra ?? null,
  });
  if (error) throw new Error(`addGasto: ${error.message}`);
}

/** NIVEL 2: actualiza un gasto con los datos del XML del CFDI (por id). */
export async function updateGastoCfdiXml(
  tenantId: string,
  gastoId: string,
  x: { claveProdServ?: string; claveUnidad?: string; tipoComprobante?: string; complementoHidrocarburos?: boolean; esquemaAlterno?: boolean; formaPago?: string; subTotal?: number; iepsTraslado?: number; ivaTraslado?: number },
): Promise<void> {
  const { error } = await supabaseAdmin().from('gasto').update({
    clave_prod_serv: x.claveProdServ ?? null,
    clave_unidad: x.claveUnidad ?? null,
    tipo_comprobante: x.tipoComprobante ?? null,
    complemento_hidrocarburos: x.complementoHidrocarburos ?? null,
    cfdi_esquema_alterno: x.esquemaAlterno ?? null,
    forma_pago: x.formaPago ?? null,
    sub_total: x.subTotal ?? null,
    ieps_traslado: x.iepsTraslado ?? null,
    iva_traslado: x.ivaTraslado ?? null,
    xml_verificado: true,
  }).eq('id', gastoId).eq('tenant_id', tenantId);
  if (error) throw new Error(`updateGastoCfdiXml: ${error.message}`);
}

export async function getGastos(viajeId: string, tenantId: string): Promise<Gasto[]> {
  const { data, error } = await supabaseAdmin()
    .from('gasto')
    .select('id, concepto, monto, fecha, folio, folio_norm, ocr_extra, rfc_emisor, rfc_receptor, cfdi_uuid, imagen_url, ocr_confianza, cfdi_valido, estado_sat, efos, efos_revisar, clave_prod_serv, clave_unidad, tipo_comprobante, complemento_hidrocarburos, cfdi_esquema_alterno, xml_verificado, forma_pago, sub_total, ieps_traslado, iva_traslado')
    .eq('tenant_id', tenantId)
    .eq('viaje_id', viajeId);
  if (error) throw new Error(`getGastos: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    concepto: r.concepto as Gasto['concepto'],
    monto: Number(r.monto),
    fecha: (r.fecha as string) || undefined,
    folio: (r.folio as string) || undefined,
    folioNorm: (r.folio_norm as string) || undefined,
    ocrExtra: (r.ocr_extra as Record<string, unknown>) || undefined,
    rfcEmisor: (r.rfc_emisor as string) || undefined,
    rfcReceptor: (r.rfc_receptor as string) || undefined,
    cfdiUuid: (r.cfdi_uuid as string) || undefined,
    imagenUrl: (r.imagen_url as string) || undefined,
    ocrConfianza: r.ocr_confianza != null ? Number(r.ocr_confianza) : undefined,
    cfdiValido: r.cfdi_valido != null ? Boolean(r.cfdi_valido) : undefined,
    estadoSat: (r.estado_sat as Gasto['estadoSat']) || undefined,
    efos: r.efos != null ? Boolean(r.efos) : undefined,
    efosRevisar: r.efos_revisar != null ? Boolean(r.efos_revisar) : undefined,
    claveProdServ: (r.clave_prod_serv as string) || undefined,
    claveUnidad: (r.clave_unidad as string) || undefined,
    tipoComprobante: (r.tipo_comprobante as string) || undefined,
    complementoHidrocarburos: r.complemento_hidrocarburos != null ? Boolean(r.complemento_hidrocarburos) : undefined,
    cfdiEsquemaAlterno: r.cfdi_esquema_alterno != null ? Boolean(r.cfdi_esquema_alterno) : undefined,
    xmlVerificado: r.xml_verificado != null ? Boolean(r.xml_verificado) : undefined,
    formaPago: (r.forma_pago as string) || undefined,
    subTotal: r.sub_total != null ? Number(r.sub_total) : undefined,
    iepsTraslado: r.ieps_traslado != null ? Number(r.ieps_traslado) : undefined,
    ivaTraslado: r.iva_traslado != null ? Number(r.iva_traslado) : undefined,
  }));
}

export async function saveLiquidacion(
  tenantId: string,
  liq: Omit<Liquidacion, 'id' | 'creadaEn'>,
  pdfUrl?: string,
): Promise<string> {
  const admin = supabaseAdmin();
  // CR-1: cierre idempotente. Con unique(viaje_id) + upsert, dos cierres
  // concurrentes producen UN solo registro (el motor es determinístico → el
  // segundo escribe los mismos números). Nunca dos liquidaciones/dos PDFs.
  const { data, error } = await admin
    .from('liquidacion')
    .upsert(
      {
        tenant_id: tenantId,
        viaje_id: liq.viajeId,
        total_comprobado: liq.totalComprobado,
        total_anticipo: liq.totalAnticipo,
        diferencia: liq.diferencia,
        estatus: liq.estatus,
        diferencias: liq.diferencias,
        ieps_acreditable: liq.iepsAcreditable,
        iva_acreditable: liq.ivaAcreditable,
        peaje_acreditable: liq.peajeAcreditable,
        pdf_url: pdfUrl ?? null,
      },
      { onConflict: 'viaje_id' },
    )
    .select('id')
    .single();
  if (error) throw new Error(`saveLiquidacion: ${error.message}`);
  await admin.from('viaje').update({ estatus: 'liquidado' }).eq('id', liq.viajeId).eq('tenant_id', tenantId);
  return data.id as string;
}
