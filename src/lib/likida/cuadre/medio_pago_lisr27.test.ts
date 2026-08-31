// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 22 · FIS-C3 (CRÍTICO) — la lista de la LISR 27-III es CERRADA.
//
// El motor ya tenía escrita la lista (`MEDIOS_LISR_27_III`, engine.ts:126) y la
// usaba SOLO para combustible (`medioNoAdmitidoCombustible`, arreglo de la
// auditoría 18). Para todo lo demás la frontera seguía siendo «¿es '01'?».
//
// Norma (`normas/lisr-27-III.yaml`): «los pagos cuyo monto exceda de $2,000.00
// se efectúen mediante transferencia electrónica de fondos…; cheque nominativo…,
// tarjeta de crédito, de débito, de servicios, o los denominados monederos
// electrónicos autorizados por el SAT». Es una lista, no un "todo menos
// efectivo".
//
// Entra: hospedaje de $58,000 con `FormaPago '06' Dinero electrónico`, CFDI
// verificado y vigente. Salía: «Deducible para ISR $58,000» en verde, «IVA
// acreditable $8,000», CERO diferencias y estatus `cuadrada`.
//
// POR QUÉ `por_confirmar` Y NO `no_deducible`: '06' y '08' no están en la lista,
// pero '12' dación en pago, '17' compensación y '23' novación son formas de
// EXTINGUIR una obligación y hay criterio en disputa sobre si les aplica el
// requisito. La propia ficha advierte contra citar la fracción sola para negar
// una deducción. El tercer estado es el que el módulo ya usa para eso: ni se
// afirma deducible ni se afirma perdido, lo confirma una persona — y mientras
// tanto no acredita IVA (LIVA 5-I: la proporción deducible es cero).
//
// `'01'` NO cambia: sigue cayendo en `efectivo_sobre_tope`, no deducible.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cuadrarViaje, cubetaDe, MEDIOS_LISR_27_III, type PoliticaGasto } from './engine';
import type { Gasto } from '@/types/likida';

const politica: PoliticaGasto[] = [{ concepto: 'hospedaje', topeMonto: 100_000 }];
const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: [] };

// $58,000 = SubTotal $50,000 + IVA $8,000. Muy por encima del tope de $2,000.
const gastoCon = (formaPago: string): Gasto => ({
  id: 'g1', concepto: 'hospedaje', monto: 58_000, folio: 'A1', fecha: '2026-05-01',
  ocrConfianza: 0.95, cfdiUuid: 'u-g1', xmlVerificado: true, rfcReceptor: 'REC010101AA1',
  formaPago, ivaTraslado: 8_000, subTotal: 50_000,
});

const cuadra = (formaPago: string) =>
  cuadrarViaje({ viajeId: 'v1', anticipo: 58_000, politica, estimulos: EST, gastos: [gastoCon(formaPago)] });

describe('FIS-C3: el tope de $2,000 se mide contra la lista cerrada, no contra «¿es 01?»', () => {
  // Lo que rompía: las tres salían deducibles al 100% con su IVA y sin una sola
  // diferencia. `'99 Por definir'` entra por el mismo hueco.
  it.each(['06', '08', '12', '17', '23', '99'])(
    'FormaPago %s sobre el tope: ni deducible en verde ni IVA acreditado',
    (forma) => {
      const r = cuadra(forma);
      const d = r.diferencias.find((x) => x.tipo === 'medio_pago_no_admitido');
      expect(d, `FormaPago ${forma} no levantó ninguna diferencia`).toBeDefined();
      expect(cubetaDe(gastoCon(forma), r.diferencias.filter((x) => x.gastoId === 'g1'))).toBe('por_confirmar');
      expect(r.totalDeducible).toBe(0);
      expect(r.totalPorConfirmar).toBe(58_000);
      expect(r.ivaAcreditable).toBe(0);
      expect(r.estatus).toBe('revisar');
    },
  );

  it.each([...MEDIOS_LISR_27_III])('FormaPago %s SÍ está en la lista: deducible con su IVA', (forma) => {
    const r = cuadra(forma);
    expect(r.diferencias.some((x) => x.tipo === 'medio_pago_no_admitido')).toBe(false);
    expect(r.totalDeducible).toBe(58_000);
    expect(r.ivaAcreditable).toBe(8_000);
  });

  it('«01» efectivo NO cambia de trato: sigue siendo efectivo_sobre_tope y no deducible', () => {
    const r = cuadra('01');
    expect(r.diferencias.some((x) => x.tipo === 'efectivo_sobre_tope')).toBe(true);
    expect(r.diferencias.some((x) => x.tipo === 'medio_pago_no_admitido')).toBe(false);
    expect(r.totalNoDeducible).toBe(58_000);
    expect(r.ivaAcreditable).toBe(0);
  });

  it('por DEBAJO del tope de $2,000 la fracción no aplica: un medio raro no levanta nada', () => {
    const chico: Gasto = { ...gastoCon('06'), monto: 1_500, ivaTraslado: 206.9, subTotal: 1_293.1 };
    const r = cuadrarViaje({ viajeId: 'v2', anticipo: 1_500, politica, estimulos: EST, gastos: [chico] });
    expect(r.diferencias.some((x) => x.tipo === 'medio_pago_no_admitido')).toBe(false);
    expect(r.totalDeducible).toBe(1_500);
  });

  it('sin `formaPago` no se inventa un veredicto: desconocido no es «medio distinto»', () => {
    const sinForma: Gasto = { ...gastoCon('06'), formaPago: undefined };
    const r = cuadrarViaje({ viajeId: 'v3', anticipo: 58_000, politica, estimulos: EST, gastos: [sinForma] });
    expect(r.diferencias.some((x) => x.tipo === 'medio_pago_no_admitido')).toBe(false);
  });
});
