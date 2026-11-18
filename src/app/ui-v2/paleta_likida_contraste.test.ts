import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Contraste WCAG de la paleta de marca de Likida (decisión de Javier, 16-nov-2026). Lee tokens.css (fuente de verdad) y mide razones de contraste.
const css = readFileSync(join(__dirname, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const corte = css.indexOf(':root[data-theme="dark"] [data-ui="v2"].tema-neutro');
const CLARO = css.slice(0, corte);
const OSCURO = css.slice(corte);

function token(bloque: string, nombre: string, vistos = new Set<string>()): string {
  const m = new RegExp(`${nombre}:\\s*([^;]+);`).exec(bloque);
  if (!m) throw new Error(`falta ${nombre}`);
  const v = m[1].trim();
  const alias = /^var\((--[\w-]+)\)$/.exec(v);
  if (alias) {
    if (vistos.has(alias[1])) throw new Error(`ciclo en ${nombre}`);
    vistos.add(alias[1]);
    // Un alias del bloque oscuro puede resolverse en el claro (valores heredados).
    return token(bloque.includes(alias[1] + ':') ? bloque : CLARO, alias[1], vistos);
  }
  return v;
}
function luminancia(hex: string): number {
  const h = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!h) throw new Error(`no es #rrggbb: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function razon(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const c = (bloque: string, t: string) => token(bloque, t);

describe('paleta de marca Likida · contraste WCAG', () => {
  it('el medidor es correcto (negro/blanco = 21:1)', () => {
    expect(razon('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
  it('claro: texto blanco sobre el botón primario --btn-bg ≥ 4.5', () => {
    expect(razon('#ffffff', c(CLARO, '--btn-bg'))).toBeGreaterThanOrEqual(4.5);
    expect(razon(c(CLARO, '--btn-fg'), c(CLARO, '--btn-bg'))).toBeGreaterThanOrEqual(4.5);
  });
  it('oscuro: --btn-fg sobre --btn-bg ≥ 4.5', () => {
    expect(razon(c(OSCURO, '--btn-fg'), c(OSCURO, '--btn-bg'))).toBeGreaterThanOrEqual(4.5);
  });
  for (const [tema, b] of [['claro', CLARO], ['oscuro', OSCURO]] as const) {
    it(`${tema}: --ink sobre --surface y sobre --canvas ≥ 7`, () => {
      expect(razon(c(b, '--ink'), c(b, '--surface'))).toBeGreaterThanOrEqual(7);
      expect(razon(c(b, '--ink'), c(b, '--canvas'))).toBeGreaterThanOrEqual(7);
    });
    it(`${tema}: --muted sobre --canvas (y --surface) ≥ 4.5`, () => {
      expect(razon(c(b, '--muted'), c(b, '--canvas'))).toBeGreaterThanOrEqual(4.5);
      expect(razon(c(b, '--muted'), c(b, '--surface'))).toBeGreaterThanOrEqual(4.5);
    });
    it(`${tema}: --info sobre --infobg ≥ 4.5`, () => {
      expect(razon(c(b, '--info'), c(b, '--infobg'))).toBeGreaterThanOrEqual(4.5);
    });
    it(`${tema}: cada --chart-1..8 contra --surface ≥ 3`, () => {
      for (let n = 1; n <= 8; n++) {
        const r = razon(c(b, `--chart-${n}`), c(b, '--surface'));
        expect(r, `--chart-${n} ${c(b, `--chart-${n}`)} sobre ${c(b, '--surface')} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});
