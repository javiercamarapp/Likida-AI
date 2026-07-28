// ═══════════════════════════════════════════════════════════════════════════
// EMPAREJAR el acercamiento con su comprobante.
//
// El protocolo de dos fotos no le pide al operador que etiquete nada: manda la
// foto del ticket y, si el código no entró, un acercamiento al código. En
// WhatsApp cada foto es su propio mensaje, así que hay que inferir cuál va con
// cuál. La única llave común entre las dos es el TOTAL: el del código es exacto
// y el del ticket lo leyó el OCR.
//
// Esto vive en el camino del dinero. Emparejar mal no deja un hueco visible:
// le cuelga a un comprobante el folio de otro, y ese folio es justo el que la
// oficina teclea en el portal para timbrar. Por eso ante la duda NO se adivina.
// ═══════════════════════════════════════════════════════════════════════════

import type { Gasto } from '@/types/cuadra';

/** Centavo de tolerancia: el total del código y el del OCR pueden redondear distinto. */
const TOLERANCIA = 0.01;

/**
 * Devuelve el gasto al que pertenece un acercamiento, o `null` si no hay una
 * respuesta única.
 */
export function emparejarPorMonto(monto: number, gastos: Gasto[]): Gasto | null {
  const candidatos = gastos.filter((g) => Math.abs(g.monto - monto) <= TOLERANCIA);
  if (candidatos.length === 0) return null;
  if (candidatos.length === 1) return candidatos[0];
  // Varios con el mismo total (dos casetas de $300 el mismo día es corriente).
  // Los que YA tienen folio de portal ya recibieron su acercamiento; si al
  // descartarlos queda exactamente uno, ese es — y si no, no se adivina.
  const sinEnriquecer = candidatos.filter((g) => !(g.ocrExtra as Record<string, unknown> | undefined)?.folioPortal);
  return sinEnriquecer.length === 1 ? sinEnriquecer[0] : null;
}

/**
 * Un acercamiento que llegó ANTES que su ticket y quedó esperando en la bandeja.
 * Solo lleva lo que sacó del código: nada de esto pasó por visión.
 */
export interface CodigoPendiente {
  id: string;
  monto: number;
  folioPortal?: string;
  codigoBarras?: string;
  urlFacturacion?: string;
  cfdiUuid?: string;
}

/**
 * El sentido contrario de `emparejarPorMonto`: acaba de entrar un comprobante y
 * hay que ver si alguno de los códigos guardados lo estaba esperando.
 *
 * Misma regla dura: sin candidato ÚNICO no se pega nada. Colgarle a este ticket
 * el folio de otro comprobante es peor que dejarlo sin folio, porque nadie lo
 * nota hasta que el portal rechaza el timbrado.
 */
export function emparejarPendiente(monto: number, bandeja: CodigoPendiente[]): CodigoPendiente | null {
  const candidatos = bandeja.filter((c) => Math.abs(c.monto - monto) <= TOLERANCIA);
  return candidatos.length === 1 ? candidatos[0] : null;
}
