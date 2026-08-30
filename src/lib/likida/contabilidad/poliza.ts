// ═══════════════════════════════════════════════════════════════════════════
// LA PÓLIZA CONTABLE — lo que la landing promete: «el formato que SAP Business
// One o CONTPAQi ya sabe importar, sin retecleo».
//
// Hasta hoy el export era un CSV de ocho columnas (folio, operador, fecha,
// comprobado, anticipo, diferencia, estatus, n_diferencias). Eso es un resumen
// OPERATIVO: sirve para revisar, no para importar. Ningún ERP lo asienta,
// porque no trae cuentas, ni cargos y abonos, ni desglose de IVA. La promesa
// de la landing era más grande que el archivo.
//
// ── LA REGLA QUE GOBIERNA ESTE MÓDULO ─────────────────────────────────────
// NINGUNA CUENTA SE INVENTA. El catálogo contable es de la flota y de su
// contador: `5010-001` en una empresa es diésel y en otra es otra cosa. Sin el
// catálogo declarado, este módulo NO produce una póliza a medias con cuentas
// plausibles — devuelve exactamente qué falta. Una póliza con la cuenta
// equivocada no se detecta al importarla: se detecta en la auditoría del año
// siguiente.
//
// ── Y LA SEGUNDA: LA PÓLIZA CUADRA O NO SALE ──────────────────────────────
// Suma de cargos = suma de abonos, al centavo. Un descuadre no se avisa: se
// niega. Ningún ERP acepta una póliza descuadrada, así que exportarla sería
// mandar al contador a pelear con un error que pudimos ver aquí.
// ═══════════════════════════════════════════════════════════════════════════
import type { ConceptoGasto } from '@/types/likida';

/** Las cuentas que la flota declara. Sin esto no hay póliza. */
export interface CatalogoContable {
  /** Cuenta de gasto por concepto. La que falte bloquea ese renglón. */
  gastos: Partial<Record<ConceptoGasto, string>>;
  /** IVA acreditable (el que el motor ya calculó y que el ERP separa). */
  ivaAcreditable?: string;
  /**
   * Impuesto trasladado que el motor de cuadre NO acreditó — IVA excluido por
   * regla fiscal (RFC ajeno, EFOS, combustible en efectivo, CFDI cancelado…) Y,
   * SIEMPRE, el IEPS trasladado de diésel: `engine.ts` deja `iepsAcreditable`
   * fijo en 0 porque la cuota LIF 20-A no es una cifra que este motor calcule,
   * así que TODO el IEPS de cada CFDI cae aquí, aunque el CFDI esté impecable.
   * Sigue siendo dinero que salió del anticipo; sin esta cuenta, la póliza
   * descuadra por exactamente ese monto (AUDITORÍA 21 ALTO, reincidente c19).
   */
  ivaNoAcreditable?: string;
  /** El anticipo entregado al operador: se cancela contra los comprobantes. */
  anticipoOperador?: string;
  /** Lo que el operador debe devolver (comprobó de menos). */
  porCobrarOperador?: string;
  /** Lo que se le debe al operador (puso de su bolsa). */
  porPagarOperador?: string;
}

export interface MovimientoPoliza {
  cuenta: string;
  /** En pesos. Uno de los dos es 0 — nunca los dos con valor. */
  cargo: number;
  abono: number;
  concepto: string;
  referencia: string;
}

export interface Poliza {
  fecha: string; // YYYY-MM-DD
  concepto: string;
  movimientos: MovimientoPoliza[];
}

/** Lo mínimo de una liquidación para asentarla. */
export interface LiquidacionParaPoliza {
  folioViaje: string;
  operador: string;
  fecha: string;
  anticipo: number;
  /** Gastos ya cuadrados, agrupados por concepto, SIN IVA. */
  porConcepto: Array<{ concepto: ConceptoGasto; subtotal: number }>;
  ivaAcreditable: number;
  /** anticipo − comprobado. Positivo: el operador devuelve. Negativo: se le debe. */
  diferencia: number;
}

export type ResultadoPoliza =
  | { ok: true; poliza: Poliza }
  | { ok: false; falta: string[] };

const REDONDEO = (n: number) => Math.round(n * 100) / 100;

/**
 * Arma la póliza de UNA liquidación. Devuelve qué falta en vez de adivinar.
 *
 * La forma del asiento es la de un gasto por comprobar, que es lo que es:
 *   CARGO   a cada cuenta de gasto, por su subtotal
 *   CARGO   a IVA acreditable
 *   ABONO   al anticipo entregado (se cancela)
 *   y el resto cuadra contra por-cobrar o por-pagar al operador.
 */
