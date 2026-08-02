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

/** `condicionado` = el motor no puede sostener la afirmación entera: hay un
 *  requisito legal de la deducción que el sistema no verifica. Mismo
 *  significado que en `acreditable.ts`, para la cubeta de al lado. */
export type TonoDeducibilidad = 'bueno' | 'malo' | 'pendiente' | 'condicionado';

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
  liq: Pick<Liquidacion, 'totalDeducible' | 'totalNoDeducible' | 'totalPorConfirmar' | 'totalComprobado'> & {
    // Estructural y no `Liquidacion['diferencias']` a propósito: el llamador
    // del panel (`analytics.ts`) trae `tipo` como `string` suelto, no como el
    // union `TipoDiferencia` — es una fila ya leída de la base, no una recién
    // calculada por el motor. Todo lo que esta función necesita es comparar el
    // texto, así que atarla al tipo estricto solo forzaría un cast en el
    // llamador sin ganar nada. Opcional: los llamadores que solo prueban el
    // reparto de cubetas (sin ninguna condición fiscal de por medio) no tienen
    // por qué construir un arreglo vacío a mano.
    diferencias?: { tipo: string }[];
  },
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
    // AUDITORÍA 9, ALTO (fiscal): "Deducible para ISR" es una AFIRMACIÓN —la
    // misma regla que ya gobierna `acreditable.ts:9-11` para el renglón de al
    // lado— y el motor no sostiene entera la de un CFDI de diésel cuyo permiso
    // CRE no verificó. El renglón de peaje ya cumple esa regla con tono
    // `condicionado`; éste no la podía cumplir porque el tono no existía.
    const permisoCreNoVerificado = (liq.diferencias ?? []).some((d) => d.tipo === 'permiso_cre_no_verificable');
    filas.push(permisoCreNoVerificado
      ? {
          label: 'Deducible para ISR — sujeto a permiso CRE vigente',
          monto: liq.totalDeducible,
          tono: 'condicionado',
          pie: 'LISR 27-III y RFA 2026 regla 2.9 exigen que el CFDI de combustible consigne el permiso CRE vigente del proveedor. El sistema no lo valida — confírmelo con su contador.',
        }
      : { label: 'Deducible para ISR', monto: liq.totalDeducible, tono: 'bueno' });
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
