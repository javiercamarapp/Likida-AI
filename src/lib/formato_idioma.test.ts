import { describe, it, expect } from 'vitest';
import {
  fechaCorta, fechaHoraMx, fechaMx, horaMx, litros, mxn, mxnCompacto, mxnEntero, numero, porcentaje,
} from './formato';

// i18n P0: `formato.ts` gana un último parámetro `idioma` ('es' por omisión). La moneda sigue siendo MXN, la zona America/Mexico_City
// y la CIFRA es idéntica en los dos idiomas (coma de miles, punto decimal); solo cambia la ortografía y la etiqueta de moneda.

describe('sin el argumento, todo sigue exactamente igual (español)', () => {
  it('cifras', () => {
    expect(mxn(1234.5)).toBe('$1,234.50');
    expect(mxn(1234.5, 'es')).toBe('$1,234.50');
    expect(mxnEntero(482311.4)).toBe('$482,311');
    expect(mxnCompacto(1_500_000)).toMatch(/^\$1\.5\s?M$/);
    expect(numero(1234567)).toBe('1,234,567');
    expect(porcentaje(42.94)).toBe('42.9%');
    expect(litros(1234.56)).toBe('1,234.56 L');
  });
  it('fechas', () => {
    expect(fechaMx('2026-08-04')).toBe('04 ago 2026');
    expect(fechaCorta('2026-08-04')).toMatch(/^04.ago$/); // el separador lo decide ICU; lo que se fija es que no cambió
    expect(fechaHoraMx('2026-08-04T20:32:00.000Z')).toBe('04 ago 2026, 14:32');
    expect(horaMx('2026-08-04T13:02:00.000Z')).toBe('07:02');
  });
});

describe('en inglés: misma cifra, moneda explícita', () => {
  it('mxn lleva MXN y no «MX$»: no se confunde con dólares', () => {
    expect(mxn(1234.5, 'en')).toBe('$1,234.50 MXN');
    expect(mxn(0, 'en')).toBe('$0.00 MXN');
    expect(mxn(-1250, 'en')).toBe('-$1,250.00 MXN');
    expect(mxn(0.005, 'en')).toBe('$0.01 MXN');
    // -0 y diferencias menores a medio centavo no se pintan como saldo negativo
    expect(mxn(-0.001, 'en')).toBe('$0.00 MXN');
  });
  it('la parte numérica es la MISMA en es y en para toda cifra', () => {
    for (const n of [0, 0.5, 1234.5, 99999.99, 1_000_000.01, -42.1]) {
      const soloCifra = (s: string) => s.replace(/MXN|\$|\s/g, '');
      expect(soloCifra(mxn(n, 'en'))).toBe(soloCifra(mxn(n, 'es')));
    }
    expect(numero(1234567.5, 'en')).toBe(numero(1234567.5, 'es'));
    expect(porcentaje(1234.5, 1, 'en')).toBe(porcentaje(1234.5, 1, 'es'));
    expect(litros(1234.56, 'en')).toBe(litros(1234.56, 'es'));
  });
  it('mxnEntero y mxnCompacto', () => {
    expect(mxnEntero(482311.4, 'en')).toBe('$482,311 MXN');
    expect(mxnEntero(-0.2, 'en')).toBe('$0 MXN');
    expect(mxnCompacto(999_999, 'en')).toBe('$999,999.00 MXN');
    expect(mxnCompacto(1_500_000, 'en')).toMatch(/^\$1\.5\s?M MXN$/);
    expect(mxnCompacto(-1_500_000, 'en')).toMatch(/^-\$1\.5\s?M MXN$/);
  });
  it('fechas en inglés, en hora de México y 24 h', () => {
    expect(fechaMx('2026-08-04', 'en')).toBe('Aug 4, 2026');
    expect(fechaCorta('2026-08-04', 'en')).toBe('Aug 4');
    // 31-jul 19:30 en México = 01:30 UTC del 1-ago: sigue siendo 31 de julio
    expect(fechaMx('2026-08-01T01:30:00.000Z', 'en')).toBe('Jul 31, 2026');
    expect(fechaHoraMx('2026-08-04T20:32:00.000Z', 'en')).toBe('Aug 4, 2026, 14:32');
    expect(fechaHoraMx('2026-08-04', 'en')).toBe('Aug 4, 2026');
    expect(horaMx('2026-08-04T13:02:00.000Z', 'en')).toBe('07:02');
  });
  it('ausente o ilegible sigue siendo «—», en ambos idiomas', () => {
    for (const i of ['es', 'en'] as const) {
      expect(fechaMx(null, i)).toBe('—');
      expect(fechaCorta('no es fecha', i)).toBe('—');
      expect(fechaHoraMx(undefined, i)).toBe('—');
      expect(horaMx('x', i)).toBe('—');
    }
  });
});