export function polizaDeLiquidacion(
  liq: LiquidacionParaPoliza,
  catalogo: CatalogoContable,
): ResultadoPoliza {
  const falta: string[] = [];
  const movimientos: MovimientoPoliza[] = [];
  const ref = liq.folioViaje;

  for (const g of liq.porConcepto) {
    if (g.subtotal === 0) continue;
    const cuenta = catalogo.gastos[g.concepto];
    if (!cuenta) {
      falta.push(`cuenta de gasto para «${g.concepto}»`);
      continue;
    }
    movimientos.push({
      cuenta,
      cargo: REDONDEO(g.subtotal),
      abono: 0,
      concepto: `${g.concepto} — viaje ${liq.folioViaje}`,
      referencia: ref,
    });
  }

  if (liq.ivaAcreditable > 0) {
    if (!catalogo.ivaAcreditable) falta.push('cuenta de IVA acreditable');
    else
      movimientos.push({
        cuenta: catalogo.ivaAcreditable,
        cargo: REDONDEO(liq.ivaAcreditable),
        abono: 0,
        concepto: `IVA acreditable — viaje ${liq.folioViaje}`,
        referencia: ref,
      });
  }

  // ── AUDITORÍA 21 (ALTO), reincidente de la 19 ────────────────────────────
  // `liq.diferencia` viene de `anticipo − comprobado`, y `comprobado`
  // (`totalComprobado` en engine.ts) suma `g.monto`: el TOTAL del CFDI, CON
  // impuesto. Los cargos de arriba solo llevan la BASE (`sub_total`, sin
  // impuesto) y el IVA que sí se acreditó. Si el motor decidió NO acreditar
  // algo de IVA (o hay IEPS, que este motor nunca acredita), ese impuesto
  // sigue siendo dinero que salió del anticipo y no tiene renglón — la
  // póliza descuadraba por exactamente ese monto. Se deriva `comprobado` de
  // los mismos datos que ya trae la liquidación (nunca se pide un campo
  // nuevo a la RPC: `anticipo − diferencia` es la misma identidad que usa
  // el motor) y el residuo contra base+IVA-acreditable es ese impuesto.
  const subtotalDeclarado = REDONDEO(liq.porConcepto.reduce((s, g) => s + g.subtotal, 0));
  const comprobado = REDONDEO(liq.anticipo - liq.diferencia);
  const impuestoNoAcreditado = REDONDEO(comprobado - subtotalDeclarado - liq.ivaAcreditable);
  if (impuestoNoAcreditado > 0.01) {
    if (!catalogo.ivaNoAcreditable) falta.push('cuenta de IVA/IEPS no acreditable');
    else
      movimientos.push({
        cuenta: catalogo.ivaNoAcreditable,
        cargo: impuestoNoAcreditado,
        abono: 0,
        concepto: `IVA/IEPS no acreditable — viaje ${liq.folioViaje}`,
        referencia: ref,
      });
  } else if (impuestoNoAcreditado < -0.01) {
    // No tiene sentido contable: el comprobado (con impuesto) saldría MENOR
    // que la base más el IVA que sí se acreditó — un dato de origen roto, no
    // un ajuste que se pueda inventar. Se bloquea para revisión, como manda
    // la regla del módulo.
    falta.push(
      `la póliza no cuadra: el comprobado (${comprobado.toFixed(2)}) es menor que la base más el IVA ` +
        `acreditable (${(subtotalDeclarado + liq.ivaAcreditable).toFixed(2)}) por ${Math.abs(impuestoNoAcreditado).toFixed(2)}. ` +
        'No se inventa un ajuste: revisar la liquidación a mano antes de exportar.',
    );
  }

  if (liq.anticipo > 0) {
    if (!catalogo.anticipoOperador) falta.push('cuenta de anticipo a operadores');
    else
      movimientos.push({
        cuenta: catalogo.anticipoOperador,
        cargo: 0,
        abono: REDONDEO(liq.anticipo),
        concepto: `Cancela anticipo de ${liq.operador}`,
        referencia: ref,
      });
  }

  // La diferencia cierra el asiento. Positiva = comprobó de MENOS, la debe.
  const dif = REDONDEO(liq.diferencia);
  if (Math.abs(dif) > 0.01) {
    const cuenta = dif > 0 ? catalogo.porCobrarOperador : catalogo.porPagarOperador;
    if (!cuenta) {
      falta.push(dif > 0 ? 'cuenta por cobrar a operadores' : 'cuenta por pagar a operadores');
    } else {
      movimientos.push({
        cuenta,
        cargo: dif > 0 ? Math.abs(dif) : 0,
        abono: dif > 0 ? 0 : Math.abs(dif),
        concepto:
          dif > 0
            ? `${liq.operador} devuelve del viaje ${liq.folioViaje}`
            : `Se le debe a ${liq.operador} del viaje ${liq.folioViaje}`,
        referencia: ref,
      });
    }
  }

  if (falta.length > 0) return { ok: false, falta: [...new Set(falta)] };

  // ── EL CUADRE ───────────────────────────────────────────────────────────
  // Se comprueba aquí y no en el ERP: un descuadre que llega al importador es
  // un error que el contador tiene que rastrear a ciegas.
  const cargos = REDONDEO(movimientos.reduce((s, m) => s + m.cargo, 0));
  const abonos = REDONDEO(movimientos.reduce((s, m) => s + m.abono, 0));
  if (Math.abs(cargos - abonos) > 0.01) {
    return {
      ok: false,
      falta: [
        `la póliza no cuadra: cargos ${cargos.toFixed(2)} vs abonos ${abonos.toFixed(2)}. ` +
          'No se exporta una póliza descuadrada: ningún ERP la acepta y el contador la rastrearía a ciegas.',
      ],
    };
  }

  return {
    ok: true,
    poliza: {
      fecha: liq.fecha,
      concepto: `Liquidación viaje ${liq.folioViaje} — ${liq.operador}`,
      movimientos,
    },
  };
}

