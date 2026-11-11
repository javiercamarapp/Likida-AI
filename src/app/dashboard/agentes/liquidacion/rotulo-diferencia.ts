// ═══════════════════════════════════════════════════════════════════════════
// CÓMO SE LEE CADA TIPO DE DIFERENCIA DEL MOTOR EN LA PANTALLA DEL CLIENTE.
//
// AUDITORÍA 18, MEDIO (M10): el mapa vivía en `vista.tsx` tipado contra
// `Record<string, string>` con tres renglones —uno de ellos (`sin_comprobar`)
// para una clave que no existe— y los ~30 tipos reales caían a
// `t.replaceAll('_', ' ')`: "cfdi efos · 1 — $22,000", el veredicto más severo
// del motor, salía como jerga cruda al lado de dos renglones en español.
//
// Mismo patrón que `lib/likida/normas/por_diferencia.ts`: se declara CADA
// `TipoDiferencia`. Con `Record<TipoDiferencia, string>` (no `Partial`) un tipo
// nuevo en `types/likida.ts` deja de compilar hasta que tenga su rótulo — que
// es lo que se quiere: el rótulo es parte de emitir el tipo.
// ═══════════════════════════════════════════════════════════════════════════

import type { TipoDiferencia } from '@/types/likida';
import { type TAgentes, type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';

export const rotuloDiferenciaTr = (tx: TAgentes = TR_ES.t): Record<TipoDiferencia, string> => ({
  sobre_politica: tx('rest.sobre_politica'),
  sin_comprobante: tx('rest.sin_comprobante'),
  duplicado: tx('rest.duplicado'),
  posible_duplicado_sin_folio: 'Posible duplicado (sin folio)',
  sin_cfdi: tx('rest.sin_cfdi'),
  anticipo: tx('rest.diferencia_contra_el_anticipo'),
  ocr_baja_confianza: 'Lectura dudosa (OCR)',
  rfc_receptor: tx('rest.cfdi_a_otro_rfc'),
  rfc_receptor_no_verificable: tx('rest.rfc_receptor_no_verificable'),
  cfdi_cancelado: tx('rest.cfdi_cancelado'),
  cfdi_efos: 'Emisor en lista 69-B (EFOS)',
  cfdi_efos_indeterminado: 'Emisor 69-B por confirmar',
  consumo_bar: tx('rest.consumo_en_bar_por_confirmar_lisr'),
  ticket_monedero: tx('rest.ticket_de_monedero_no_factura_de'),
  cfdi_no_encontrado: tx('rest.cfdi_no_encontrado_en_el_sat'),
  cfdi_pendiente: tx('rest.cfdi_pendiente_de_validar'),
  monto_invalido: tx('rest.monto_invalido'),
  complemento_hidrocarburos: tx('rest.sin_complemento_de_hidrocarburos'),
  complemento_no_verificable: tx('rest.complemento_no_verificable'),
  // AUDITORÍA 18-c3, FISC-C3-1: la regla dejó de ser «es efectivo» y pasó a ser
  // «no es de los medios que la LISR 27-III admite» (RFA 2.9, por exclusión).
  // La CLAVE no cambia —la escriben liquidaciones ya guardadas— pero el rótulo
  // sí: con forma de pago '06' decir «en efectivo» era falso en pantalla.
  combustible_efectivo: tx('rest.combustible_sin_medio_de_pago_admitido'),
  efectivo_sobre_tope: tx('rest.efectivo_sobre_el_tope'),
  // Mismo criterio que `combustible_efectivo`: el rótulo NO dice «efectivo»,
  // porque con forma '06' o '12' sería falso en pantalla (auditoría 22, FIS-C3).
  medio_pago_no_admitido: tx('rest.medio_de_pago_fuera_de_la'),
  ieps_no_desglosado: tx('rest.ieps_sin_desglosar'),
  viatico_excede_fiscal: tx('rest.viatico_sobre_el_tope_fiscal'),
  fecha_sospechosa: tx('rest.fecha_sospechosa'),
  gasto_otro_ejercicio: tx('rest.gasto_de_otro_ejercicio'),
  iva_mes_del_pago: tx('rest.iva_se_acredita_en_el_mes'),
  folio_verificar: tx('rest.folio_por_verificar'),
  monto_discrepante: tx('rest.monto_discrepante'),
  monto_implausible: tx('rest.monto_fuera_de_escala'),
  moneda_extranjera: tx('rest.comprobante_en_moneda_extranjera'),
  texto_sospechoso: tx('rest.texto_sospechoso_en_el_comprobante'),
  renglones_ajenos: tx('rest.incluye_partidas_que_no_son_del'),
  alimentacion_sin_soporte: tx('rest.alimentacion_sin_soporte'),
  alimentacion_transporte_sin_tarjeta_credito: tx('rest.alimentacion_sin_tarjeta_de_credito'),
  viatico_rfc_operador: tx('rest.viatico_a_nombre_del_operador'),
  factura_por_vencer: tx('rest.factura_por_vencer'),
  comprobante_no_fiscal: tx('rest.comprobante_no_fiscal'),
  diesel_desviacion: tx('rest.desviacion_de_diesel'),
  tarjeta_no_empresa: tx('rest.tarjeta_que_no_es_de_la'),
  tarjeta_sin_declarar: tx('rest.tarjeta_sin_declarar_si_es_de'),
  permiso_cre_no_verificable: tx('rest.permiso_cre_no_verificable'),
  combustible_efectivo_dentro15: tx('rest.combustible_sin_medio_admitido_dentro_del'),
  efectivo_sobre_15: tx('rest.combustible_sin_medio_admitido_sobre_el'),
  efectivo_no_elegible: tx('rest.combustible_sin_medio_admitido_flota_no'),
  oposicion_titular: tx('rest.oposicion_del_titular'),
});
export const ROTULO_DIFERENCIA = rotuloDiferenciaTr();

/** Para lo que llega del jsonb como `string`. Un tipo que el motor ya no emite
 *  (o que alguien escribió a mano) cae a un reemplazo legible, nunca a vacío. */
export function rotuloDiferencia(tipo: string, tx: TAgentes = TR_ES.t): string {
  const r = (rotuloDiferenciaTr(tx) as Record<string, string | undefined>)[tipo];
  if (r) return r;
  const limpio = tipo.replaceAll('_', ' ').trim();
  return limpio ? limpio.charAt(0).toUpperCase() + limpio.slice(1) : '—';
}
