import { describe, it, expect } from 'vitest';
import { validarHorasEscalacion, validarUmbralConfianza } from './estrategia';
import { DatoInvalido } from '../errores';

// Solo lo puro (el patrón de clientes.test.ts): las dos validaciones que
// deciden la conducta de un agente. El escritor toca Supabase y no se prueba
// contra un mock.

describe('validarHorasEscalacion', () => {
  it('acepta el rango 1-48 y el default del producto (5) cae dentro', () => {
    expect(validarHorasEscalacion('5')).toBe(5);
    expect(validarHorasEscalacion(' 1 ')).toBe(1);
    expect(validarHorasEscalacion('48')).toBe(48);
  });

  it('rechaza cero, negativos, decimales y más de dos días — con el porqué', () => {
    expect(() => validarHorasEscalacion('0')).toThrow(DatoInvalido);
    expect(() => validarHorasEscalacion('49')).toThrow(/48/);
    expect(() => validarHorasEscalacion('2.5')).toThrow(/entero/);
    expect(() => validarHorasEscalacion('cinco')).toThrow(DatoInvalido);
  });
});

describe('validarUmbralConfianza', () => {
  it('acepta 0.50-0.99, con coma decimal, y redondea a centésimas', () => {
    expect(validarUmbralConfianza('0.85')).toBe(0.85);
    expect(validarUmbralConfianza('0,9')).toBe(0.9);
    expect(validarUmbralConfianza('.75')).toBe(0.75);
  });

  it('rechaza los extremos que romperían al agente, diciendo cuál rompe qué', () => {
    // 1.0 mandaría TODO a revisión manual; menos de 0.5 acepta lecturas al aire.
    expect(() => validarUmbralConfianza('1')).toThrow(/revisión manual/);
    expect(() => validarUmbralConfianza('0.4')).toThrow(DatoInvalido);
    expect(() => validarUmbralConfianza('85')).toThrow(DatoInvalido);
  });
});
