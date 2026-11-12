/* eslint-disable security/detect-non-literal-fs-filename -- lee el CSS del propio módulo por rutas fijas */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// GUARDA de contraste de MARCAS de las gráficas (WCAG 1.4.11, ≥3:1). El relleno de una marca puede aclararse (estimado, tonos de la dona y de las
// agrupadas), pero su CONTORNO es el matiz pleno, y el matiz pleno ya se mide contra la tarjeta en `dashboard/contraste_v2.test.ts` (las series claras 4, 6 y 8 llevan contorno --chart-borde). Aquí se vigila que el contorno exista y que el relleno
// «estimado» mezclado con la tarjeta no baje de 2.5:1 (naranja .8 = 2.65) en los 7 matices medibles, en claro y en oscuro.
const leer = (f: string) => readFileSync(join(__dirname, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const graf = leer('graficas.css');
const tokens = readFileSync(join(__dirname, 'tokens.css'), 'utf8');

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contraste = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** Mezcla `a` con opacidad `o` sobre `b` (lo que pinta fill-opacity sobre la tarjeta). */
const mezcla = (a: string, b: string, o: number) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * o + parseInt(b.slice(i, i + 2), 16) * (1 - o)).toString(16).padStart(2, '0')).join('');

const bloque = (inicio: string) => { const i = tokens.indexOf(inicio); const a = tokens.indexOf('{', i); return tokens.slice(a + 1, tokens.indexOf('\n}', a)); };
const vars = (c: string) => Object.fromEntries([...c.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2].toLowerCase()]));
const CLARO = vars(bloque(':root [data-ui="v2"] {'));
const OSCURO = { ...CLARO, ...vars(bloque(':root[data-theme="dark"] [data-ui="v2"].tema-neutro,')) };
const opacidad = (re: RegExp) => parseFloat(re.exec(graf)![1]);

describe.each([['claro', CLARO], ['oscuro', OSCURO]] as const)('marcas de gráfica, modo %s', (_n, t) => {
  const OPACIDAD_ESTIMADO = opacidad(/data-tipo="estimado"\][^{]*\{[^}]*fill-opacity: ([\d.]+)/);
  const OPACIDAD_INFERIDO = opacidad(/data-tipo="inferido"\][^{]*\{[^}]*fill-opacity: ([\d.]+)/);
  it('estimado e inferido no bajan de .7 de opacidad y llevan contorno', () => {
    expect(OPACIDAD_ESTIMADO).toBeGreaterThanOrEqual(0.75);
    expect(OPACIDAD_INFERIDO).toBeGreaterThanOrEqual(0.7);
    expect(graf).toMatch(/data-tipo="estimado"\][^{]*\{[^}]*stroke: var\(--cat/);
    expect(graf).toMatch(/data-tipo="inferido"\][^{]*\{[^}]*stroke-dasharray/);
  });
  it.each([1, 2, 3, 5, 7])('matiz %i (serie dura): el relleno «estimado» (.8) mide ≥2.5:1 y, con su contorno pleno, la marca cumple 3:1', (n) => {
    const r = contraste(mezcla(t[`--chart-${n}`], t['--surface'], OPACIDAD_ESTIMADO), t['--surface']);
    expect(r, `matiz ${n} estimado mide ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(2.5); // el 3:1 de la marca lo da el contorno (siguiente prueba)
  });
  it.each([1, 2, 3, 5, 7])('matiz %i (serie dura): el contorno pleno (la marca de los tonos claros) mide ≥3:1', (n) => {
    expect(contraste(t[`--chart-${n}`], t['--surface'])).toBeGreaterThanOrEqual(3);
  });
});

describe.each([['claro', CLARO], ['oscuro', OSCURO]] as const)('series CLARAS (4, 6, 8), modo %s: el contorno --chart-borde las sostiene', (_n, t) => {
  // Paleta de alto contraste (11-nov-2026): en una escala de grises 8 series no caben sobre el piso de 3:1; las tres tenues llevan contorno ≥3:1.
  it('--chart-borde mide ≥3:1 contra la tarjeta', () => {
    expect(contraste(t['--chart-borde'], t['--surface'])).toBeGreaterThanOrEqual(3);
  });
  it('la regla de contorno existe para los matices 4, 6 y 8 en barras, dona, líneas y rellenos de HTML', () => {
    expect(graf).toMatch(/\[data-matiz="4"\], \[data-matiz="6"\], \[data-matiz="8"\]\) :is\(\.rv-colum__barra[^{]*\{[^}]*stroke: var\(--chart-borde\)/);
    expect(graf).toMatch(/\[data-matiz="8"\]\) :is\(\.rv-embudo__barra[^{]*\{[^}]*box-shadow: inset 0 0 0 1px var\(--chart-borde\)/);
  });
});

describe('los tonos claros (agrupadas y dona) se identifican por contorno, no solo por relleno', () => {
  it('barras de tono 1-3 con stroke del matiz y dona con borde de 1 px del matiz', () => {
    expect(graf).toMatch(/\.rv-colum__barra\.rv-tono-1[^{]*\{[^}]*stroke: var\(--cat/);
    expect(graf).toMatch(/\.rv-dona__borde \{ stroke: var\(--cat/);
  });
});
