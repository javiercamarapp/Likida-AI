// ═══════════════════════════════════════════════════════════════════════════
// LIGAR UN CFDI DEL SAT A UN GASTO, COPIANDO SUS CAMPOS FISCALES
// (auditoría 35, R04-fiscal-01, ALTO).
//
// Antes, los dos caminos que ligan un CFDI de la descarga masiva (el
// automático de `ciclo.ts` y el manual de `resolucion.ts`) escribían solo
// `cfdi_uuid`, `cfdi_orden` y `xml_verificado = true`. El gasto quedaba
// «verificado» con sub_total, iva_traslado y rfc_receptor en NULL: sin IVA
// acreditable, sin estímulo de peaje y con la póliza bloqueada por folio. El
// camino de WhatsApp (`updateGastoCfdiXml`) sí copiaba esos campos.
//
// Este archivo tiene tres piezas, las tres sin estado:
//
//   1. `camposFiscalesDeXml`  — PURA: del XML crudo a los campos que viajan a
//      la base, o `null` con el motivo por el que NO se copia nada. Mismas
//      guardas que la base (0858) vuelve a aplicar: la base es la última
//      línea, esta es la que explica el porqué.
//   2. `ligarGastoAutomatico` — la liga del cruce automático.
//   3. `esFuncionAusente`     — distingue «la migración 0858 aún no se aplicó»
//      de un fallo cualquiera: con la función nueva ausente se usa el camino
//      de siempre (solo liga) y se dice en el log. Así este código puede
//      desplegarse ANTES o DESPUÉS de la migración sin romper la descarga.
//
// REGLA DE ORO: ante la duda no se copia nada y NUNCA se inventa un valor. Un
// campo que el XML no trae se queda NULL; un XML que no pasa las guardas liga
// el gasto como antes (con la marca de verificado) y el motivo se reporta.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { logger } from '@/lib/logger';
import { parseCfdiXml, esConsolidado } from '../intake/cfdi_xml';

/** Los campos tal como los recibe `gasto_ligar_cfdi_campos` (0858). */
export type CamposFiscales = Record<string, string | number | boolean>;

export type MotivoSinCampos =
  | 'sin_xml'
  | 'xml_ilegible'
  | 'sin_folio'
  | 'folio_distinto'
  | 'nota_de_credito'
  | 'consolidado'
  | 'total_ilegible'
  | 'sin_subtotal'
  // Los dos siguientes los decide la base (necesitan el gasto):
  | 'total_no_coincide'
  | 'emisor_distinto'
  | 'funcion_ausente';

export interface ResultadoCampos {
  campos: CamposFiscales | null;
  motivo: MotivoSinCampos | null;
}

/** Quita el ruido de coma flotante de las sumas del parser (0.1 + 0.2). */
function limpio(n: number): number {
  return Number(n.toFixed(6));
}

