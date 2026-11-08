import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { paresLegibles, valorLegible } from './valor-legible';

describe('valorLegible / paresLegibles', () => {
  it('nunca produce «[object Object]» ni «null»', () => {
    const fuentes = { aviso: 'x', dossier: { a: 1 }, variante_b: { texto: 'hola', n: { z: { y: 1 } } }, datos_usados: null };
    const texto = paresLegibles(fuentes).map(([k, v]) => `${k}: ${v}`).join(' · ');
    expect(texto).not.toMatch(/\[object Object\]|null|undefined/);
    expect(texto).toContain('aviso: x');
    expect(texto).toContain('dossier: a: 1');
  });
  it('omite null, vacíos y objetos sin contenido', () => {
    expect(valorLegible(null)).toBeNull();
    expect(valorLegible('  ')).toBeNull();
    expect(valorLegible({})).toBeNull();
    expect(valorLegible({ a: null })).toBeNull();
    expect(paresLegibles({ a: null, b: {} })).toEqual([]);
  });
  it('legibiliza arreglos, booleanos y recorta lo largo', () => {
    expect(valorLegible(['a', null, 'b'])).toBe('a, b');
    expect(valorLegible(true)).toBe('sí');
    expect(valorLegible('x'.repeat(500))!.length).toBeLessThanOrEqual(140);
  });
});

/** Guarda: en /admin no se interpola `String(v)` sobre los valores de un Object.entries (daría «[object Object]»). */
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}
describe('guarda anti «[object Object]» en /admin', () => {
  it('ningún Object.entries(...).map usa String(valor)', () => {
    const malos = archivos(__dirname).filter((f) => {
      const s = readFileSync(f, 'utf8');
      return /Object\.entries\([^)]*\)\s*\.map\(\s*\(\[\w+,\s*(\w+)\]\)\s*=>[^\n]*String\(\1\)/.test(s);
    });
    expect(malos).toEqual([]);
  });
});
