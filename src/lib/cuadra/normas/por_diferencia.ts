// ═══════════════════════════════════════════════════════════════════════════
// QUÉ NORMA FUNDAMENTA CADA DIFERENCIA.
//
// El puente entre el motor y `guardiaFundamento`: cuando el cuadre levanta una
// diferencia, esto dice qué normas puede citar el agente al explicarla. Todo lo
// demás se le quita del mensaje.
//
// Es también un inventario incómodo a propósito: un tipo de diferencia SIN norma
// aquí es el motor afirmando algo que ninguna ficha respalda. A veces está bien
// —hay diferencias que son de política interna de la flota o de calidad del
// dato, no de la ley— y por eso se declaran explícitamente en `SIN_NORMA` en vez
// de dejarlas fuera y que parezca un olvido.
// ═══════════════════════════════════════════════════════════════════════════

import type { TipoDiferencia } from '@/types/cuadra';

/**
 * Normas que fundamentan cada diferencia. El orden importa: la primera es la
 * regla general y las siguientes son las excepciones o matices.
 *
 * El caso de `combustible_efectivo` es el ejemplo del patrón que ya costó dinero
 * cuatro veces en este proyecto: LISR 27-III lo prohíbe en absoluto, y RFA 2026
 * regla 2.9 concede hasta el 15%. El agente tiene que poder citar las DOS o
 * explicará mal el veredicto.
 */
export const NORMA_POR_DIFERENCIA: Partial<Record<TipoDiferencia, string[]>> = {
  sin_cfdi: ['lisr-27-fr-III'],
  combustible_efectivo: ['lisr-27-fr-III', 'rfa-2026-2.9'],
  efectivo_sobre_tope: ['lisr-27-fr-III'],
  viatico_excede_fiscal: ['lisr-28-fr-V'],
  alimentacion_sin_soporte: ['lisr-28-fr-V'],
  viatico_rfc_operador: ['rlisr-57'],
  rfc_receptor: ['cff-29-A'],
  // El veredicto más severo que emite el motor. Hasta hoy no tenía ficha: se
  // tiraba una deducción entera sobre una norma que nadie había transcrito.
  cfdi_efos: ['cff-69-B'],
  cfdi_efos_indeterminado: ['cff-69-B'],
  cfdi_cancelado: ['cff-29-A'],
  cfdi_no_encontrado: ['cff-29-A'],
  cfdi_pendiente: ['cff-29-A'],
  complemento_hidrocarburos: ['rmf-2026-2.7.1.48'],
  complemento_no_verificable: ['rmf-2026-2.7.1.48'],
  ieps_no_desglosado: ['lif-2026-art-20-A', 'criterio-1-LIF-PI'],
  factura_por_vencer: ['rmf-2026-2.7.1.21', 'politica-portales-plazos-facturacion'],
};

/**
 * Diferencias que NO tienen norma detrás, con el motivo. Están aquí y no
 * ausentes para que se vea que es una decisión y no un olvido.
 *
 * Que no tengan norma no las hace menos válidas: significa que el agente NO debe
 * citar ley al explicarlas. Decir "por la ley" sobre un tope que puso la flota
 * es exactamente el error de confundir niveles que `normas/README.md` llama el
 * más caro del dominio.
 */
export const SIN_NORMA: Partial<Record<TipoDiferencia, string>> = {
  sobre_politica: 'Tope de la propia flota, no de la ley.',
  sin_comprobante: 'Falta operativa: no llegó la foto.',
  duplicado: 'Calidad del dato: el mismo comprobante dos veces.',
  anticipo: 'Aritmética del viaje, no una regla fiscal.',
  ocr_baja_confianza: 'Calidad de la lectura.',
  monto_invalido: 'Calidad del dato.',
  monto_discrepante: 'Calidad del dato: el código y el OCR no coinciden.',
  fecha_sospechosa: 'Calidad del dato.',
  folio_verificar: 'Calidad del dato.',
  texto_sospechoso: 'Seguridad, no fiscalidad.',
  diesel_desviacion: 'Señal operativa contra el rendimiento esperado.',
};

/**
 * Normas citables al explicar estas diferencias. Lo que no salga de aquí, el
 * agente no lo puede escribir.
 */
export function normasDe(tipos: TipoDiferencia[]): string[] {
  const out = new Set<string>();
  for (const t of tipos) for (const id of NORMA_POR_DIFERENCIA[t] ?? []) out.add(id);
  return [...out];
}
