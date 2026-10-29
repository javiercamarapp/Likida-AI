/* eslint-disable security/detect-non-literal-fs-filename -- lee el CSS del propio módulo por rutas fijas. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Contrato medible de las primitivas (ESTILO-LIKIDA): lo que se puede afirmar leyendo el CSS.
const css = (f: string) => readFileSync(join(__dirname, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const comp = css('componentes.css');
const graf = css('graficas.css');

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('primitivas v2 · contrato de ESTILO-LIKIDA', () => {
  it('botón: 32 px (36 en <820), radio 8, 13/600, toque 44 por ::after, primario tenue (nunca negro ni azul)', () => {
    expect(comp).toMatch(/\.rv-btn \{[^}]*min-height: 32px[^}]*font: 600 13px/);
    expect(comp).toMatch(/\.rv-btn \{[^}]*border-radius: 8px/);
    expect(comp).toMatch(/@media \(max-width: 819px\) \{\s*\[data-ui="v2"\] \.rv-btn \{ min-height: 36px; \}/);
    expect(comp).toMatch(/\.rv-btn::after \{[^}]*width: max\(100%, 44px\); height: max\(100%, 44px\)/);
    expect(comp).toMatch(/\.rv-btn--primary \{ background: var\(--btn-tenue-bg\)/);
    expect(comp).not.toMatch(/\.rv-btn--primary \{[^}]*var\(--marca\)/);
  });
  it('botón deshabilitado: borde discontinuo y SIN opacidad', () => {
    const m = /\.rv-btn:disabled,[^{]*\{([^}]*)\}/.exec(comp);
    expect(m?.[1]).toMatch(/opacity: 1/);
    expect(m?.[1]).toMatch(/dashed/);
  });
  it('tenue: tinta sobre el fondo del primario ≥ 4.5:1 en claro y oscuro', () => {
    expect(ratio('#0e0e10', '#e4e4e6')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#0e0e10', '#d6d6d9')).toBeGreaterThanOrEqual(4.5); // hover
    expect(ratio('#f4f4f5', '#2a2a2f')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#f4f4f5', '#34343a')).toBeGreaterThanOrEqual(4.5);
  });
  it('overlays: 420/480/640 y 440/560; hoja 90 dvh con grabber; entrada ≤180 ms', () => {
    for (const w of ['420px', '480px', '640px', '440px', '560px']) expect(comp).toContain(w);
    expect(comp).toMatch(/max-height: 90dvh/);
    expect(comp).toMatch(/\.rv-ov--drawer \.rv-ov__grabber \{ display: block/);
  });
  it('tabla: cabecera 36, fila 40 (densa 32), sin mono', () => {
    expect(comp).toMatch(/thead th \{[^}]*height: 36px/);
    expect(comp).toMatch(/tbody td \{[^}]*height: 40px/);
    expect(comp).toMatch(/table\[data-densa\] tbody td \{ height: 32px/);
    expect(comp).not.toMatch(/thead th \{[^}]*font-mono/);
  });
  it('campos: caja de 44 con 34 visibles y 16 px en móvil; chevron con ≥12 px de aire', () => {
    expect(comp).toMatch(/height: 44px; min-height: 44px; font-size: 16px/);
    expect(comp).toMatch(/border: 5px solid transparent/);
    expect(comp).toMatch(/padding-inline-end: 30px/);
  });
  it('vacío: celda punteada de una línea, sin ilustración', () => {
    expect(comp).toMatch(/\.rv-vacio \{[^}]*dotted/);
    expect(comp).not.toContain('rv-vacio__arte');
  });
  it('KPI: tarjeta de 112 px, cifra 26/700, vacío 18/600, sello fuera de pantalla bajo 1100 px, sin elipsis', () => {
    expect(graf).toMatch(/\.rv-kpi \{[^}]*min-height: 112px/);
    expect(graf).toMatch(/\.rv-kpi__valor \{ font: 700 26px/);
    expect(graf).toMatch(/\.rv-kpi__valor\[data-vacio\] \{ font-size: 18px; font-weight: 600/);
    expect(graf).toMatch(/max-width: 1099px\) \{ \.rv-kpi__sello \{ display: none/);
    expect(graf).not.toContain('text-overflow');
  });
  it('gráficas: sin degradados decorativos fuera del área, trama 45° para parcial', () => {
    expect(graf).toMatch(/repeating-linear-gradient\(45deg/);
    expect(graf).not.toMatch(/(?<!repeating-)linear-gradient/);
  });
  it('procedencia: estimado y inferido legibles (tinta ≥ 4.5:1 sobre su fondo)', () => {
    expect(ratio('#3a3a40', '#e4e4e6')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#3a3a40', '#f7f7f8')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#d4d4d8', '#2a2a2f')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#d4d4d8', '#17171a')).toBeGreaterThanOrEqual(4.5);
  });
});
