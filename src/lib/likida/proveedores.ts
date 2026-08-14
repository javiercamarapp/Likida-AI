import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import type { CfdiXmlData } from './intake/cfdi_xml';

// ═══════════════════════════════════════════════════════════════════════════
// FACTURAS DE PROVEEDOR (0091, F6 del plan) — el ciclo que Transportes
// Innovativos captura a mano en su ERP: llega el XML del taller o la
// refaccionaria, un humano lo aprueba o rechaza, y lo aprobado sale en un
// layout importable. SIN OCR a propósito: la factura de proveedor en México
// SIEMPRE tiene XML, y el XML es dato duro — meterle visión sería pagar por
// adivinar lo que el archivo ya dice.
// ═══════════════════════════════════════════════════════════════════════════

export interface FacturaProveedor {
  id: string;
  cfdiUuid: string;
  emisorRfc: string | null;
  emisorNombre: string | null;
  receptorRfc: string | null;
  /** ¿El receptor era el RFC de la flota AL INGERIR? null = la flota no
   *  tenía RFC capturado ese día y no se pudo validar — se dice, no se asume. */
  receptorEsFlota: boolean | null;
  fecha: string | null;
  subTotal: number | null;
  iva: number | null;
  total: number;
  descripcion: string | null;
  conceptos: number;
  estado: 'pendiente' | 'aprobada' | 'rechazada';
  decididoPor: string | null;
  decididoEn: string | null;
  creadoEn: string;
}

export type ResultadoIngesta =
  | { ok: true; facturaId: string; receptorEsFlota: boolean | null }
  | { ok: false; motivo: 'duplicada' | 'error' };

/** La Descripcion del PRIMER Concepto, directo del XML crudo — el parser de
 *  cfdi_xml.ts no la extrae (su ciclo no la necesita) y es el campo más
 *  humano de la bandeja. Regex sobre atributo, con las cinco entidades XML
 *  básicas decodificadas. null = el XML no la trae. */
export function leerDescripcionPrimerConcepto(xmlCrudo: string): string | null {
  const m = /<(?:cfdi:)?Concepto\b[^>]*\bDescripcion="([^"]*)"/i.exec(xmlCrudo);
  if (!m) return null;
  const texto = m[1]
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim();
  return texto ? texto.slice(0, 200) : null;
}

/** ¿El receptor del CFDI es el RFC de la flota? `null` cuando falta
 *  cualquiera de los dos: un `false` afirmaría "no es tuya" sin haber
 *  podido comparar. */
export function compararReceptor(rfcReceptor: string | null | undefined, rfcFlota: string | null): boolean | null {
  if (!rfcFlota || !rfcReceptor) return null;
  return rfcReceptor.trim().toUpperCase() === rfcFlota.trim().toUpperCase();
}

/**
 * Aterriza un CFDI de proveedor en la bandeja. El dedup vive en la BASE
 * (unique tenant+uuid): la misma factura subida dos veces se dice
 * `duplicada`, nunca dos filas.
 *
 * `rfcFlota` viene del caller (la página ya lo resolvió); null = la flota no
 * tiene RFC capturado y la bandera queda null — un `false` afirmaría que el
 * receptor NO es la flota sin haber podido comparar.
 */
export async function guardarFacturaProveedor(
  tenantId: string,
  xml: CfdiXmlData,
  xmlCrudo: string,
  rfcFlota: string | null,
): Promise<ResultadoIngesta> {
  if (!xml.uuid || typeof xml.total !== 'number') return { ok: false, motivo: 'error' };

  const receptorEsFlota = compararReceptor(xml.rfcReceptor, rfcFlota);

  const { data, error } = await acotada(supabaseAdmin()
    .from('factura_proveedor')
    .insert({
      tenant_id: tenantId,
      cfdi_uuid: xml.uuid,
      emisor_rfc: xml.rfcEmisor ?? null,
      emisor_nombre: null,
      receptor_rfc: xml.rfcReceptor ?? null,
      receptor_es_flota: receptorEsFlota,
      fecha: xml.fecha ? xml.fecha.slice(0, 10) : null,
      sub_total: typeof xml.subTotal === 'number' ? xml.subTotal : null,
      iva: xml.ivaTraslado || null,
      total: xml.total,
      descripcion: leerDescripcionPrimerConcepto(xmlCrudo),
      conceptos: Math.max(1, xml.conceptos.length),
      xml_crudo: xmlCrudo,
    })
    .select('id')
    .single(), 'proveedores.guardar');

  if (error) {
    if (error.code === '23505') return { ok: false, motivo: 'duplicada' };
    logger.error('proveedores.guardar_fallo', { tenantId, err: error.message });
    return { ok: false, motivo: 'error' };
  }
  return { ok: true, facturaId: (data as { id: string }).id, receptorEsFlota };
}

