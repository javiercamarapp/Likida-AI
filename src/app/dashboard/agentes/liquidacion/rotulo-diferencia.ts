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

export const ROTULO_DIFERENCIA: Record<TipoDiferencia, string> = {
  sobre_politica: 'Sobre política',
  sin_comprobante: 'Sin comprobante',
  duplicado: 'Duplicado',
  sin_cfdi: 'Sin CFDI',
  anticipo: 'Diferencia contra el anticipo',
  ocr_baja_confianza: 'Lectura dudosa (OCR)',
  rfc_receptor: 'CFDI a otro RFC',
  rfc_receptor_no_verificable: 'RFC receptor no verificable',
  cfdi_cancelado: 'CFDI cancelado',
  cfdi_efos: 'Emisor en lista 69-B (EFOS)',
  cfdi_efos_indeterminado: 'Emisor 69-B por confirmar',
  cfdi_no_encontrado: 'CFDI no encontrado en el SAT',
  cfdi_pendiente: 'CFDI pendiente de validar',
  monto_invalido: 'Monto inválido',
  complemento_hidrocarburos: 'Sin complemento de hidrocarburos',
  complemento_no_verificable: 'Complemento no verificable',
  combustible_efectivo: 'Combustible en efectivo',
  efectivo_sobre_tope: 'Efectivo sobre el tope',
  ieps_no_desglosado: 'IEPS sin desglosar',
  viatico_excede_fiscal: 'Viático sobre el tope fiscal',
  fecha_sospechosa: 'Fecha sospechosa',
  folio_verificar: 'Folio por verificar',
  monto_discrepante: 'Monto discrepante',
  texto_sospechoso: 'Texto sospechoso en el comprobante',
  alimentacion_sin_soporte: 'Alimentación sin soporte',
  alimentacion_transporte_sin_tarjeta_credito: 'Alimentación sin tarjeta de crédito',
  viatico_rfc_operador: 'Viático a nombre del operador',
  factura_por_vencer: 'Factura por vencer',
  comprobante_no_fiscal: 'Comprobante no fiscal',
  diesel_desviacion: 'Desviación de diésel',
  permiso_cre_no_verificable: 'Permiso CRE no verificable',
  combustible_efectivo_dentro15: 'Combustible en efectivo (dentro del 15%)',
  efectivo_sobre_15: 'Efectivo sobre el 15%',
  efectivo_no_elegible: 'Efectivo no elegible',
  oposicion_titular: 'Oposición del titular',
};

/** Para lo que llega del jsonb como `string`. Un tipo que el motor ya no emite
 *  (o que alguien escribió a mano) cae a un reemplazo legible, nunca a vacío. */
export function rotuloDiferencia(tipo: string): string {
  const r = (ROTULO_DIFERENCIA as Record<string, string | undefined>)[tipo];
  if (r) return r;
  const limpio = tipo.replaceAll('_', ' ').trim();
  return limpio ? limpio.charAt(0).toUpperCase() + limpio.slice(1) : '—';
}
