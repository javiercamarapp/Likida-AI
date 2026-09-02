import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './engine';
import { DEMO_CONFIG } from '../config';
import type { Gasto } from '@/types/likida';

// ═══════════════════════════════════════════════════════════════════════════
// FASE 7 (mig. 0199) — EL REP LIBERA EL IVA A CRÉDITO, Y SOLO EL REP.
//
// El motor excluía (bien) el IVA de un CFDI con FormaPago 99 citando LIVA
// 5-III, y su comentario prometía que se acreditaría "el mes en que se pague
// (con su complemento de pago)". La promesa no tenía código: el REP no se
// ingería y el IVA salía de la cuenta para siempre — 16% del gasto de diésel
// a crédito, cada mes.
//
// Las cuatro fronteras que este archivo fija:
//   1. SIN sello, TODO queda exactamente como antes (el REP solo abre).
//   2. Con sello del mismo mes, el IVA se libera sin ruido.
//   3. Con sello de OTRO mes, se libera Y la diferencia dice la verdad
//      fiscal: se asienta en el mes del pago, no en el del comprobante.
//   4. Las puertas de MEDIO (IEPS/peaje) usan la forma REAL del REP
//      (FormaDePagoP), nunca el sello a secas: "pagado" no implica
//      "pagado con un medio admitido".
// ═══════════════════════════════════════════════════════════════════════════

const g = (over: Partial<Gasto> = {}): Gasto => ({
  id: 'g1', viajeId: 'v1', concepto: 'hospedaje', monto: 1160,
  fecha: '2026-08-01',
  cfdiUuid: 'aa5cb2f5-3e2b-4c1a-9c1a-000000000007',
  rfcReceptor: 'GMX0902279I1',
  xmlVerificado: true,
  formaPago: '99', metodoPago: 'PPD',
  subTotal: 1000, ivaTraslado: 160,
  ...over,
} as Gasto);

const cuadre = (gasto: Gasto, extra: Record<string, unknown> = {}) => cuadrarViaje({
  viajeId: 'v1', anticipo: 3000, gastos: [gasto],
  politica: DEMO_CONFIG.politica, estimulos: DEMO_CONFIG.estimulos,
  hidrocarburos: DEMO_CONFIG.hidrocarburos,
  empresaRfc: 'GMX0902279I1', hoy: '2026-08-05',
  ...extra,
});

describe('el REP libera el IVA a crédito — y solo el REP', () => {
  it('CONTROL: FormaPago 99 sin sello → el IVA sigue excluido, igual que siempre', () => {
    const r = cuadre(g());
    expect(r.ivaAcreditable).toBe(0);
    expect((r.diferencias ?? []).some((d) => d.tipo === 'iva_mes_del_pago')).toBe(false);
  });

  it('con el sello del REP en el MISMO mes, el IVA se libera sin nota de periodo', () => {
    const r = cuadre(g({ pagadoEn: '2026-08-03', pagadoForma: '03' }));
    expect(r.ivaAcreditable).toBe(160);
    expect((r.diferencias ?? []).some((d) => d.tipo === 'iva_mes_del_pago')).toBe(false);
  });

  it('con el sello de OTRO mes, se libera Y la diferencia dice el mes del pago', () => {
    const r = cuadre(g({ pagadoEn: '2026-09-02', pagadoForma: '03' }));
    expect(r.ivaAcreditable).toBe(160);
    const nota = (r.diferencias ?? []).find((d) => d.tipo === 'iva_mes_del_pago');
    expect(nota).toBeDefined();
    expect(nota!.nota).toContain('2026-09-02');
    expect(nota!.nota).toContain('LIVA 5-III');
    expect(nota!.monto).toBe(0); // informativa: no mueve dinero del cuadre
  });

  it('REGRESIÓN: un gasto normal (forma 03, sin REP) no cambia en nada', () => {
    const r = cuadre(g({ formaPago: '03', metodoPago: 'PUE', pagadoEn: undefined, pagadoForma: undefined }));
    expect(r.ivaAcreditable).toBe(160);
    expect((r.diferencias ?? []).some((d) => d.tipo === 'iva_mes_del_pago')).toBe(false);
  });

  it('el sello en un gasto que NO era 99 no dispara la maquinaria del REP', () => {
    // Defensivo: si algún día un backfill sella un PUE ya pagado, el motor no
    // debe duplicar avisos ni cambiar un acreditamiento que ya estaba bien.
    const r = cuadre(g({ formaPago: '03', pagadoEn: '2026-09-02' }));
    expect(r.ivaAcreditable).toBe(160);
    expect((r.diferencias ?? []).some((d) => d.tipo === 'iva_mes_del_pago')).toBe(false);
  });
});

describe('las puertas de MEDIO usan la forma real del REP', () => {
  const caseta = (over: Partial<Gasto> = {}): Gasto => g({
    concepto: 'caseta', claveProdServ: '95111603', subTotal: 500, ivaTraslado: 80, monto: 580,
    ...over,
  });

  it('caseta a crédito sin REP: sin estímulo (control)', () => {
    const r = cuadre(caseta(), { elegiblePeaje: true });
    expect(r.peajeAcreditable ?? 0).toBe(0);
  });

  it('caseta liquidada por REP con transferencia (03): el 50% se acredita', () => {
    const r = cuadre(caseta({ pagadoEn: '2026-08-03', pagadoForma: '03' }), { elegiblePeaje: true });
    expect(r.peajeAcreditable).toBe(250); // 500 × 0.5
  });

  it('caseta liquidada por REP SIN FormaDePagoP legible: pagado ≠ medio admitido — sin estímulo', () => {
    const r = cuadre(caseta({ pagadoEn: '2026-08-03', pagadoForma: undefined }), { elegiblePeaje: true });
    expect(r.peajeAcreditable ?? 0).toBe(0);
    // Pero su IVA SÍ se libera: LIVA 5-III solo exige el pago efectivo.
    expect(r.ivaAcreditable).toBe(80);
  });

  it('caseta liquidada por REP en EFECTIVO (01): el pago existe, el estímulo no', () => {
    const r = cuadre(caseta({ pagadoEn: '2026-08-03', pagadoForma: '01' }), { elegiblePeaje: true });
    expect(r.peajeAcreditable ?? 0).toBe(0);
    expect(r.ivaAcreditable).toBe(80);
  });
});
