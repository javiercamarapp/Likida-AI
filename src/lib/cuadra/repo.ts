// Acceso a datos de Cuadra (service-role, scoping por tenant a mano).
// Mapea filas de Postgres ↔ tipos del dominio.

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import type { Gasto, Liquidacion, Viaje, Operador } from '@/types/cuadra';
import type { PoliticaGasto } from './cuadre/engine';
import type { CodigoPendiente } from './intake/emparejar';

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
    img_hash: g.imgHash ?? null,
  });
  if (error) {
    // Se preserva el código de Postgres para que el caller distinga un duplicado
    // (23505, dedup de foto por índice único) de un error real. Ver processor.
    const e = new Error(`addGasto: ${error.message}`) as Error & { code?: string };
    e.code = error.code;
    throw e;
  }
}

/** FASE 2: ¿ya existe un gasto para este viaje con el mismo hash de imagen?
 *  Best-effort para dedup de fotos reenviadas; ante error de lectura devuelve
 *  false (no bloquea el intake — preferimos un raro duplicado a perder un gasto). */
export async function gastoExistePorHash(viajeId: string, imgHash: string, tenantId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from('gasto')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('viaje_id', viajeId)
    .eq('img_hash', imgHash)
    .limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

/** NIVEL 2: actualiza un gasto con los datos del XML del CFDI (por id). */
export async function updateGastoCfdiXml(
  tenantId: string,
  gastoId: string,
  x: { claveProdServ?: string; claveUnidad?: string; tipoComprobante?: string; complementoHidrocarburos?: boolean; esquemaAlterno?: boolean; formaPago?: string; subTotal?: number; iepsTraslado?: number; ivaTraslado?: number;
       // Cuando el XML se pega a un TICKET (que no traía UUID), estos tres campos
       // pasan a ser autoritativos: vienen del comprobante timbrado, no del OCR.
       uuid?: string; rfcEmisor?: string; rfcReceptor?: string; total?: number; fecha?: string },
): Promise<void> {
  const extra: Record<string, unknown> = {};
  if (x.uuid) extra.cfdi_uuid = x.uuid;
  if (x.rfcEmisor) extra.rfc_emisor = x.rfcEmisor;
  if (x.rfcReceptor) extra.rfc_receptor = x.rfcReceptor;
  // El monto del CFDI gana sobre el que leyó la visión: no pasó por OCR.
  if (x.total != null && x.total > 0) extra.monto = x.total;
  if (x.fecha) extra.fecha = x.fecha;
  const { error } = await supabaseAdmin().from('gasto').update({
    ...extra,
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

/**
 * Le pega a un gasto ya registrado los identificadores que trajo el
 * ACERCAMIENTO (segunda foto, solo del código): folio del portal, código de
 * barras, liga de facturación y UUID.
 *
 * NO toca el monto: el emparejamiento se hizo justamente por total, así que ya
 * coinciden. Tocar dinero aquí solo abriría la puerta a moverlo por error.
 */
/**
 * Le pega a un gasto lo que salió del código: folio de portal, código de barras,
 * liga de facturación y —si no tenía— el UUID.
 *
 * Devuelve `true` si de verdad lo enriqueció, `false` si alguien llegó antes.
 * Que devuelva false NO es un error: es la respuesta a "ese gasto ya tiene su
 * acercamiento".
 *
 * El merge y el claim viven en SQL (mig. 0017), no aquí. Haciéndolo desde la
 * app era read-modify-write: las fotos de una ráfaga de WhatsApp corren en
 * paralelo, así que se mezclaba contra el `ocr_extra` que se había leído, no
 * contra el que está en la tabla, y la última escritura borraba lo que otra foto
 * hubiera añadido en medio (montoDiscrepante, textoSospechoso, rfcEmisorDudoso).
 * Y sin claim, el segundo acercamiento del mismo total pisaba el folio del
 * primero — el folio que la oficina teclea en el portal para timbrar.
 *
 * NO se toca `folio`: el impreso en el ticket y el que viaja dentro del QR son
 * cadenas DISTINTAS (comprobado contra el papel — 31 chars contra 30), no dos
 * lecturas del mismo dato. El impreso es el que una persona teclea; el del QR es
 * la llave del deep-link del portal y vive en `ocrExtra.folioPortal`.
 */
export async function enriquecerGastoConCodigo(
  tenantId: string,
  gasto: Gasto,
  datos: { folioPortal?: string; codigoBarras?: string; urlFacturacion?: string; cfdiUuid?: string },
): Promise<boolean> {
  // Solo lo que trae el código. El resto de ocr_extra lo conserva el `||` de SQL.
  const extra: Record<string, unknown> = {};
  if (datos.folioPortal) extra.folioPortal = datos.folioPortal;
  if (datos.codigoBarras) extra.codigoBarras = datos.codigoBarras;
  if (datos.urlFacturacion) extra.urlFacturacion = datos.urlFacturacion;

  const { data, error } = await supabaseAdmin().rpc('enriquecer_gasto_codigo', {
    p_gasto: gasto.id,
    p_tenant: tenantId,
    p_extra: extra,
    p_cfdi_uuid: datos.cfdiUuid ?? null,
  });
  if (error) throw new Error(`enriquecerGastoConCodigo: ${error.message}`);
  return data === true;
}

// ── Bandeja de códigos pendientes (mig. 0016) ────────────────────────────────
// El acercamiento que llegó antes que su ticket. Espera aquí hasta que entre un
// comprobante de su mismo total.

/** Guarda un código que todavía no tiene comprobante al cual pegarse. */
export async function guardarCodigoPendiente(
  tenantId: string,
  viajeId: string,
  c: Omit<CodigoPendiente, 'id'>,
): Promise<void> {
  const { error } = await supabaseAdmin().from('codigo_pendiente').insert({
    tenant_id: tenantId,
    viaje_id: viajeId,
    monto: c.monto,
    folio_portal: c.folioPortal ?? null,
    codigo_barras: c.codigoBarras ?? null,
    url_facturacion: c.urlFacturacion ?? null,
    cfdi_uuid: c.cfdiUuid ?? null,
  });
  if (error) throw new Error(`guardarCodigoPendiente: ${error.message}`);
}

export async function getCodigosPendientes(viajeId: string, tenantId: string): Promise<CodigoPendiente[]> {
  const { data, error } = await supabaseAdmin()
    .from('codigo_pendiente')
    .select('id, monto, folio_portal, codigo_barras, url_facturacion, cfdi_uuid')
    .eq('tenant_id', tenantId)
    .eq('viaje_id', viajeId);
  if (error) throw new Error(`getCodigosPendientes: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    monto: Number(r.monto),
    folioPortal: (r.folio_portal as string) || undefined,
    codigoBarras: (r.codigo_barras as string) || undefined,
    urlFacturacion: (r.url_facturacion as string) || undefined,
    cfdiUuid: (r.cfdi_uuid as string) || undefined,
  }));
}

/**
 * Toma un código de la bandeja para usarlo, y devuelve si lo consiguió.
 *
 * Es un CLAIM, no un borrado: las fotos de una ráfaga corren en paralelo y no
 * toman el mutex del viaje, así que dos comprobantes del mismo total pueden ir
 * por el mismo código a la vez. El borrado con `.select()` es atómico — solo uno
 * recibe la fila — y el otro se entera de que llegó tarde en vez de pegar el
 * mismo folio dos veces.
 */
export async function reclamarCodigoPendiente(tenantId: string, id: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from('codigo_pendiente')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('id');
  if (error) throw new Error(`reclamarCodigoPendiente: ${error.message}`);
  return (data?.length ?? 0) > 0;
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
  // CR-1 / AUDIT_V3 money-path CRÍTICO: cierre ATÓMICO e idempotente. Antes eran
  // dos statements (upsert liquidacion + update viaje) y el error del segundo se
  // IGNORABA → liquidacion sin cerrar el viaje. Ahora una sola función plpgsql
  // (guardar_liquidacion_tx, migración 0013) hace ambos en UNA transacción: si el
  // update de viaje falla, la liquidacion hace rollback. Con unique(viaje_id) dos
  // cierres concurrentes producen UN registro (el motor es determinístico).
  const { data, error } = await admin.rpc('guardar_liquidacion_tx', {
    p_tenant: tenantId,
    p_viaje: liq.viajeId,
    p_total_comprobado: liq.totalComprobado,
    p_total_anticipo: liq.totalAnticipo,
    p_diferencia: liq.diferencia,
    p_estatus: liq.estatus,
    p_diferencias: liq.diferencias,
    p_ieps: liq.iepsAcreditable,
    p_iva: liq.ivaAcreditable,
    p_peaje: liq.peajeAcreditable,
    p_pdf_url: pdfUrl ?? null,
  });
  if (error) throw new Error(`saveLiquidacion: ${error.message}`);
  return data as string;
}

// ── Aviso de privacidad (mig. 0018) ──────────────────────────────────────────
// El obligado es el RESPONSABLE, o sea la FLOTA (LFPDPPP art. 14). Likida es
// persona encargada y solo pone el mecanismo: sin él, la flota no puede cumplir
// aunque quiera. Detalle verificado en normas/lfpdppp-15-16.yaml.

/**
 * Datos de responsable de la flota, para armar el aviso. `null` en cualquiera
 * significa que el tenant no está configurado — y ahí NO se envía nada, porque
 * un aviso sin responsable no dice a quién reclamarle, que es para lo que sirve.
 */
export async function getDatosResponsable(
  tenantId: string,
): Promise<{ razonSocial: string; domicilio: string; urlAvisoIntegral: string } | null> {
  const { data, error } = await supabaseAdmin()
    .from('tenant')
    .select('razon_social, domicilio_fiscal, url_aviso_privacidad')
    .eq('id', tenantId)
    .maybeSingle();
  if (error) throw new Error(`getDatosResponsable: ${error.message}`);
  if (!data) return null;
  const r = {
    razonSocial: (data.razon_social as string) ?? '',
    domicilio: (data.domicilio_fiscal as string) ?? '',
    urlAvisoIntegral: (data.url_aviso_privacidad as string) ?? '',
  };
  return r.razonSocial && r.domicilio && r.urlAvisoIntegral ? r : null;
}

/**
 * Deja constancia de que se puso el aviso a disposición. Devuelve `true` si ESTE
 * llamado fue el que la puso — o sea, si toca enviarlo.
 *
 * El claim vive en SQL (igual que en la 0017): el primer mensaje puede llegar
 * por dos caminos a la vez y sin claim el operador recibiría el aviso dos o tres
 * veces seguidas.
 *
 * Se reenvía cuando la versión cambia: el art. 15 fr. VI obliga a comunicar los
 * cambios al aviso.
 */
export async function reclamarEnvioAviso(
  tenantId: string,
  operadorId: string,
  version: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin().rpc('marcar_aviso_privacidad', {
    p_operador: operadorId,
    p_tenant: tenantId,
    p_version: version,
  });
  if (error) throw new Error(`reclamarEnvioAviso: ${error.message}`);
  return data === true;
}

// ── Acumulados del ejercicio (Fase 1: la capa de periodo) ────────────────────

/**
 * Pagos de combustible del ejercicio, separando efectivo del total.
 *
 * Es el denominador del 15% de la RFA 2026 regla 2.9, y por eso cuenta SOLO
 * combustible: la base es combustible contra combustible, no contra el gasto
 * total de la flota. Ese denominador equivocado haría parecer holgada a una
 * flota que ya se pasó.
 *
 * Se calcula desde `gasto` sin tabla nueva: `forma_pago` y `concepto` ya
 * existen. Los duplicados y los montos no positivos quedan fuera por el mismo
 * criterio que usa el motor — si no cuentan para el cuadre, tampoco para el
 * contador.
 *
 * `formaPago` '01' es efectivo en el catálogo del SAT. Un gasto SIN forma de
 * pago no se cuenta como efectivo: no se sabe, y suponerlo inflaría el
 * numerador contra la flota.
 */
export async function getAcumuladoCombustible(
  tenantId: string,
  ejercicio: number,
): Promise<{ efectivo: number; totalCombustible: number }> {
  const { data, error } = await supabaseAdmin()
    .from('gasto')
    .select('monto, forma_pago')
    .eq('tenant_id', tenantId)
    .eq('concepto', 'diesel')
    .gte('fecha', `${ejercicio}-01-01`)
    .lte('fecha', `${ejercicio}-12-31`);
  if (error) throw new Error(`getAcumuladoCombustible: ${error.message}`);

  let efectivo = 0;
  let totalCombustible = 0;
  for (const g of data ?? []) {
    const monto = Number(g.monto);
    if (!Number.isFinite(monto) || monto <= 0) continue;
    totalCombustible += monto;
    if (g.forma_pago === '01') efectivo += monto;
  }
  return { efectivo: Math.round(efectivo * 100) / 100, totalCombustible: Math.round(totalCombustible * 100) / 100 };
}
