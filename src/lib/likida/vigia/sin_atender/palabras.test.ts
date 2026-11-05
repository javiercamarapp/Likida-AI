import { describe, it, expect } from 'vitest';
import { normalizar } from '../entrada';
import { apremioNegado, compilarPalabras, contienePalabra } from './palabras';

describe('palabras', () => {
  it('compara sin acentos ni mayúsculas', () => {
    const c = compilarPalabras(['Retraso', 'avería', 'AVERIA']);
    expect(c).toEqual(['retraso', 'averia']);
    expect(contienePalabra(normalizar('Hay un RETRASO!!'), c)).toBe(true);
    expect(contienePalabra(normalizar('la avería del camión'), c)).toBe(true);
  });

  it('solo palabras completas', () => {
    const c = compilarPalabras(['embarque']);
    expect(contienePalabra(normalizar('el desembarque'), c)).toBe(false);
    expect(contienePalabra(normalizar('el embarque de hoy'), c)).toBe(true);
  });

  it('frases de varias palabras', () => {
    const c = compilarPalabras(['no ha llegado']);
    expect(contienePalabra(normalizar('la unidad no ha llegado aún'), c)).toBe(true);
    expect(contienePalabra(normalizar('no ha salido'), c)).toBe(false);
  });

  it('los metacaracteres se tratan como texto, no como patrón', () => {
    const c = compilarPalabras(['.*', '(a+)+$', '[', '\\']);
    expect(() => contienePalabra(normalizar('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!'), c)).not.toThrow();
    expect(contienePalabra(normalizar('cualquier cosa'), c)).toBe(false);
  });

  it('lista vacía y texto vacío no coinciden', () => {
    expect(contienePalabra('algo', [])).toBe(false);
    expect(contienePalabra('', ['a'])).toBe(false);
    expect(compilarPalabras(['', '   ', '¿?'])).toEqual([]);
  });

  it('detecta apremio negado', () => {
    expect(apremioNegado(normalizar('Sin prisa, gracias'))).toBe(true);
    expect(apremioNegado(normalizar('No es urgente'))).toBe(true);
    expect(apremioNegado(normalizar('es urgente'))).toBe(false);
  });
});
