// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 22 · FIS-C2 (CRÍTICO) — la RFA 2.9 niega el IEPS, no el IVA.
//
// `SIN_ACREDITAMIENTO` era UNA lista para DOS preguntas distintas: «¿acredita
// IVA?» y «¿acredita el estímulo de diésel/peaje?». Los dos tipos de la RFA 2.9
// entraron para cerrar la segunda y cerraron las dos.
//
// Lo que dicen las fichas, leídas:
//   · `rfa-2026-2.9.yaml` → `limite_importante`: «Conserva la DEDUCCIÓN para
//     ISR. NO habilita el acreditamiento del IEPS». Dice IEPS. NO dice IVA.
//   · `liva-5.yaml` art. 5 fr. I: «se consideran estrictamente indispensables
//     las erogaciones… que sean deducibles para los fines del impuesto sobre la
//     renta», y las parcialmente deducibles acreditan «en la proporción en la
//     que dichas erogaciones sean deducibles».
//
// O sea: si el motor declara el combustible deducible al 100% por la facilidad
// del 15%, su IVA se acredita al 100%. Y si lo declara deducible al 75% (el
// excedente del 15%), su IVA se acredita al 75% — la maquinaria ya existe,
// `proporcionDeducible` se calcula en engine.ts:536 y el `continue` la saltaba.
//
// Lo que rompía: el MISMO CFDI perdía todo su IVA solo por el medio de pago,
// bajo un rótulo que dice «IVA acreditable (LIVA art. 5)». Una flota con
// $5,000,000 anuales de combustible y su 15% en efectivo perdía ~$103,000 al
// año que la ley le concede.
//
// Lo que NO cambia: los litros del estímulo de diésel siguen en cero. Eso sí lo
// niega la RFA 2.9 con todas sus letras, y es la mitad que la lista sí protegía.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cuadrarViaje, type PoliticaGasto } from './engine';
import type { Gasto } from '@/types/likida';

const politica: PoliticaGasto[] = [{ concepto: 'diesel', topeMonto: 1_000_000 }];
const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: ['15101505'] };

// $116,000 = SubTotal $100,000 + IVA $16,000.
const diesel = (formaPago: string): Gasto => ({
  id: 'g1', concepto: 'diesel', monto: 116_000, folio: 'F1', fecha: '2026-05-01', ocrConfianza: 0.95,
  cfdiUuid: 'u-g1', xmlVerificado: true, rfcReceptor: 'REC010101AA1', formaPago,
  ivaTraslado: 16_000, subTotal: 100_000, claveProdServ: '15101505', ocrExtra: { litros: 4_300 },
});

// Ejercicio de $5,000,000: el 15% son $750,000 de cupo. $116,000 cabe de sobra.
const dentroDel15 = (formaPago: string) =>
  cuadrarViaje({
    viajeId: 'v1', anticipo: 116_000, politica, estimulos: EST,
    facilidad15: true, anioEjercicio: '2026', totalCombustibleEjercicio: 5_000_000, efectivoPrevEjercicio: 0,
    gastos: [diesel(formaPago)],
  });

describe('FIS-C2: la facilidad del 15% conserva el IVA acreditable (LIVA 5-I)', () => {
  it('diésel en efectivo DENTRO del 15%: deducible al 100% ⇒ IVA acreditable al 100%', () => {
    const r = dentroDel15('01');
    expect(r.diferencias.some((d) => d.tipo === 'combustible_efectivo_dentro15')).toBe(true);
    expect(r.totalDeducible).toBe(116_000);
    // Lo que rompía: $0, con el mismo comprobante que por transferencia acredita $16,000.
    expect(r.ivaAcreditable).toBe(16_000);
    // Y lo que la RFA 2.9 SÍ niega sigue negado: el estímulo del IEPS.
    expect(r.litrosDieselAcreditables).toBe(0);
  });

  it('el medio de pago ya no cambia el IVA cuando la deducción es la misma', () => {
    expect(dentroDel15('01').ivaAcreditable).toBe(dentroDel15('03').ivaAcreditable);
  });

  it('el efectivo NO elegible (la flota no califica) sigue sin acreditar IVA: ahí no hay deducción', () => {
    const r = cuadrarViaje({
      viajeId: 'v2', anticipo: 116_000, politica, estimulos: EST,
      facilidad15: false, anioEjercicio: '2026', totalCombustibleEjercicio: 5_000_000, efectivoPrevEjercicio: 0,
      gastos: [diesel('01')],
    });
    expect(r.diferencias.some((d) => d.tipo === 'efectivo_no_elegible')).toBe(true);
    expect(r.totalDeducible).toBe(0);
    expect(r.ivaAcreditable).toBe(0);
  });
});

describe('FIS-C2b: sobre el 15%, el IVA se acredita EN PROPORCIÓN, no todo o nada', () => {
  // $200,000 de efectivo contra un ejercicio de $1,000,000: el cupo es $150,000,
  // así que 3/4 del comprobante es deducible. LIVA 5-I: 3/4 del IVA.
  const soloDiesel: Gasto = {
    id: 'g1', concepto: 'diesel', monto: 200_000, folio: 'F1', fecha: '2026-05-01', ocrConfianza: 0.95,
    cfdiUuid: 'u-g1', xmlVerificado: true, rfcReceptor: 'REC010101AA1', formaPago: '01',
    ivaTraslado: 32_000, subTotal: 168_000, claveProdServ: '15101505', ocrExtra: { litros: 4_300 },
  };
  const r = cuadrarViaje({
    viajeId: 'v3', anticipo: 200_000, politica, estimulos: EST,
    facilidad15: true, anioEjercicio: '2026', totalCombustibleEjercicio: 1_000_000, efectivoPrevEjercicio: 0,
    gastos: [soloDiesel],
  });

  it('deducible $150,000 de $200,000 ⇒ se acredita el 75% del IVA', () => {
    expect(r.diferencias.some((d) => d.tipo === 'efectivo_sobre_15')).toBe(true);
    expect(r.totalDeducible).toBe(150_000);
    // Lo que rompía: $0 acreditado sobre una erogación deducible en 3/4 partes.
    expect(r.ivaAcreditable).toBe(24_000);
    expect(r.litrosDieselAcreditables).toBe(0);
  });
});
