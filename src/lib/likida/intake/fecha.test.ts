import { describe, it, test, expect } from 'vitest';
import { normalizarFecha, corregirVolteoDiaMes } from './fecha';

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

describe('corregirVolteoDiaMes — la regla DÍA/MES aplicada determinista, no adivinada', () => {
  test('el caso medido: "2/8/2026" leída como 8-feb se corrige a 2-ago', () => {
    expect(corregirVolteoDiaMes('2026-02-08', '2/8/2026')).toBe('2026-08-02');
    expect(corregirVolteoDiaMes('2026-02-08', '02/08/26')).toBe('2026-08-02');
  });

  test('una lectura DÍA/MES no se voltea JAMÁS — ni siquiera cuando el papel era MES/DÍA', () => {
    // El pie de Costco imprime "7/01/26" queriendo decir 1 de julio. Si el
    // modelo lo leyó como 7 de enero (día/mes, la regla), esta función NO lo
    // "arregla": voltear una lectura que cumple la regla sería adivinar el
    // formato del impresor. La excepción de Costco es del prompt y del
    // carve-out por emisor en ocr.ts, no de esta regla.
    expect(corregirVolteoDiaMes('2026-01-07', '7/01/26')).toBe('2026-01-07');
  });

  test('solo corrige el VOLTEO EXACTO: cualquier otra discrepancia se queda como salió', () => {
    // El modelo ya leyó día/mes: no se toca.
    expect(corregirVolteoDiaMes('2026-08-02', '2/8/2026')).toBe('2026-08-02');
    // La fecha del modelo no es ninguna de las dos lecturas: no se inventa.
    expect(corregirVolteoDiaMes('2026-03-15', '2/8/2026')).toBe('2026-03-15');
  });

  test('sin ambigüedad no hay nada que corregir (un componente > 12)', () => {
    expect(corregirVolteoDiaMes('2026-08-25', '25/08/2026')).toBe('2026-08-25');
    // La lectura mes/día de "25/08" no existe: dd/mm === única válida.
    expect(corregirVolteoDiaMes('2026-12-25', '25/12/26')).toBe('2026-12-25');
  });

  test('una fecha con el mes en LETRA no se toca — ésa manda por el prompt', () => {
    expect(corregirVolteoDiaMes('2026-07-01', 'a 01 de JULIO de 2026')).toBe('2026-07-01');
  });

  test('sin impresa o sin fecha del modelo, no se afirma nada', () => {
    expect(corregirVolteoDiaMes(undefined, '2/8/2026')).toBeUndefined();
    expect(corregirVolteoDiaMes('2026-02-08', null)).toBe('2026-02-08');
    expect(corregirVolteoDiaMes('2026-02-08', 'FECHATRANS:2026 07 27')).toBe('2026-02-08');
  });

  test('el mismo día en los dos sentidos (3/3) no dispara nada', () => {
    expect(corregirVolteoDiaMes('2026-03-03', '3/3/2026')).toBe('2026-03-03');
  });
});