function esNumeroValido(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Del XML crudo a los campos fiscales que se copian al gasto.
 *
 * Devuelve `campos: null` (y el motivo) cuando el XML no pasa las guardas:
 * ilegible, sin folio, folio distinto del que se está ligando, nota de crédito
 * (resta una deducción, no la documenta), consolidado (se concilia línea por
 * línea, nunca 1:1), sin total o sin SubTotal. Un campo opcional ausente
 * (forma de pago, moneda…) simplemente no viaja: queda NULL en la base.
 */
export function camposFiscalesDeXml(xml: string | null | undefined, cfdiUuid: string): ResultadoCampos {
  if (typeof xml !== 'string' || xml.trim() === '') return { campos: null, motivo: 'sin_xml' };
  const c = parseCfdiXml(xml);
  if (c === null) return { campos: null, motivo: 'xml_ilegible' };
  if (!c.uuid) return { campos: null, motivo: 'sin_folio' };
  if (c.uuid.toLowerCase() !== cfdiUuid.trim().toLowerCase()) return { campos: null, motivo: 'folio_distinto' };
  if (c.tipoComprobante === 'E') return { campos: null, motivo: 'nota_de_credito' };
  if (esConsolidado(c)) return { campos: null, motivo: 'consolidado' };
  if (!esNumeroValido(c.total) || !(c.total > 0)) return { campos: null, motivo: 'total_ilegible' };
  if (!esNumeroValido(c.subTotal) || c.subTotal < 0) return { campos: null, motivo: 'sin_subtotal' };

  const campos: CamposFiscales = { uuid: c.uuid.toLowerCase(), total: c.total, sub_total: c.subTotal };
  const texto = (k: string, v: string | undefined) => { if (v && v.trim() !== '') campos[k] = v.trim(); };
  const monto = (k: string, v: number | undefined) => { if (esNumeroValido(v) && v >= 0) campos[k] = limpio(v); };

  texto('tipo_comprobante', c.tipoComprobante);
  texto('fecha', c.fecha);
  texto('rfc_emisor', c.rfcEmisor);
  texto('rfc_receptor', c.rfcReceptor);
  texto('forma_pago', c.formaPago);
  texto('metodo_pago', c.metodoPago);
  texto('clave_prod_serv', c.claveProdServ);
  texto('clave_unidad', c.claveUnidad);
  texto('moneda', c.moneda);
  monto('descuento', c.descuento);
  monto('ieps_traslado', c.iepsTraslado);
  monto('iva_traslado', c.ivaTraslado);
  monto('iva_retenido', c.ivaRetenido);
  monto('isr_retenido', c.isrRetenido);
  if (esNumeroValido(c.cantidad) && c.cantidad > 0) campos.cantidad = c.cantidad;
  if (esNumeroValido(c.tipoCambio) && c.tipoCambio > 0) campos.tipo_cambio = c.tipoCambio;
  campos.complemento_hidrocarburos = c.complementoHidrocarburos;
  campos.esquema_alterno = c.esquemaAlterno;
  return { campos, motivo: null };
}

/**
 * ¿El error de la base es «esa función no existe» (migración sin aplicar)?
 * PostgREST responde PGRST202; Postgres directo, 42883.
 */
export function esFuncionAusente(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const e = error as { code?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const msg = typeof e.message === 'string' ? e.message : '';
  return code === 'PGRST202' || code === '42883' || /could not find the function/i.test(msg);
}

export interface ResultadoLigaAutomatica {
  /** El gasto quedó ligado (false = perdió la carrera o hubo error). */
  ligado: boolean;
  camposCopiados: boolean;
  motivo: MotivoSinCampos | null;
}

/**
 * La liga del cruce automático. Intenta `gasto_ligar_cfdi_campos` (0858); si la
 * función aún no existe, hace el UPDATE de siempre (solo liga) y lo dice.
 * La guardia optimista `cfdi_uuid is null` vive en ambos caminos: jamás se
 * pisa un comprobante que ya estaba.
 */
export async function ligarGastoAutomatico(
  tenantId: string,
  gastoId: string,
  cfdiUuid: string,
  xml: string,
): Promise<ResultadoLigaAutomatica> {
  const { campos, motivo } = camposFiscalesDeXml(xml, cfdiUuid);

  const { data, error } = await acotada(supabaseAdmin().rpc('gasto_ligar_cfdi_campos', {
    p_tenant: tenantId,
    p_gasto: gastoId,
    p_cfdi_uuid: cfdiUuid,
    p_campos: campos,
  }), 'sat_descarga.ligar_campos');

  if (!error) {
    const r = (data ?? {}) as { ligado?: unknown; campos_copiados?: unknown; motivo?: unknown };
    const ligado = r.ligado === true;
    const copiados = ligado && r.campos_copiados === true;
    const motivoFinal = copiados ? null : ((typeof r.motivo === 'string' ? r.motivo : motivo) as MotivoSinCampos | null);
    if (ligado && !copiados) {
      logger.warn('sat.ligar_sin_campos', { tenantId, motivo: motivoFinal });
    }
    return { ligado, camposCopiados: copiados, motivo: copiados ? null : motivoFinal };
  }

  if (!esFuncionAusente(error)) {
    logger.warn('sat.ligar_fallo', { tenantId, err: error.message });
    return { ligado: false, camposCopiados: false, motivo };
  }

  // La migración 0858 todavía no está en esta base: se liga como antes.
  logger.warn('sat.ligar_sin_migracion_0858', { tenantId });
  const { data: filas, error: errUpd } = await acotada(supabaseAdmin()
    .from('gasto')
    .update({ cfdi_uuid: cfdiUuid, cfdi_orden: 1, xml_verificado: true })
    .eq('tenant_id', tenantId)
    .eq('id', gastoId)
    .is('cfdi_uuid', null)
    .select('id'), 'sat_descarga.ligar');
  if (errUpd) {
    logger.warn('sat.ligar_fallo', { tenantId, err: errUpd.message });
    return { ligado: false, camposCopiados: false, motivo: 'funcion_ausente' };
  }
  return { ligado: (filas ?? []).length === 1, camposCopiados: false, motivo: 'funcion_ausente' };
}
