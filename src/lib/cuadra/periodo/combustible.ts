// ═══════════════════════════════════════════════════════════════════════════
// EL 15% DE COMBUSTIBLE EN EFECTIVO — un tope del EJERCICIO, no del viaje.
//
// `engine.ts` es puro y evalúa UN viaje, así que marcaba el diésel en efectivo
// como "por confirmar" a ciegas: sin saber si la flota va por el 3% del
// ejercicio —tranquila— o por el 14.8% —a punto de perder la deducción de todo
// lo que pague en efectivo el resto del año—. Es la misma información con dos
// valores completamente distintos para quien decide.
//
// RFA 2026 regla 2.9 (`normas/rfa-2026-2.9.yaml`, verificado_fuente_primaria):
// los pagos en efectivo por combustible valen "siempre que estos no excedan el
// 15 por ciento del total de los pagos efectuados por consumo de combustible
// para realizar su actividad".
//
// LA BASE ES COMBUSTIBLE CONTRA COMBUSTIBLE. No el gasto total de la flota, no
// las erogaciones totales, no un monto fijo por ticket. Ese denominador
// equivocado es el error que haría parecer holgada a una flota que ya se pasó.
//
// Especificación completa y sus huecos: `docs/fase1/spec-contadores-periodo.md`.
// ═══════════════════════════════════════════════════════════════════════════

/** El tope de la facilidad. Es ley (bueno, RFA): no se toca sin cambiar la ficha. */
export const TOPE_EFECTIVO = 0.15;

/**
 * Cuándo avisar. DECISIÓN DE PRODUCTO, no regla legal — por eso vive aparte del
 * tope y se llama distinto.
 *
 * Avisar al 15% no sirve de nada: para entonces la deducción ya se perdió. El
 * valor del contador está en el aviso temprano, que es lo único que le permite
 * al contralor cambiar de medio de pago a tiempo.
 */
export const UMBRAL_ALERTA = 0.12;

export type EstadoTope =
  /** Lejos del tope. */
  | 'holgado'
  /** Pasó el umbral de aviso pero no el tope legal. Todavía se puede corregir. */
  | 'cerca'
  /** Se pasó del 15%: el excedente ya no es deducible. */
  | 'excedido'
  /** No se puede evaluar con los datos que hay. NO se afirma nada. */
  | 'sin_criterio';

export interface ResultadoTope15 {
  /** Efectivo / total de combustible del ejercicio. 0 si no hay base. */
  razon: number;
  estado: EstadoTope;
  /**
   * Cuánto efectivo pasa del 15%. Es el excedente AGREGADO del ejercicio, no un
   * comprobante concreto: cuál pago específico "es" el excedente no lo resuelve
   * ninguna fuente, y por eso va a la bandeja del contralor en vez de decidirse
   * por default (ver `sin_criterio` en la spec).
   */
  excedente: number;
  /**
   * Cuánto efectivo más cabe sin pasarse. Es lo accionable: no "vas al 12%",
   * sino "te quedan $3,000 este año".
   */
  margen: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * @param efectivo         pagos de combustible en efectivo del ejercicio.
 * @param totalCombustible TODOS los pagos de combustible del ejercicio.
 */
export function evaluarTope15(acumulado: { efectivo: number; totalCombustible: number }): ResultadoTope15 {
  const efectivo = Math.max(0, acumulado.efectivo || 0);
  const total = Math.max(0, acumulado.totalCombustible || 0);

  // Sin denominador no hay razón que calcular. Dividir por cero daría NaN o
  // Infinity, y eso acabaría impreso en un PDF que alguien archiva.
  if (total <= 0) {
    // Efectivo sin total es un dato inconsistente: no se afirma nada.
    return { razon: 0, estado: efectivo > 0 ? 'sin_criterio' : 'holgado', excedente: 0, margen: 0 };
  }

  const razon = efectivo / total;
  const permitido = total * TOPE_EFECTIVO;

  return {
    razon,
    estado: razon > TOPE_EFECTIVO ? 'excedido' : razon >= UMBRAL_ALERTA ? 'cerca' : 'holgado',
    // "Rebasar el 15% no reduce proporcionalmente la deducción: tira el
    // excedente completo" — no el acumulado entero ni el gasto que lo cruzó.
    excedente: round2(Math.max(0, efectivo - permitido)),
    margen: round2(Math.max(0, permitido - efectivo)),
  };
}
