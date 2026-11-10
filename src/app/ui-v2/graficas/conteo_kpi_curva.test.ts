import { describe, it, expect } from 'vitest';
import { DURACION_CONTEO_MS, easeOutCubic, valorEnConteo } from './conteo-kpi';

describe('conteo de KPI (identidad Rovaq)', () => {
  it('dura 650 ms, parte de 0 y llega EXACTO al valor real', () => {
    expect(DURACION_CONTEO_MS).toBe(650);
    expect(valorEnConteo(1234, 0)).toBe(0);
    expect(valorEnConteo(1234, 1)).toBe(1234);
    expect(valorEnConteo(1234.56, 1)).toBe(1234.56);
  });
  it('easeOutCubic: 1 - (1-k)^3', () => {
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 10);
  });
  it('los enteros se quedan enteros durante el conteo y nunca pasan del valor', () => {
    for (const k of [0.1, 0.4, 0.8, 0.99]) {
      const v = valorEnConteo(1000, k);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeLessThanOrEqual(1000);
    }
  });
});
