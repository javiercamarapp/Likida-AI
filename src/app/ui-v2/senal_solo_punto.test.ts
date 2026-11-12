/* eslint-disable security/detect-non-literal-fs-filename -- recorre el árbol del repo con rutas propias */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// DECISIÓN 12 del dueño (11-nov-2026): el burdeos `--senal` es el ÚNICO acento de color de la interfaz y se usa SOLO en el
// punto o contador de «requiere acción». Prohibido en estados activos, barras, bordes o decoración. Esta guarda recorre los CSS
// (el selector de cada regla que lee `var(--senal`) y los .ts/.tsx de la app (donde no puede leerse en absoluto).
const SRC = join(process.cwd(), 'src');

function archivos(dir: string, exts: RegExp, salida: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const r = join(dir, n);
    if (statSync(r).isDirectory()) { if (n !== 'node_modules' && n !== '__fixtures__') archivos(r, exts, salida); continue; }
    if (exts.test(n) && !/\.test\./.test(n)) salida.push(r);
  }
  return salida;
}

/** Selector de la regla que contiene la línea `i`: el texto antes de `{` en la línea más cercana (hacia arriba) que lo tenga. */
function selectorDe(lineas: string[], i: number): string {
  for (let j = i; j >= 0; j--) {
    const k = lineas[j].indexOf('{');
    if (k >= 0) return lineas[j].slice(0, k);
  }
  return '';
}

describe('--senal solo en punto o contador de «requiere acción»', () => {
  it('en los CSS, toda regla que lee var(--senal) es de un punto o un contador', () => {
    const malos: string[] = [];
    for (const f of archivos(SRC, /\.css$/)) {
      const lineas = readFileSync(f, 'utf8').split('\n');
      lineas.forEach((l, i) => {
        if (!l.includes('var(--senal')) return;
        const sel = selectorDe(lineas, i);
        if (!/punto|contador/.test(sel)) malos.push(`${relative(SRC, f)}:${i + 1} → ${sel.trim()}`);
      });
    }
    expect(malos, `--senal fuera de un punto/contador:\n${malos.join('\n')}`).toEqual([]);
  });

  it('en el código TS/TSX no se lee var(--senal) (un punto de aviso va por clase CSS)', () => {
    const malos: string[] = [];
    for (const f of archivos(SRC, /\.tsx?$/)) {
      readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
        if (l.includes('var(--senal')) malos.push(`${relative(SRC, f)}:${i + 1}`);
      });
    }
    expect(malos, `var(--senal) en código:\n${malos.join('\n')}`).toEqual([]);
  });
});
