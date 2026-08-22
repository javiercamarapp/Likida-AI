import { describe, it, expect } from 'vitest';
import { venceDentroDe, yaVencio } from './vencimiento';

// Escenario del hallazgo A14, hoy 2026-08-20: dos solicitudes vencen el 22 y
// el 24 (deberían contar como "pronto"); una tercera venció el 18 (NO).
const HOY = '2026-08-20';

describe('venceDentroDe — "≤ 5 días" cuenta hacia adelante (A14)', () => {
  it('vence en 2 y en 4 días → pronto', () => {
    expect(venceDentroDe('2026-08-22T00:00:00Z', HOY)).toBe(true);
    expect(venceDentroDe('2026-08-24', HOY)).toBe(true);
  });
  it('vence hoy y exactamente en 5 días → pronto (inclusive)', () => {
    expect(venceDentroDe('2026-08-20', HOY)).toBe(true);
    expect(venceDentroDe('2026-08-25', HOY)).toBe(true);
  });
  it('vence en 6 días → todavía no', () => {
    expect(venceDentroDe('2026-08-26', HOY)).toBe(false);
  });
  it('ya venció (18-ago) → NO es "pronto": es vencida', () => {
    expect(venceDentroDe('2026-08-18', HOY)).toBe(false);
    expect(yaVencio('2026-08-18', HOY)).toBe(true);
    expect(yaVencio('2026-08-20', HOY)).toBe(false);
  });
  it('cruza fin de mes sin aritmética de strings', () => {
    expect(venceDentroDe('2026-09-02', '2026-08-29')).toBe(true);
    expect(venceDentroDe('2026-09-04', '2026-08-29')).toBe(false);
  });
});
