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
 * La SEGUNDA foto del mismo ticket, mandada porque se le pidió al operador que
 * la repitiera: la primera trajo una fecha que no cuadraba con el viaje.
 *
 * Sin esto, pedirle esa foto sería mandarlo a hacer algo que el sistema tira:
 * una foto legible del mismo papel entra como `alta`, el motor la ve como
 * duplicado y la EXCLUYE del total. El operador hace el trabajo, no se rompe
 * nada visible, y la fecha mala sigue exactamente donde estaba.
 *
 * Y NO es solo que se pierda la corrección: `copiasDeComprobante` deduplica por
 * `concepto|folio|monto`, así que un ticket SIN folio no se deduplica. La
 * segunda foto de ése entra como gasto nuevo e INFLA el total. Pedir la foto sin
 * este camino no era neutro: podía cobrar el mismo gasto dos veces.
 *
 * Reglas, todas necesarias para no mover el dinero:
 *
 *   • el candidato tiene que tener la fecha YA marcada como dudosa. No se
 *     re-fecha un comprobante que nadie cuestionó;
 *   • mismo concepto y mismo total;
 *   • si LOS DOS traen folio, tiene que ser el mismo. Es la llave que el motor
 *     usa para deduplicar, y es lo único que distingue dos casetas de $300 del
 *     mismo día —conflatarlas dejaría una con la fecha de la otra y la segunda
 *     sin registrar—. Que a uno le falte se tolera: leer mal el folio es justo
 *     por lo que se pidió la foto otra vez;
 *   • y ÚNICO. Ante dos candidatos no se adivina, misma regla que sus hermanas.
 *
 * Lo que devuelve se usa para ACTUALIZAR la fecha, nunca el monto: si el total
 * cambió, no es el mismo ticket y no hay corrección que hacer.
 */
export function emparejarCorreccionDeFecha(
  foto: { monto: number; concepto: string; folio?: string | null },
  gastos: Gasto[],
  esDudosa: (fecha: string | null | undefined) => boolean,
): Gasto | null {
  const candidatos = gastos.filter((g) =>
    Math.abs(g.monto - foto.monto) <= TOLERANCIA &&
    g.concepto === foto.concepto &&
    esDudosa(g.fecha) &&
    (!g.folio || !foto.folio || g.folio === foto.folio));
  return candidatos.length === 1 ? candidatos[0] : null;
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

/**
 * El XML timbrado que llega DESPUÉS de la foto del ticket.
 *
 * Un ticket de gasolinera no es factura y NO trae UUID. La secuencia normal es:
 * el operador fotografía el ticket (gasto sin UUID) y luego la oficina reenvía el
 * XML. Emparejando solo por UUID no se encuentra nada y se crea un SEGUNDO gasto:
 * el mismo consumo contado dos veces, con su IVA y su IEPS encima.
 *
 * Un `unique(tenant_id, cfdi_uuid)` NO lo arregla: el del ticket es NULL, y NULL
 * no colisiona con nada. Tiene que resolverse aquí, por monto y fecha.
 *
 * Misma regla dura que sus hermanas: sin candidato ÚNICO no se toca nada. Pegarle
 * el XML al ticket equivocado le cambia el emisor, el IVA y el IEPS a un gasto que
 * no era — y encima deja el otro sin factura.
 */
export function emparejarXmlConTicket(
  xml: { total?: number; fecha?: string },
  gastos: Gasto[],
): Gasto | null {
  if (!(xml.total != null && xml.total > 0)) return null; // sin monto no se adivina
  // Solo tickets SIN timbrar: los que ya tienen UUID son facturas y se emparejan
  // por UUID antes de llegar aquí.
  const candidatos = gastos.filter((g) => !g.cfdiUuid && Math.abs(g.monto - xml.total!) <= TOLERANCIA);
  if (candidatos.length === 1) return candidatos[0];
  if (candidatos.length === 0) return null;
  // Varios del mismo monto: la fecha desempata (dos cargas iguales en días
  // distintos es plausible en un viaje largo).
  if (!xml.fecha) return null;
  const dia = xml.fecha.slice(0, 10);
  const mismoDia = candidatos.filter((g) => g.fecha?.slice(0, 10) === dia);
  return mismoDia.length === 1 ? mismoDia[0] : null;
}
