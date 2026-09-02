import { describe, it, expect } from 'vitest';
import { agregarDiasHabiles } from './dias-habiles';

// ADM-10 (auditoría 24, MEDIO) — "Vencen pronto (≤ 5 días hábiles)" en
// /admin/compliance contaba días NATURALES (`5 * 864e5`). El caso que lo
// prueba: un jueves + 5 días hábiles cruza un fin de semana completo.

describe('agregarDiasHabiles', () => {
  it('un jueves + 5 días hábiles cae el jueves siguiente (cruza UN fin de semana)', () => {
    // 2026-08-27 es jueves.
    expect(agregarDiasHabiles('2026-08-27', 5)).toBe('2026-09-03');
  });

  it('difiere de sumar 5 días naturales — ese es exactamente el bug', () => {
    const naturalesMal = '2026-09-01'; // 2026-08-27 + 5*864e5 (días naturales)
    expect(agregarDiasHabiles('2026-08-27', 5)).not.toBe(naturalesMal);
  });

  it('un viernes + 1 día hábil salta el fin de semana hasta el lunes', () => {
    // 2026-08-28 es viernes.
    expect(agregarDiasHabiles('2026-08-28', 1)).toBe('2026-08-31');
  });

  it('un lunes + 1 día hábil es simplemente el martes', () => {
    // 2026-08-31 es lunes.
    expect(agregarDiasHabiles('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('n=0 devuelve el mismo día', () => {
    expect(agregarDiasHabiles('2026-08-27', 0)).toBe('2026-08-27');
  });
});
