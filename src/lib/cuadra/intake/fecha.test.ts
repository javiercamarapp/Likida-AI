import { describe, it, expect } from 'vitest';
import { normalizarFecha } from './fecha';

describe('normalizarFecha', () => {
  it('DD/MM/YYYY → ISO', () => {
    expect(normalizarFecha('15/05/2025')).toBe('2025-05-15');
    expect(normalizarFecha('08/10/2024 09:06:37')).toBe('2024-10-08');
  });
  it('DD/MM/YY → ISO (siglo 20xx)', () => {
    expect(normalizarFecha('28/04/22 18:02')).toBe('2022-04-28');
  });
  it('ya ISO se conserva', () => {
    expect(normalizarFecha('2026-05-15T09:14:00')).toBe('2026-05-15');
  });
  it('sin fecha / basura → undefined', () => {
    expect(normalizarFecha(null)).toBeUndefined();
    expect(normalizarFecha('sin fecha')).toBeUndefined();
  });
});
