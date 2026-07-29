import { describe, it, expect } from 'vitest';
import { litros, fechaMx } from './formato';

// ═══════════════════════════════════════════════════════════════════════════
// El contralor compara la pantalla con el PDF que le mandó a su contador.
// Estas pruebas fijan que las dos cifras que puede cruzar —litros elegibles y
// fecha de la liquidación— digan lo mismo en los dos sitios.
// ═══════════════════════════════════════════════════════════════════════════

describe('litros: una sola representación, la del PDF', () => {
  it('conserva los dos decimales que la lista redondeaba a entero', () => {
    // La tarjeta grande del panel decía "152 L" y al hacer clic el detalle
    // decía "152.35 L" (auditoría 5, frontend, MEDIO 1).
    expect(litros(152.35)).toBe('152.35 L');
    expect(litros(1234.56)).toBe('1,234.56 L');
  });

  it('no rellena con ceros los valores redondos — igual que el PDF', () => {
    expect(litros(1850)).toBe('1,850 L');
    expect(litros(0)).toBe('0 L');
  });

  it('coincide carácter por carácter con lo que imprime el PDF', () => {
    // `pdf.ts` usa `toLocaleString('es-MX')` a secas. El tope de 2 decimales
    // solo puede diferir si llegara un valor con 3+, y el motor redondea a 2.
    for (const v of [0, 0.5, 152.35, 1234.56, 1850, 98765.4]) {
      expect(litros(v)).toBe(`${v.toLocaleString('es-MX')} L`);
    }
  });
});

describe('fechaMx: la fecha del cliente, no la del servidor', () => {
  it('una liquidación cerrada a las 20:00 de CDMX NO salta al día siguiente', () => {
    // created_at real que devuelve PostgREST para el 31-jul-2026 20:00 CST.
    // `.slice(0, 10)` daba "2026-08-01": en el corte mensual, una liquidación
    // de julio aparecía listada en agosto (auditoría 5, frontend, MEDIO 3).
    expect('2026-08-01T02:00:00.000+00:00'.slice(0, 10)).toBe('2026-08-01'); // el bug
    expect(fechaMx('2026-08-01T02:00:00.000+00:00')).toBe('31 jul 2026');   // el arreglo
  });

  it('respeta el día cuando la hora local y la UTC coinciden', () => {
    expect(fechaMx('2026-07-31T15:00:00.000+00:00')).toBe('31 jul 2026');
  });

  it('usa el mismo formato que el PDF (día, mes corto, año)', () => {
    expect(fechaMx('2026-08-01T18:00:00.000+00:00')).toBe('01 ago 2026');
  });

  it('una fecha ausente o rota se pinta como guion, no como "Invalid Date"', () => {
    expect(fechaMx(undefined)).toBe('—');
    expect(fechaMx(null)).toBe('—');
    expect(fechaMx('')).toBe('—');
    expect(fechaMx('no es una fecha')).toBe('—');
  });
});
