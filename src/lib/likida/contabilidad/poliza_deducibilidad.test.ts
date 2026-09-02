// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 22 · FIS-C1 (CRÍTICO) — la póliza no sabía qué era deducible.
//
// `LiquidacionParaPoliza` no tenía UN SOLO campo de deducibilidad:
// `porConcepto` era `{concepto, subtotal}` y punto. Así que TODO gasto se
// cargaba a `catalogo.gastos[concepto]` —la cuenta de gasto DEDUCIBLE de la
// flota— aunque el motor lo hubiera marcado `combustible_efectivo`,
// `cfdi_efos` o `efectivo_sobre_tope`.
//
// El resultado: el PDF de la misma liquidación imprime «No deducible $58,000»
// y el archivo que el contador importa a CONTPAQi lo asienta como deducible.
// Dos artefactos del mismo cálculo diciendo cosas contrarias — que es
// exactamente lo que la regla del formato de cifras existe para impedir.
//
// Y era una REGRESIÓN reciente: antes de `010a7f5` estos casos descuadraban y
// el periodo entero se negaba con 409. El renglón residual de IVA/IEPS no
// acreditado que ese arreglo introdujo los volvió exportables — absorbía la
// base no deducible como si fuera impuesto.
//
// La regla del módulo manda el resto: NINGUNA CUENTA SE INVENTA. Si hay gasto
// no deducible y la flota no declaró dónde asentarlo, no se elige una cuenta
// plausible: se dice qué falta.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { polizaDeLiquidacion, type CatalogoContable, type LiquidacionParaPoliza } from './poliza';

const CATALOGO: CatalogoContable = {
  gastos: { diesel: '5010-001', caseta: '5010-002', hospedaje: '5010-004' },
  ivaAcreditable: '1180-001',
  ivaNoAcreditable: '1180-002',
  gastoNoDeducible: '5990-001',
  gastoPorConfirmar: '5990-002',
  retencionesPorPagar: '2015-001',
  anticipoOperador: '1190-001',
  porCobrarOperador: '1190-002',
  porPagarOperador: '2010-001',
};

const cuentasDe = (movs: Array<{ cuenta: string; cargo: number }>) =>
  Object.fromEntries(movs.filter((m) => m.cargo > 0).map((m) => [m.cuenta, m.cargo]));

// Anticipo 10,000. Diésel deducible 3,000 + hospedaje NO deducible 5,000
// (efectivo sobre el tope: sin IVA acreditable). Comprobado 8,000, devuelve 2,000.
const CON_NO_DEDUCIBLE: LiquidacionParaPoliza = {
  folioViaje: 'VJ-2026-0042',
  operador: 'Juan Pérez',
  fecha: '2026-08-20',
  anticipo: 10_000,
  porConcepto: [
    { concepto: 'diesel', subtotal: 3000 },
    { concepto: 'hospedaje', subtotal: 0, subtotalNoDeducible: 5000 },
  ],
  ivaAcreditable: 0,
  diferencia: 2000, // 10,000 − 8,000
};

