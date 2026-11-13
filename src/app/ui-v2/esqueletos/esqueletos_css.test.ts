/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Los esqueletos son DISPOSICIÓN: la paleta (punto 10: monocroma), el movimiento y los controles viven en las piezas y en tokens.css.
const css = readFileSync(join(__dirname, 'esqueletos.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const tieneGlifos = (t: string) => [...t].some((c) => { const n = c.codePointAt(0)!; return (n >= 0x1f000 && n <= 0x1faff) || (n >= 0x2600 && n <= 0x27bf); });
const fuentes = readdirSync(__dirname).filter((f) => /\.(tsx?|css)$/.test(f) && !f.includes('.test.')).map((f) => [f, readFileSync(join(__dirname, f), 'utf8')] as const);

describe('esqueletos.css', () => {
  it('no lleva un solo color suelto (hex, rgb, hsl): todo sale de tokens', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
  });
  it('no inventa movimiento: ni animation ni transition ni @keyframes (la entrada y el lift los dan las piezas, tras reduced-motion)', () => {
    expect(css).not.toContain('animation');
    expect(css).not.toContain('transition');
    expect(css).not.toContain('@keyframes');
  });
  it('no usa sombras: en reposo las tarjetas de Rovaq no llevan (la única sombra es la de lo flotante)', () => {
    expect(css).not.toMatch(/box-shadow\s*:/);
  });
  it('no fija tamaños de letra fuera de la escala (20/14/13/12/11 por tokens --t-*)', () => {
    for (const d of css.split(';').filter((x) => /font/.test(x))) expect(d, d).not.toMatch(/ \d+px/);
  });
  it('los bordes son de 1 px (el punteado lo marca el estilo, no el grosor)', () => {
    for (const m of css.matchAll(/border[a-z-]*:\s*([0-9.]+)px/g)) expect(m[1]).toBe('1');
  });
  it('el borde del paso actual es la tinta, no un azul', () => {
    expect(css).toMatch(/\.rv-esq__paso\[data-actual\]\s*\{[^}]*var\(--ink\)/);
    expect(css).not.toMatch(/var\(--(accent|marca|info|chart-1|seg-activo|accion-cajon)[a-z-]*\)/);
  });
});

describe('fuentes de los esqueletos', () => {
  it('ningún archivo usa style={…}, emojis, <button> crudo ni colores en cadenas', () => {
    for (const [f, s] of fuentes.filter(([n]) => n.endsWith('.tsx'))) {
      const sinComentarios = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(sinComentarios, f).not.toMatch(/\bstyle=\{/);
      expect(sinComentarios, f).not.toMatch(/<button\b/);
      expect(sinComentarios, f).not.toMatch(/#[0-9a-fA-F]{6}\b/);
      expect(tieneGlifos(s), f).toBe(false);
    }
  });
  it('los esqueletos reusan el kit: no redefinen Tarjeta, Boton, Drawer, BarraPeriodo ni TiraCifras', () => {
    for (const [f, s] of fuentes.filter(([n]) => n.endsWith('.tsx'))) {
      expect(s, f).not.toMatch(/export (default )?function (Tarjeta|Boton|Drawer|BarraPeriodo|BarraFiltros|TiraCifras|TablaLista)\b/);
    }
  });
});
