import { describe, it, expect } from 'vitest';
import { fechaDeDiaUtc } from './mapa-actividad';

// A37-S06-08
describe('A37-S06-08: fecha de cada cuadro del mapa de actividad', () => {
  it('el domingo UTC 00:00 se rotula domingo, no sábado', () => {
    const domingo = Date.UTC(2026, 9, 18); // domingo 18-oct-2026 00:00 UTC
    expect(fechaDeDiaUtc(domingo)).toContain('domingo');
    expect(fechaDeDiaUtc(domingo)).toContain('18 de octubre');
    expect(fechaDeDiaUtc(domingo + 6 * 86_400_000)).toContain('sábado');
  });
});
