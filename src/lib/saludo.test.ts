import { describe, it, expect } from 'vitest';
import { saludo, fechaLarga, ahoraMs } from './saludo';

describe('saludo — la hora de México decide la frase', () => {
  const mx = (h: number) => new Date(`2026-08-05T${String((h + 6) % 24).padStart(2, '0')}:00:00Z`); // h local CDMX
  it('mañana, tarde y noche', () => {
    expect(saludo(mx(9))).toBe('Buenos días');
    expect(saludo(mx(15))).toBe('Buenas tardes');
    expect(saludo(mx(21))).toBe('Buenas noches');
  });
  it('la madrugada (0-5 local) cae en "Buenos días" — el saludo es aproximado a propósito', () => {
    // La función mapea UTC 6-17 → 0-11 "local" aproximada; el comentario dice
    // que un saludo no necesita el minuto exacto.
    expect(saludo(mx(4))).toBe('Buenos días');
  });
});

describe('fechaLarga — capitalizada solo al inicio (AUDITORÍA 10)', () => {
  it('la fecha tiene UN solo "De" al inicio, no cada palabra (los "de" quedan en minúscula)', () => {
    const f = fechaLarga(new Date('2026-08-05T12:00:00Z'));
    expect(f).toMatch(/^[A-ZÁÉÍÓÚ]/);
    expect(f).not.toMatch(/De Agosto/);
    expect(f).toMatch(/de agosto de 2026/);
  });
});

describe('ahoraMs — el reloj del servidor, inyectado (purity del repo)', () => {
  it('devuelve un número de epoch en milisegundos', () => {
    const antes = Date.now();
    const ahora = ahoraMs();
    expect(Number.isFinite(ahora)).toBe(true);
    expect(ahora).toBeGreaterThanOrEqual(antes);
  });
});
