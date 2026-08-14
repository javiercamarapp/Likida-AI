import { describe, it, expect } from 'vitest';
import {
  generarLlave, hashDeLlave, prefijoDe, llaveDelHeader, mismoHash,
} from './llave-api';

describe('generarLlave — la llave en claro no se puede reconstruir', () => {
  it('el hash es SHA-256 en hex, 64 caracteres', () => {
    // El CHECK de la mig. 0093 exige exactamente esa forma: si alguien
    // intentara escribir la llave en claro, el insert falla en vez de guardarla.
    const l = generarLlave();
    expect(l.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('el prefijo NO alcanza para reconstruir la llave', () => {
    const l = generarLlave();
    expect(l.enClaro.startsWith(l.prefijo)).toBe(true);
    // El prefijo es una pista para reconocerla en una lista, no un pedazo útil.
    expect(l.enClaro.length).toBeGreaterThan(l.prefijo.length + 30);
  });

  it('dos llaves seguidas NUNCA son iguales', () => {
    const a = generarLlave(), b = generarLlave();
    expect(a.enClaro).not.toBe(b.enClaro);
    expect(a.hash).not.toBe(b.hash);
  });

  it('tiene entropía de sobra: 100 llaves, 100 distintas', () => {
    const set = new Set(Array.from({ length: 100 }, () => generarLlave().enClaro));
    expect(set.size).toBe(100);
  });

  it('lleva un prefijo reconocible, para que un escáner de secretos la detecte', () => {
    expect(generarLlave().enClaro.startsWith('lk_live_')).toBe(true);
  });

  it('el hash de la llave coincide con el que se guardaría', () => {
    const l = generarLlave();
    expect(hashDeLlave(l.enClaro)).toBe(l.hash);
  });
});

describe('prefijoDe — sin la forma correcta ni se consulta la base', () => {
  it('una cadena que no es llave devuelve null', () => {
    // Una ráfaga de basura no debe poder gastar el presupuesto de lecturas.
    expect(prefijoDe('hola')).toBeNull();
    expect(prefijoDe('')).toBeNull();
    expect(prefijoDe('Bearer algo')).toBeNull();
  });

  it('el prefijo correcto pero truncado tampoco pasa', () => {
    expect(prefijoDe('lk_live_ab')).toBeNull();
  });

  it('una llave real da su prefijo', () => {
    const l = generarLlave();
    expect(prefijoDe(l.enClaro)).toBe(l.prefijo);
  });

  it('aguanta espacios alrededor', () => {
    const l = generarLlave();
    expect(prefijoDe(`  ${l.enClaro}  `)).toBe(l.prefijo);
  });
});

describe('llaveDelHeader — no se adivina un esquema ajeno', () => {
  it('lee Bearer, sin importar mayúsculas', () => {
    expect(llaveDelHeader('Bearer abc123')).toBe('abc123');
    expect(llaveDelHeader('bearer abc123')).toBe('abc123');
  });

  it('IGNORA Basic y cualquier otro esquema', () => {
    // Un esquema que no reconocemos no se trata como si fuera el nuestro.
    expect(llaveDelHeader('Basic dXNlcjpwYXNz')).toBeNull();
    expect(llaveDelHeader('Token abc')).toBeNull();
  });

  it('sin header, o vacío, devuelve null', () => {
    expect(llaveDelHeader(null)).toBeNull();
    expect(llaveDelHeader('')).toBeNull();
    expect(llaveDelHeader('Bearer   ')).toBeNull();
  });
});

describe('mismoHash — comparación en tiempo constante', () => {
  it('dice true para iguales y false para distintos', () => {
    const a = hashDeLlave('x');
    expect(mismoHash(a, a)).toBe(true);
    expect(mismoHash(a, hashDeLlave('y'))).toBe(false);
  });

  it('largos distintos NO truenan — timingSafeEqual lanza si no coinciden', () => {
    // Y el largo del hash es público y siempre 64, así que compararlo no filtra
    // nada útil.
    expect(mismoHash('abc', hashDeLlave('x'))).toBe(false);
    expect(mismoHash('', '')).toBe(true);
  });

  it('no usa === : una diferencia en el PRIMER caracter cuesta lo mismo que en el último', () => {
    // No se puede medir el tiempo de forma fiable en una prueba, así que se
    // fija la propiedad estructural: la función existe y no compara con ===.
    const fuente = mismoHash.toString();
    expect(fuente).toContain('timingSafeEqual');
  });
});