describe('FIS-C1: lo no deducible NO se asienta en la cuenta de gasto deducible', () => {
  it('el hospedaje no deducible va a su propia cuenta, no a 5010-004', () => {
    const r = polizaDeLiquidacion(CON_NO_DEDUCIBLE, CATALOGO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = cuentasDe(r.poliza.movimientos);
    // Lo que rompía: 5010-004 cargaba los $5,000 como gasto deducible.
    expect(c['5010-004']).toBeUndefined();
    expect(c['5990-001']).toBe(5000);
    expect(c['5010-001']).toBe(3000); // el diésel deducible no se toca
  });

  it('el asiento sigue cuadrando al centavo', () => {
    const r = polizaDeLiquidacion(CON_NO_DEDUCIBLE, CATALOGO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cargos = r.poliza.movimientos.reduce((s, m) => s + m.cargo, 0);
    const abonos = r.poliza.movimientos.reduce((s, m) => s + m.abono, 0);
    expect(cargos).toBeCloseTo(abonos, 2);
    expect(cargos).toBeCloseTo(10_000, 2);
  });

  it('el «por confirmar» tampoco se mezcla con lo deducible: es un tercer estado', () => {
    const r = polizaDeLiquidacion(
      {
        ...CON_NO_DEDUCIBLE,
        porConcepto: [
          { concepto: 'diesel', subtotal: 3000 },
          { concepto: 'hospedaje', subtotal: 0, subtotalPorConfirmar: 5000 },
        ],
      },
      CATALOGO,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = cuentasDe(r.poliza.movimientos);
    expect(c['5010-004']).toBeUndefined();
    expect(c['5990-002']).toBe(5000);
  });

  // NINGUNA CUENTA SE INVENTA — la regla que gobierna el módulo entero.
  it('sin cuenta declarada para lo no deducible, se NIEGA y se dice qué falta', () => {
    const { gastoNoDeducible: _omitida, ...sinCuenta } = CATALOGO;
    const r = polizaDeLiquidacion(CON_NO_DEDUCIBLE, sinCuenta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.falta.join(' ')).toContain('no deducible');
    // No cae al genérico «la póliza no cuadra»: dice exactamente qué capturar.
    expect(r.falta.join(' ')).not.toContain('revisar la liquidación a mano');
  });

  it('una liquidación 100% deducible no exige la cuenta nueva (nadie se rompe)', () => {
    const { gastoNoDeducible: _a, gastoPorConfirmar: _b, ...sinCuentas } = CATALOGO;
    const r = polizaDeLiquidacion(
      { ...CON_NO_DEDUCIBLE, porConcepto: [{ concepto: 'diesel', subtotal: 8000 }] },
      sinCuentas,
    );
    expect(r.ok).toBe(true);
  });

  it('el residuo de impuesto no se traga la base no deducible', () => {
    // El renglón `ivaNoAcreditable` se deriva de `comprobado − base − IVA
    // acreditable`. Si la base no deducible no contara como base, esos $5,000
    // aparecerían como «IVA/IEPS no acreditable» — un impuesto que no existe.
    const r = polizaDeLiquidacion(CON_NO_DEDUCIBLE, CATALOGO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = cuentasDe(r.poliza.movimientos);
    expect(c['1180-002']).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 22 · FIS-A1 (ALTO) — el residuo derivado por resta se envenenaba.
//
// El módulo deriva el impuesto no acreditado de una identidad
// (`comprobado − base − IVA acreditable`) en vez de leerlo del comprobante, así
// que cualquier término del CFDI que no sea SubTotal ni traslado la envenena.
// Dos ocurren a diario y los dos daban residuo NEGATIVO, que el módulo lee como
// «dato de origen roto» y que en la ruta HTTP tira el periodo ENTERO con 409:
//
//   A) `@Descuento` — factura de casetas con descuento del emisor.
//   B) RETENCIÓN de IVA — flete subcontratado a un permisionario persona
//      física, lo normal en carga federal. Ahí el bloqueo es permanente.
//
// El reverso era peor que el 409: si en el mismo periodo había IVA no
// acreditado que compensara la retención, el residuo cuadraba y el IVA retenido
// —que es cuenta POR PAGAR al SAT— desaparecía del asiento sin renglón.
// ═══════════════════════════════════════════════════════════════════════════
describe('FIS-A1: descuento y retención dejan de leerse como dato roto', () => {
  it('un flete con retención de IVA sale, y la retención va como ABONO por pagar', () => {
    // SubTotal 10,000 · IVA 1,600 · retención 4% = 400 · Total 11,200.
    const r = polizaDeLiquidacion(
      {
        folioViaje: 'VJ-RET', operador: 'Ana', fecha: '2026-08-20',
        anticipo: 11_200,
        porConcepto: [{ concepto: 'flete', subtotal: 10_000 }],
        ivaAcreditable: 1_600,
        retenciones: 400,
        diferencia: 0,
      },
      { ...CATALOGO, gastos: { flete: '5010-005' } },
    );
    // Lo que rompía: `ok:false` con «la póliza no cuadra… por 400.00».
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const abono = r.poliza.movimientos.find((m) => m.cuenta === '2015-001');
    expect(abono?.abono).toBe(400);
    const cargos = r.poliza.movimientos.reduce((s, m) => s + m.cargo, 0);
    const abonos = r.poliza.movimientos.reduce((s, m) => s + m.abono, 0);
    expect(cargos).toBeCloseTo(abonos, 2);
  });

  it('sin cuenta de retenciones declarada se dice qué falta, no «dato roto»', () => {
    const { retencionesPorPagar: _sin, ...cat } = { ...CATALOGO, gastos: { flete: '5010-005' } };
    const r = polizaDeLiquidacion(
      {
        folioViaje: 'VJ-RET2', operador: 'Ana', fecha: '2026-08-20',
        anticipo: 11_200, porConcepto: [{ concepto: 'flete', subtotal: 10_000 }],
        ivaAcreditable: 1_600, retenciones: 400, diferencia: 0,
      },
      cat,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.falta.join(' ')).toContain('retenciones por pagar');
    expect(r.falta.join(' ')).not.toContain('revisar la liquidación a mano');
  });
});