/** La bandeja completa, lo pendiente primero y lo más nuevo arriba. */
export async function listarFacturasProveedor(tenantId: string, limite = 100): Promise<FacturaProveedor[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('factura_proveedor')
    .select('id, cfdi_uuid, emisor_rfc, emisor_nombre, receptor_rfc, receptor_es_flota, fecha, sub_total, iva, total, descripcion, conceptos, estado, decidido_por, decidido_en, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limite), 'proveedores.listar');
  if (error) throw new Error(`listarFacturasProveedor: ${error.message}`);
  return (data ?? []).map((f) => ({
    id: f.id as string,
    cfdiUuid: f.cfdi_uuid as string,
    emisorRfc: (f.emisor_rfc as string) ?? null,
    emisorNombre: (f.emisor_nombre as string) ?? null,
    receptorRfc: (f.receptor_rfc as string) ?? null,
    receptorEsFlota: typeof f.receptor_es_flota === 'boolean' ? f.receptor_es_flota : null,
    fecha: (f.fecha as string) ?? null,
    subTotal: f.sub_total === null ? null : Number(f.sub_total),
    iva: f.iva === null ? null : Number(f.iva),
    total: Number(f.total),
    descripcion: (f.descripcion as string) ?? null,
    conceptos: Number(f.conceptos ?? 1),
    estado: f.estado as FacturaProveedor['estado'],
    decididoPor: (f.decidido_por as string) ?? null,
    decididoEn: (f.decidido_en as string) ?? null,
    creadoEn: f.created_at as string,
  }));
}

/**
 * La decisión del humano. El `.eq('estado', 'pendiente')` es el candado
 * anti-carrera: dos personas decidiendo la misma factura — el segundo clic
 * se entera, no pisa al primero.
 */
export async function decidirFacturaProveedor(
  tenantId: string,
  facturaId: string,
  decision: 'aprobada' | 'rechazada',
  decididoPor: string,
): Promise<{ error?: string }> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('factura_proveedor')
    .update({ estado: decision, decidido_por: decididoPor, decidido_en: new Date().toISOString() })
    .eq('id', facturaId)
    .eq('tenant_id', tenantId)
    .eq('estado', 'pendiente')
    .select('id'), 'proveedores.decidir');
  if (error) {
    logger.error('proveedores.decidir_fallo', { tenantId, facturaId, err: error.message });
    return { error: 'No se pudo guardar la decisión. Inténtalo de nuevo.' };
  }
  if (!data || data.length === 0) {
    return { error: 'Esa factura ya no está pendiente — alguien más la decidió. Recarga la página.' };
  }
  return {};
}

/** La fila del layout importable (SAP B1 / CONTPAQi / Excel). PURA para que
 *  la prueba fije el contrato: si una columna cambia de nombre, el import
 *  del cliente se rompe y eso debe fallar aquí primero. */
export function aFilaExportProveedor(f: FacturaProveedor): Record<string, string | number> {
  return {
    fecha: f.fecha ?? '',
    uuid: f.cfdiUuid,
    rfc_emisor: f.emisorRfc ?? '',
    rfc_receptor: f.receptorRfc ?? '',
    descripcion: f.descripcion ?? '',
    conceptos: f.conceptos,
    subtotal: f.subTotal ?? '',
    iva: f.iva ?? '',
    total: f.total,
    aprobada_por: f.decididoPor ?? '',
    aprobada_en: f.decididoEn ?? '',
  };
}
