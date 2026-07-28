// ═══════════════════════════════════════════════════════════════════════════
// LAS TRES CUBETAS, en renglones listos para imprimir.
//
// El motor ya reparte cada peso comprobado en deducible / no deducible / por
// confirmar. Ese reparto es la razón por la que el contralor compra: le dice
// cuánto de lo que gastó el operador va a sobrevivir una revisión del SAT.
//
// Vivía calculado y sin salir a ningún lado — ni al PDF, ni al panel, ni al
// resumen. Un número que no llega a quien decide no arregla nada.
// ═══════════════════════════════════════════════════════════════════════════

import type { Liquidacion } from '@/types/cuadra';

export type TonoDeducibilidad = 'bueno' | 'malo' | 'pendiente';

export interface FilaDeducibilidad {
  label: string;
  monto: number;
  tono: TonoDeducibilidad;
  /** Por qué está en esa cubeta. Va en chico debajo del renglón. */
  pie?: string;
}

/**
 * Devuelve los renglones a imprimir, o `null` si no hay nada que repartir.
 *
 * Las cubetas en cero NO se imprimen: un "No deducible: $0.00" ocupa espacio
 * vertical que en este PDF está peleado, y no informa nada. La excepción es
 * cuando TODO es deducible, que sí conviene afirmarlo.
 */
export function filasDeducibilidad(
  liq: Pick<Liquidacion, 'totalDeducible' | 'totalNoDeducible' | 'totalPorConfirmar' | 'totalComprobado'>,
): FilaDeducibilidad[] | null {
  if (!(liq.totalComprobado > 0)) return null;
  // Las tres cubetas TIENEN que sumar el total comprobado. Si no suman, algo
  // está mal —una liquidación vieja sin repartir, un bug río arriba— y el
  // desglose sale contradiciendo a su propio total. Se vio en el render:
  // "Por confirmar $4,812" debajo de "Total comprobado $4,600".
  //
  // Un centavo de tolerancia porque el motor redondea cada cubeta por separado.
  const suma = liq.totalDeducible + liq.totalPorConfirmar + liq.totalNoDeducible;
  if (Math.abs(suma - liq.totalComprobado) > 0.015) return null;

  const filas: FilaDeducibilidad[] = [];
  if (liq.totalDeducible > 0) {
    filas.push({ label: 'Deducible para ISR', monto: liq.totalDeducible, tono: 'bueno' });
  }
  if (liq.totalPorConfirmar > 0) {
    filas.push({
      label: 'Por confirmar',
      monto: liq.totalPorConfirmar,
      tono: 'pendiente',
      pie: 'Falta timbrar la factura o acreditar el medio de pago. Se puede recuperar.',
    });
  }
  if (liq.totalNoDeducible > 0) {
    filas.push({
      label: 'No deducible',
      monto: liq.totalNoDeducible,
      tono: 'malo',
      pie: 'Ver las diferencias detectadas abajo.',
    });
  }
  return filas.length ? filas : null;
}
