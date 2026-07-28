// ═══════════════════════════════════════════════════════════════════════════
// LO QUE NO CUPO EN EL PDF.
//
// La liquidación cabe en una página y la lista de comprobantes se corta con un
// `break`. El total impreso abajo sigue siendo el TOTAL COMPLETO, así que a
// partir de ~15 comprobantes los renglones impresos no suman el total impreso.
//
// Ese papel es el que se archiva y el que un contralor suma con calculadora
// enfrente de ti. Un documento que no cuadra consigo mismo destruye la
// credibilidad de todo lo demás, aunque la cifra de abajo sea la correcta.
// ═══════════════════════════════════════════════════════════════════════════


export interface Omitidos {
  cuantos: number;
  monto: number;
  texto: string;
}

/**
 * Resume los comprobantes que no alcanzaron a imprimirse, o `null` si cupieron
 * todos.
 *
 * `monto` suma SOLO los montos positivos, igual que `totalComprobado` en el
 * motor: si sumara un monto inválido, el renglón de omitidos no cuadraría
 * contra el total del documento y el problema sería el mismo de antes.
 */
export function resumenOmitidos(gastos: Array<{ monto: number }>, mostrados: number): Omitidos | null {
  const fuera = gastos.slice(Math.max(0, mostrados));
  if (fuera.length === 0) return null;
  const monto = fuera.reduce((s, g) => (g.monto > 0 ? s + g.monto : s), 0);
  const plural = fuera.length === 1 ? 'comprobante más' : 'comprobantes más';
  return {
    cuantos: fuera.length,
    monto: Math.round(monto * 100) / 100,
    texto: `… y ${fuera.length} ${plural} (no caben en esta página)`,
  };
}

/** Un renglón que SÍ va impreso en la tabla del PDF. */
export interface FilaImprimible {
  id: string;
  concepto: string;
  monto: number;
  folio?: string;
  fecha?: string;
  /** Para que el renglón diga el producto impreso y no el cajón del concepto:
   *  un ticket de gasolina PLUS no puede aparecer como "Diésel". */
  ocrExtra?: Record<string, unknown>;
}

/**
 * Qué renglones se imprimen y cuántos duplicados se excluyeron.
 *
 * LA INVARIANTE: la suma de `filas` es EXACTAMENTE `totalComprobado`.
 *
 * El PDF recorría `liq.gastos` completo e imprimía cada uno con su monto,
 * incluidos los DUPLICADOS —que `totalComprobado` excluye—. El papel no cuadraba
 * consigo mismo, y es el que el contralor archiva y suma con calculadora.
 *
 * Se aplican los MISMOS dos filtros que usa el motor para el total: fuera los
 * duplicados y fuera los montos no positivos. Si el criterio cambia en un lado y
 * no en el otro, vuelve el mismo bug.
 */
export function filasImprimibles(liq: {
  gastos: FilaImprimible[];
  diferencias: Array<{ tipo: string; gastoId?: string }>;
}): { filas: FilaImprimible[]; duplicados: number } {
  const dup = new Set(
    liq.diferencias.filter((d) => d.tipo === 'duplicado' && d.gastoId).map((d) => d.gastoId),
  );
  const filas = liq.gastos.filter((g) => !dup.has(g.id) && g.monto > 0);
  return { filas, duplicados: liq.gastos.length - filas.length };
}
