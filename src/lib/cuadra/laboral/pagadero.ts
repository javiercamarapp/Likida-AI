// ═══════════════════════════════════════════════════════════════════════════
// DEDUCIBLE ≠ PAGADERO. Dos veredictos distintos que el producto mezclaba.
//
// El motor solo emitía `deducible`. De ahí a un descuento de nómina hay un paso
// que la ley NO permite dar: que un gasto no sea deducible para ISR no autoriza
// descontárselo al operador. Sin esta separación, una liquidación puede imprimir
// un neto ilegal — y el papel lo firma la flota, no Likida.
//
// La norma que lo obliga es la que choca de frente con la lógica de topes
// (`normas/lft-110-111-263.yaml`, verificado contra fuente primaria):
//
//   Art. 263 fr. I — "En los transportes foráneos pagar los gastos de hospedaje
//   y alimentación de los trabajadores, cuando se prolongue o retarde el viaje
//   por causa que no sea imputable a éstos"
//
// Cuando el viaje se alargó por causa ajena, ese gasto SE DEBE aunque rompa la
// política de la flota y aunque parte no sea deducible.
// ═══════════════════════════════════════════════════════════════════════════

import type { Gasto } from '@/types/cuadra';

/** Ficha que fundamenta todo lo de este módulo. */
export const NORMA_LABORAL = 'lft-110-111-263';

/**
 * `true` se debe pagar, `false` no, `'sin_criterio'` no lo resuelve la ley y va
 * a la bandeja del contralor.
 *
 * El tercer valor no es una comodidad: hay casos que ninguna fuente resuelve, y
 * elegir por default sería inventar una regla laboral.
 */
export type Pagadero = boolean | 'sin_criterio';

export interface VeredictoLaboral {
  pagadero: Pagadero;
  /** norma_id que lo sostiene, para `guardiaFundamento`. Vacío si no hay norma. */
  fundamento: string[];
  nota: string;
}

/** Los dos conceptos que el art. 263 fr. I nombra, y solo esos. */
const OBLIGACION_263 = new Set(['hospedaje', 'alimentacion']);

export function veredictoLaboral(
  gasto: Gasto,
  ctx: {
    /** Veredicto FISCAL. No decide este. */
    deducible: boolean;
    sobrePolitica?: boolean;
    /** El viaje se prolongó por causa que NO es imputable al operador. */
    demoraNoImputable?: boolean;
  },
): VeredictoLaboral {
  // Obligación especial del patrón. Manda sobre la política interna: la flota no
  // puede pactar por debajo de la ley.
  if (ctx.demoraNoImputable && OBLIGACION_263.has(gasto.concepto)) {
    return {
      pagadero: true,
      fundamento: [NORMA_LABORAL],
      nota: 'Se debe pagar: el viaje se prolongó por causa no imputable al operador, y el hospedaje y la alimentación son obligación del patrón (LFT 263-I), aunque el gasto rompa la política o no sea deducible.',
    };
  }

  // Sobre política sin causa ajena: la ley no obliga a pagarlo, pero TAMPOCO
  // autoriza descontarlo solo. El art. 110 fr. I exige acuerdo con el
  // trabajador, y eso no lo decide un motor.
  if (ctx.sobrePolitica) {
    return {
      pagadero: 'sin_criterio',
      fundamento: [NORMA_LABORAL],
      nota: 'Excede la política y no consta que la demora fuera ajena al operador. Descontarlo exige acuerdo con él (LFT 110-I): lo revisa el contralor, no se descuenta solo.',
    };
  }

  // Todo lo demás se paga. Que un comprobante no sea deducible es un problema de
  // papeleo entre la flota y el SAT; el operador ya puso el dinero.
  return {
    pagadero: true,
    fundamento: [],
    nota: ctx.deducible
      ? 'Gasto normal del viaje.'
      : 'No es deducible todavía, pero el operador puso el dinero: eso se le reembolsa igual. La deducción se arregla timbrando.',
  };
}

/** Salario mínimo general mensual 2026, MXN. Referencia externa: se configura. */
export interface TopeDescuentoInput {
  saldoPropuesto: number;
  /** Del operador. Sin él no se puede aplicar ningún tope. */
  salarioMensual?: number;
  salarioMinimoMensual?: number;
}

export interface TopeDescuento {
  /** Saldo que se le puede exigir. Nunca más que el salario de un mes. */
  exigible: number;
  /** Cuánto se le puede descontar por periodo. */
  descuentoPeriodo: number;
  /** `true` si hubo que recortar lo propuesto. */
  recortado: boolean;
  /** `true` si faltan datos y NO se aplicó tope alguno. */
  sinCriterio: boolean;
  nota: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Los dos topes del art. 110 fr. I, que son DISTINTOS y conviene no confundir:
 *
 *   - al SALDO exigible: "en ningún caso podrá ser mayor del importe de los
 *     salarios de un mes";
 *   - al DESCUENTO por periodo: "sin que pueda ser mayor del treinta por ciento
 *     del EXCEDENTE del salario mínimo".
 *
 * El segundo es sobre el excedente, no sobre el salario. Confundirlo multiplica
 * el descuento y deja un neto ilegal en el papel.
 *
 * Y nunca hay intereses: art. 111, "las deudas contraídas por los trabajadores
 * con sus patrones en ningún caso devengarán intereses". Por eso `exigible`
 * nunca puede salir mayor que lo propuesto.
 */
export function topeDescuento(input: TopeDescuentoInput): TopeDescuento {
  const propuesto = Math.max(0, input.saldoPropuesto || 0);

  // SIN CRITERIO. Un operador que cobra por viaje o por kilómetro es un esquema
  // que el propio art. 257 reconoce, y ninguna fuente de este repo dice cómo
  // convertir eso a "el importe de los salarios de un mes". No se adivina: va a
  // la bandeja del contralor.
  if (!(input.salarioMensual && input.salarioMensual > 0)) {
    return {
      exigible: 0, descuentoPeriodo: 0, recortado: false, sinCriterio: true,
      nota: 'No se aplicó ningún tope de descuento: falta el salario del operador. Si cobra por viaje o por kilómetro, cómo se traduce eso a "un mes de salario" no lo resuelve la ley — lo decide el contralor con su abogado laboral (LFT 110-I).',
    };
  }

  const exigible = Math.min(propuesto, input.salarioMensual);
  const excedente = Math.max(0, input.salarioMensual - (input.salarioMinimoMensual ?? 0));
  const descuentoPeriodo = round2(Math.min(exigible, excedente * 0.30));

  return {
    exigible: round2(exigible),
    descuentoPeriodo,
    recortado: exigible < propuesto,
    sinCriterio: false,
    nota: descuentoPeriodo === 0
      ? 'No se le puede descontar nada este periodo: su salario no excede el mínimo, y el tope del 30% se calcula sobre ese excedente (LFT 110-I).'
      : `Se le puede exigir hasta ${exigible.toFixed(2)} en total y descontar hasta ${descuentoPeriodo.toFixed(2)} por periodo (LFT 110-I). Sin intereses, nunca (LFT 111).`,
  };
}
