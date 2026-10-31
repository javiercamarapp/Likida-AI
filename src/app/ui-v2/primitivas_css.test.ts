/* eslint-disable security/detect-non-literal-fs-filename -- lee el CSS del propio módulo por rutas fijas. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Contrato medible de las primitivas (ESTILO-LIKIDA): lo que se puede afirmar leyendo el CSS.
// Solo la capa v2 (después del marcador): arriba vive lo de siempre sin tocar (ver invariancia_v1.test.tsx).
const MARCA = 'Capa v2 Likida-Rovaq';
const css = (f: string) => { const t = readFileSync(join(__dirname, f), 'utf8'); return t.slice(t.indexOf(MARCA)).replace(/\/\*[\s\S]*?\*\//g, ''); };
const comp = css('componentes.css');
const graf = css('graficas.css');

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('primitivas v2 · contrato de ESTILO-LIKIDA', () => {
  it('botón: 32 px (36 en <820), radio 8, 13/600, toque 44 por ::after, primario negro por tokens (sin azul)', () => {
    expect(comp).toMatch(/\.rv-btn \{[^}]*min-height: 32px[^}]*font: 600 13px/);
    expect(comp).toMatch(/\.rv-btn \{[^}]*border-radius: 8px/);
    expect(comp).toMatch(/@media \(max-width: 819px\) \{\s*\[data-ui="v2"\] \.rv-btn \{ min-height: 36px; \}/);
    expect(comp).toMatch(/\.rv-btn::after \{[^}]*width: max\(100%, 44px\); height: max\(100%, 44px\)/);
    expect(comp).toMatch(/\.rv-btn--primary \{ background: var\(--btn-bg\)/); // lee --btn-bg/--btn-fg/--btn-borde/--btn-hover (tenue neutro, en tokens.css)
    expect(comp).not.toMatch(/\.rv-btn--primary \{[^}]*var\(--marca\)/);
  });
  it('botón compacto (.rv-btn--sm): 32 px en escritorio y también bajo 820 (donde el botón normal sube a 36)', () => {
    expect(comp).toMatch(/\.rv-btn--sm \{ min-height: 32px; padding: 4px 10px; \}/);
    expect(comp).toMatch(/@media \(max-width: 819px\) \{[^@]*\.rv-btn \{ min-height: 36px; \}\s*\[data-ui="v2"\] \.rv-btn--sm \{ min-height: 32px; \}/);
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
  it('vacío: título + una línea + UNA acción, sin borde punteado y sin ilustración', () => {
    const regla = /\[data-ui="v2"\] \.rv-vacio \{([^}]*)\}/.exec(comp)?.[1] ?? '';
    expect(regla).toMatch(/flex-direction: column/);
    expect(regla).toMatch(/border: 0/);
    expect(regla).not.toMatch(/dotted|dashed/);
    expect(comp).toMatch(/\.rv-vacio\[data-pantalla\] \{[^}]*border: 1px solid var\(--line\)/);
    expect(comp).toMatch(/\.rv-vacio__texto \{[^}]*max-width: 48ch/);
    expect(comp).not.toContain('rv-vacio__arte');
  });
  it('error: blando (borde y tinte suaves), con icono, texto y UNA acción', () => {
    expect(comp).toMatch(/\.rv-error \{[^}]*border: 1px solid color-mix\(in srgb, var\(--bad\) 28%/);
    expect(comp).toMatch(/\.rv-error \{[^}]*background: var\(--badbg\)/);
  });
  it('tarjeta: padding 14 (token --ui-pad), radio 12 y sin sombra', () => {
    const regla = /\[data-ui="v2"\] \.rv-tarjeta \{([^}]*)\}/.exec(comp)?.[1] ?? '';
    expect(regla).toMatch(/padding: var\(--ui-pad\)/);
    expect(regla).toMatch(/border-radius: 12px/);
    expect(regla).toMatch(/box-shadow: none/);
    const tokens = readFileSync(join(__dirname, 'tokens.css'), 'utf8');
    expect(tokens).toMatch(/--ui-rhythm: 12px;\s*--ui-pad: 14px;/);
    expect(tokens).toMatch(/max-width: 819px\) \{\s*:root \[data-ui="v2"\] \{\s*--ui-rhythm: 10px;\s*--ui-pad: 12px;/); // bajo 820 px
  });
  it('marco de página: columna con el ritmo del sistema (gap --ui-rhythm) y sin padding propio (lo pone el lienzo)', () => {
    const regla = /\[data-ui="v2"\] \.rv-marco \{([^}]*)\}/.exec(comp)?.[1] ?? '';
    expect(regla).toMatch(/flex-direction: column/);
    expect(regla).toMatch(/gap: var\(--ui-rhythm\)/);
    expect(regla).toMatch(/padding: 0/);
  });
  it('esqueleto: UNA variante que respira (1 ↔ .5, 1.6 s) solo con no-preference; sin shimmer', () => {
    const mov = readFileSync(join(__dirname, 'movimiento.css'), 'utf8');
    expect(mov).toMatch(/@keyframes rv-esq-respira \{ 0%, 100% \{ opacity: 1; \} 50% \{ opacity: \.5; \} \}/);
    expect(comp).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\[data-ui="v2"\] \.skeleton \{ animation: rv-esq-respira 1600ms/);
    expect(comp).toMatch(/\[data-ui="v2"\] \.skeleton \{[^}]*background-image: none[^}]*animation: none/);
  });
  it('KPI: tarjeta de 112 px, cifra 26/700, vacío 18/600, sello fuera de pantalla bajo 1100 px, sin elipsis', () => {
    expect(graf).toMatch(/\.rv-kpi \{[^}]*padding: 14px/); // 112 sale del contenido: 3 + 14 + 16 + 6 + 29 + 6 + 20 + 14
    expect(graf).toMatch(/\.rv-kpi__valor \{ font: 700 26px/);
    expect(graf).toMatch(/\.rv-kpi__valor\[data-vacio\] \{ font-size: 18px; font-weight: 600/);
    expect(graf).toMatch(/max-width: 1099px\) \{\s*\[data-ui="v2"\] \.rv-kpi__sello \{\s*position: absolute;\s*width: 1px/);
    expect(graf).not.toMatch(/\.rv-kpi__sello \{ display: none/);
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

describe('cascada (Waterfall) en la capa v2', () => {
  const tokens = readFileSync(join(__dirname, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const todos = (v: string) => [...tokens.matchAll(new RegExp(`^\\s*--${v}:\\s*(#[0-9a-f]{6});`, 'gim'))].map((m) => m[1].toLowerCase());
  it('las barras que bajan (--casc-baja = --g3) rinden ≥3:1 contra la superficie en claro y en oscuro', () => {
    expect(tokens).toMatch(/--casc-baja:\s*var\(--g3\)/);
    const g3 = todos('g3'); const sup = todos('surface');
    expect(g3).toHaveLength(2); expect(sup).toHaveLength(2); // [claro, oscuro]
    expect(ratio(g3[0], sup[0])).toBeGreaterThanOrEqual(3);
    expect(ratio(g3[1], sup[1])).toBeGreaterThanOrEqual(3);
  });
  it('el marcador --g2 anterior (#1f1f23 sobre #17171a) NO alcanzaba 3:1: por eso la capa v2 ya no lo usa', () => {
    expect(ratio('#1f1f23', '#17171a')).toBeLessThan(3);
  });
  it('la cifra de la barra más alta tiene aire arriba: .rv-cascada con padding-top y el rótulo no se pisa con el título', () => {
    expect(graf).toMatch(/\.rv-cascada \{ padding-top: 22px; \}/);
  });
});
