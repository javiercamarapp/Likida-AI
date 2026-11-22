// ═══════════════════════════════════════════════════════════════════════════
// A58-DAT-01 [CRÍTICO] — EL ESTÍMULO DE PEAJE SE ACREDITABA SOBRE UN SUBTOTAL
// QUE NADIE COTEJABA CONTRA EL TOTAL DEL MISMO COMPROBANTE.
//
// `intake/ocr.ts:57` declara `subtotal: z.number().finite().nullable()` — sin
// `.max()` y sin relación con `monto` — y la base solo pide `sub_total >= 0` y
// `descuento <= sub_total` (0281:44 y :57): ninguna de las dos mira `monto`. Un
// recibo de TAG imprime también el SALDO de la tarjeta, así que el modelo podía
// leer `12,450.00` de saldo como subtotal de una caseta de `$184.00`, y el motor
// acreditaba `12450 × 0.5 = 6,225.00` en el renglón «Estímulo de peaje 50% (LIF
// 2026 art. 20, ap. A)» del PDF: 34× la caseta real. Después la póliza se
// bloquea sola (`contabilidad/poliza.ts:249`) y, con la liquidación ya emitida,
// `0283` vuelve ese `sub_total` inmutable.
//
// El cotejo ya existía para la columna GEMELA: `engine.ts:2029-2047` cruza los
// litros del OCR contra `monto ÷ precioRef` desde la AUDITORÍA 8 por este mismo
// motivo («un decimal corrido acreditaba cien veces el estímulo real, y es justo
// el número que el contador multiplica»). Para `subTotal` nunca se escribió.
//
// La tolerancia suma las RETENCIONES a propósito: en un CFDI el total es
// `subtotal − descuento + traslados − retenciones`, así que un comprobante con
// retención legítima puede traer `subTotal > monto` sin estar mal leído.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cuadrarViaje, type PoliticaGasto } from './engine';
import type { Gasto } from '@/types/likida';

const politica: PoliticaGasto[] = [{ concepto: 'caseta', topeMonto: 100000 }];
const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: [] };

const caseta = (extra: Partial<Gasto>): Gasto => ({
  id: 'g1', concepto: 'caseta', monto: 1160, subTotal: 1000, folio: 'C1', fecha: '2026-05-01',
  ocrConfianza: 0.95, cfdiUuid: 'u1', xmlVerificado: true, rfcReceptor: 'REC010101AA1',
  tipoComprobante: 'I', formaPago: '04',
  ...extra,
});

const cuadre = (g: Gasto) =>
  cuadrarViaje({ viajeId: 'v1', anticipo: 20000, politica, estimulos: EST, gastos: [g], elegiblePeaje: true });

describe('A58-DAT-01 — el subtotal del peaje se coteja contra el total del comprobante', () => {
  it('el SALDO del TAG leído como subtotal ($12,450 sobre una caseta de $184) NO acredita estímulo', () => {
    const r = cuadre(caseta({ monto: 184, subTotal: 12450 }));
    // Sin el cotejo: 12450 × 0.5 = 6225 impresos como estímulo fiscal.
    expect(r.peajeAcreditable).toBe(0);
  });

  it('y lo DICE: deja una diferencia que nombra las dos cifras, no se calla', () => {
    const r = cuadre(caseta({ monto: 184, subTotal: 12450 }));
    const d = r.diferencias.find((x) => x.gastoId === 'g1' && /12,450|12450/.test(x.nota ?? ''));
    expect(d, 'una base mayor que el total tiene que salir en diferencias').toBeTruthy();
    expect(d?.nota).toMatch(/184/);
  });

  it('el camino legítimo sigue acreditando: subtotal $1,000 bajo un total de $1,160 → $500', () => {
    expect(cuadre(caseta({})).peajeAcreditable).toBe(500);
  });

  it('un subtotal IGUAL al total (caseta sin IVA desglosado) sigue acreditando', () => {
    expect(cuadre(caseta({ monto: 1000, subTotal: 1000 })).peajeAcreditable).toBe(500);
  });

  it('una RETENCIÓN legítima que deja el total bajo el subtotal NO se confunde con un error de lectura', () => {
    // total 960 = subtotal 1000 − 40 de ISR retenido: el papel está bien.
    expect(cuadre(caseta({ monto: 960, subTotal: 1000, isrRetenido: 40 })).peajeAcreditable).toBe(500);
  });

  it('el descuento se resta ANTES del cotejo: base $900 bajo un total de $1,044 acredita $450', () => {
    expect(cuadre(caseta({ monto: 1044, subTotal: 1000, descuento: 100 })).peajeAcreditable).toBe(450);
  });
});
