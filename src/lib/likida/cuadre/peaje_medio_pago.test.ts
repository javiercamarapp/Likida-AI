// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 2 (fiscal) — el estímulo de PEAJE exige pago electrónico.
//
// El 50% acreditable de casetas (LIF 1.6 / acreditable.ts) solo aplica con pago
// electrónico. El motor lo afirmaba SIN mirar la forma de pago — igual que ya
// pasaba con diésel e IVA. Un '99' (Por definir = no pagado, RMF 2.7.1.29 fr. II)
// o el efectivo NO acreditan. Se prueba `peajeAcreditable` como SALIDA del motor.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cuadrarViaje, type PoliticaGasto } from './engine';
import type { Gasto } from '@/types/likida';

const politica: PoliticaGasto[] = [{ concepto: 'caseta', topeMonto: 10000 }];
const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: [] };

/** Una caseta con SubTotal $1,000 y CFDI verificado. Solo cambia la forma de pago. */
const caseta = (formaPago: string | undefined): Gasto => ({
  id: 'g1', concepto: 'caseta', monto: 1160, subTotal: 1000, folio: 'C1', fecha: '2026-05-01',
  ocrConfianza: 0.95, cfdiUuid: 'u1', xmlVerificado: true, rfcReceptor: 'REC010101AA1',
  tipoComprobante: 'I',
  ...(formaPago ? { formaPago } : {}),
});

const peajeDe = (g: Gasto) =>
  cuadrarViaje({ viajeId: 'v1', anticipo: 1160, politica, estimulos: EST, gastos: [g] }).peajeAcreditable;

// ═══════════════════════════════════════════════════════════════════════════
// FASE 3 (perfil/preguntas.ts, calificaEstimuloPeaje) — el estímulo también
// exige ingresos < $300M y no ser parte relacionada (LIF 2026 art. 20-A,
// normas/lif-2026-20-A.yaml hallazgo H6). Antes de esta fase el motor no
// conocía ninguno de los dos y lo aplicaba sin condición.
// ═══════════════════════════════════════════════════════════════════════════
describe('FASE 3 — elegiblePeaje: el perfil puede apagar el estímulo, nunca inventarlo', () => {
  const peajeConElegibilidad = (elegiblePeaje: boolean | undefined) =>
    cuadrarViaje({ viajeId: 'v1', anticipo: 1160, politica, estimulos: EST, gastos: [caseta('03')], elegiblePeaje }).peajeAcreditable;

  it('sin declarar (undefined) → se sigue acreditando, conducta de siempre (fail-open con aviso)', () => {
    expect(peajeConElegibilidad(undefined)).toBe(500);
  });

  it('perfil confirma que SÍ califica (true) → se acredita igual', () => {
    expect(peajeConElegibilidad(true)).toBe(500);
  });

  it('perfil confirma que NO califica (ingresos ≥ $300M o parte relacionada) → 0, no solo un aviso', () => {
    expect(peajeConElegibilidad(false)).toBe(0);
  });
});

describe('Estímulo de peaje exige pago electrónico', () => {
  it('forma de pago 99 (Por definir / no pagado) → 0 peaje acreditable', () => {
    expect(peajeDe(caseta('99'))).toBe(0);
  });

  it('efectivo (01) → 0: el estímulo pide medio electrónico, no solo "pagado"', () => {
    expect(peajeDe(caseta('01'))).toBe(0);
  });

  it('sin forma de pago → 0 (no se afirma lo que no se pudo verificar)', () => {
    expect(peajeDe(caseta(undefined))).toBe(0);
  });

  it('transferencia (03) → 50% del SubTotal', () => {
    expect(peajeDe(caseta('03'))).toBe(500); // 1000 * 0.5
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18, A7 — "electrónico" es la lista cerrada de la RMF 2026 9.1.8
// fr. III ("tarjeta de identificación automática vehicular o cualquier otro
// sistema electrónico de pago con que cuente la autopista"), no "todo lo que no
// sea efectivo". La puerta anterior (`!== '01' && !== '99'`) dejaba pasar el
// cheque, la dación en pago, la compensación y la novación.
// ═══════════════════════════════════════════════════════════════════════════
describe('A7: solo los medios electrónicos de la RMF 9.1.8 fr. III acreditan peaje', () => {
  it.each([
    ['02', 'cheque nominativo: no es un sistema electrónico de la autopista'],
    ['12', 'dación en pago'],
    ['17', 'compensación'],
    ['23', 'novación'],
    ['08', 'vales de despensa'],
  ])('forma de pago %s (%s) → 0', (forma) => {
    expect(peajeDe(caseta(forma))).toBe(0);
  });

  it.each([['04', 'tarjeta de crédito'], ['05', 'monedero electrónico'], ['06', 'dinero electrónico'], ['28', 'tarjeta de débito'], ['29', 'tarjeta de servicios']])(
    'forma de pago %s (%s) → 50% del SubTotal', (forma) => {
      expect(peajeDe(caseta(forma))).toBe(500);
    },
  );
});
