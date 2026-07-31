// ═══════════════════════════════════════════════════════════════════════════
// DE LA CLAVE DEL SAT AL CONCEPTO DE GASTO.
//
// Cuando el XML del CFDI llega SIN foto previa, el gasto se crea desde el XML —
// que es el camino más confiable que existe, porque nada pasó por visión. Antes
// solo distinguía `diesel` o `factura`: toda caseta timbrada entraba como
// `factura`, y el estímulo de peaje del motor exige `concepto === 'caseta'`.
//
// Resultado: el 50% del peaje (LIF 2026 Art. 20-A) se perdía justo en los
// comprobantes mejor documentados. Dinero real, y invisible: nada fallaba.
// ═══════════════════════════════════════════════════════════════════════════

import type { ConceptoGasto } from '@/types/cuadra';

/**
 * Claves de peaje, verificadas en la guía de sugerencias del propio SAT
 * (omawww.sat.gob.mx — `Sugerencia_PyS/Peaje.pdf`): "Carretera o autopista o
 * autopista de peaje interestatal", unidad C62.
 *
 * NO se incluye `93151505` ("Servicios de organismos administrativos"). El SAT
 * dice que una factura de peaje emitida con esa clave no es errónea, pero la
 * clave es GENÉRICA: la usa cualquier organismo público para cualquier servicio.
 * Tratarla como caseta acreditaría el 50% de peaje sobre gastos que no lo son —
 * inventarle dinero al cliente, que es peor que quitárselo. Queda fuera hasta
 * poder distinguirla por RFC del emisor.
 */
export const CLAVES_PEAJE = ['95111602', '95111603'];

/**
 * Concepto del gasto a partir de la clave del producto/servicio del CFDI.
 * Ante una clave desconocida devuelve 'factura': no adivina.
 *
 * `clavesPeaje` NO tiene default, y es a propósito. Lo tenía —`CLAVES_PEAJE`— y
 * eso permitía llamar a la función con dos argumentos y saltarse en silencio la
 * config del cliente. El único llamador de producción pasa
 * `cfg.estimulos.clavesPeaje`, así que hoy el default estaba muerto; pero el día
 * que un tenant añada una clave de peaje suya, un llamador de dos argumentos
 * acreditaría el 50% de LIF 20-A en un camino y no en el otro, sobre la misma
 * flota y sin un error. Obligarlo a pasar la lista deja UN solo origen.
 */
export function conceptoDesdeClave(
  clave: string | undefined,
  clavesCombustible: string[],
  clavesPeaje: string[],
): ConceptoGasto {
  const c = (clave ?? '').trim();
  if (!c) return 'factura';
  if (clavesCombustible.includes(c)) return 'diesel';
  if (clavesPeaje.includes(c)) return 'caseta';
  return 'factura';
}
