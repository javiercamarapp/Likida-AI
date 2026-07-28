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

// B14: `new Date('2026-04-31')` NO truena — rueda al 1 de mayo. Una fecha así
// entraba como válida y corría el plazo de facturación un mes entero, arrastrando
// el tope diario de alimentación y el aviso de caducidad con ella.
describe('normalizarFecha — días que no existen', () => {
  it('rechaza el 31 de abril en vez de rodarlo a mayo', () => {
    expect(normalizarFecha('31/04/2026')).toBeUndefined();
    expect(normalizarFecha('2026-04-31')).toBeUndefined();
  });

  it('rechaza el 30 de febrero', () => {
    expect(normalizarFecha('30/02/2026')).toBeUndefined();
  });

  it('el 29 de febrero de un año bisiesto SÍ existe', () => {
    expect(normalizarFecha('29/02/2024')).toBe('2024-02-29');
  });

  it('el 29 de febrero de un año NO bisiesto no existe', () => {
    expect(normalizarFecha('29/02/2026')).toBeUndefined();
  });

  it('las fechas válidas siguen pasando', () => {
    expect(normalizarFecha('30/04/2026')).toBe('2026-04-30');
    expect(normalizarFecha('31/05/2026')).toBe('2026-05-31');
  });
});
