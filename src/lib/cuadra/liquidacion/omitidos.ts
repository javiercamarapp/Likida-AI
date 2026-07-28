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

import type { Gasto } from '@/types/cuadra';

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
export function resumenOmitidos(gastos: Gasto[], mostrados: number): Omitidos | null {
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
