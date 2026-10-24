import { describe, expect, it } from 'vitest';
import { cplAgregado } from './cpl';

describe('A37-S06-04: CPL solo agregado, nunca repartido por campaña', () => {
  it('Meta 300/20 leads + Google 700/10 leads = 1000/30, no 10 y 23 por campaña', () => {
    const r = cplAgregado([{ gastoRealUsd: 300 }, { gastoRealUsd: 700 }], 30);
    expect(r).toEqual({ cplUsd: 1000 / 30, gastoUsd: 1000, medidas: 2, total: 2 });
  });
  it('sin leads o sin gasto medido no hay CPL', () => {
    expect(cplAgregado([{ gastoRealUsd: 300 }], 0)).toBeNull();
    expect(cplAgregado([{ gastoRealUsd: null }], 10)).toBeNull();
    expect(cplAgregado([], 10)).toBeNull();
  });
  it('las campañas sin medir no suman gasto pero se cuentan', () => {
    const r = cplAgregado([{ gastoRealUsd: 100 }, { gastoRealUsd: null }], 10);
    expect(r).toEqual({ cplUsd: 10, gastoUsd: 100, medidas: 1, total: 2 });
  });
});
