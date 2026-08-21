// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 2 · CRÍTICO (fiscal) — el IVA acreditable no comprobaba pago.
//
// LIVA 5-III: el IVA trasladado se acredita solo si está "efectivamente pagado
// en el mes". Un CFDI con forma de pago '99' (Por definir — la contraprestación
// no se ha pagado, RMF 2.7.1.29 fr. II) trae IVA trasladado pero NO acreditable
// aún. El motor ya excluye el estímulo de peaje y de diésel por forma de pago,
// pero el IVA —la cifra que sale en CASI TODA liquidación— se acreditaba sin
// mirarla. Un contador lo rechaza en la primera revisión.
//
// Se prueba con el motor REAL (`cuadrarViaje`), afirmando `ivaAcreditable` como
// SALIDA — sin esta prueba, revertir el candado no rompía nada.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cuadrarViaje, type PoliticaGasto } from './engine';
import type { Gasto } from '@/types/likida';

const politica: PoliticaGasto[] = [{ concepto: 'hospedaje', topeMonto: 10000 }];
const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: [] };

/** Un hospedaje con CFDI verificado e IVA trasladado de $160. Solo cambia el pago. */
const gasto = (formaPago: string | undefined): Gasto => ({
  id: 'g1', concepto: 'hospedaje', monto: 1160, subTotal: 1000, folio: 'H1', fecha: '2026-05-01',
  ocrConfianza: 0.95, cfdiUuid: 'u1', xmlVerificado: true, rfcReceptor: 'REC010101AA1',
  tipoComprobante: 'I', ivaTraslado: 160,
  ...(formaPago ? { formaPago } : {}),
});

const ivaDe = (g: Gasto) =>
  cuadrarViaje({ viajeId: 'v1', anticipo: 1160, politica, estimulos: EST, gastos: [g] }).ivaAcreditable;

describe('IVA acreditable exige pago efectivo (LIVA 5-III)', () => {
  it('forma de pago 99 (Por definir / no pagado) → NO acredita el IVA', () => {
    expect(ivaDe(gasto('99'))).toBe(0);
  });

  it('forma de pago pagada (03, transferencia) → SÍ acredita el IVA', () => {
    expect(ivaDe(gasto('03'))).toBeGreaterThan(0);
  });

  it('pago en efectivo (01) también acredita — el efectivo SÍ es pago para IVA', () => {
    // A diferencia del estímulo de diésel/peaje (que exige medio electrónico),
    // el IVA solo pide que esté PAGADO; el efectivo lo está.
    expect(ivaDe(gasto('01'))).toBeGreaterThan(0);
  });
});
