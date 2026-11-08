/* eslint-disable security/detect-non-literal-fs-filename -- lee el CSS del propio módulo por rutas fijas. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// CONTROLES FINOS (carril K1, SPEC-CONTROLES-FINOS §1): los tokens que ordenan alturas, bordes, foco y color de estados activos.
// La geometría sale del código de Rovaq (32 px de control, 28 en fila de tabla, 8/12/999 de radio por TIPO de control, bordes de 1 px).
const leer = (f: string) => readFileSync(join(__dirname, f), 'utf8');
const tokens = leer('tokens.css');
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const claro = sinComentarios(tokens);
const valor = (nombre: string, css = claro) => new RegExp(`${nombre}:\\s*([^;]+);`).exec(css)?.[1].trim();
const oscuro = (() => {
  const i = claro.indexOf(':root[data-theme="dark"] [data-ui="v2"].tema-neutro');
  return claro.slice(i, claro.indexOf('/* Lienzo', i) < 0 ? undefined : claro.indexOf('/* Lienzo', i));
})();

describe('controles finos · alturas y forma', () => {
  it('--ctl-h 32, --ctl-h-sm 28, --ctl-h-lg 40 y los alias viejos leen --ctl-h', () => {
    expect(valor('--ctl-h')).toBe('32px');
    expect(valor('--ctl-h-sm')).toBe('28px');
    expect(valor('--ctl-h-lg')).toBe('40px');
    expect(valor('--ctl-h-movil')).toBe('36px');
    expect(valor('--btn-h')).toBe('var(--ctl-h)');
    expect(valor('--input-h')).toBe('var(--ctl-h)');
    expect(valor('--btn-h-movil')).toBe('var(--ctl-h-movil)');
    expect(valor('--toque')).toBe('44px');
  });
  it('--item-h sigue literal en 32 px (shell_css.test lo cruza con ALTO_ITEM_PX)', () => {
    expect(valor('--item-h')).toBe('32px');
  });
  it('radios por TIPO de control: 8 control, 12 tarjeta, 999 píldora, 8 tooltip', () => {
    expect(valor('--r-control')).toBe('8px');
    expect(valor('--r-card')).toBe('12px');
    expect(valor('--r-pill')).toBe('999px');
    expect(valor('--r-tip')).toBe('8px');
  });
  it('ningún botón de tamaño normal supera 32 px a escritorio (--btn-h)', () => {
    const px = Number.parseInt(valor('--ctl-h') ?? '', 10);
    expect(px).toBeLessThanOrEqual(32);
  });
});

describe('controles finos · bordes y foco', () => {
  it('borde de 1 px; el botón usa el borde claro y el campo conserva el marcado', () => {
    expect(valor('--borde-w')).toBe('1px');
    expect(valor('--btn-borde-sec')).toBe('var(--line2)');
    expect(valor('--campo-borde')).toBe('var(--input)');
    expect(valor('--borde-reposo')).toBe('var(--line)');
  });
  it('foco fuerte: anillo de 2 px con separaciones 3 / 2 / 1', () => {
    expect(valor('--foco-ancho')).toBe('2px');
    expect(valor('--foco-sep')).toBe('3px');
    expect(valor('--foco-sep-campo')).toBe('2px');
    expect(valor('--foco-sep-dentro')).toBe('1px');
  });
});

describe('controles finos · color de estados activos y acción del cajón (azul de Rovaq, decisión del dueño 7-nov-2026)', () => {
  it('claro: azul suave e6edfa con texto 1f4fb0, anillo del azul al 30 % y hover d8e3f8', () => {
    expect(valor('--seg-activo-bg')).toBe('#e6edfa');
    expect(valor('--seg-activo-borde')).toBe('color-mix(in srgb, #2f6bd8 30%, transparent)');
    expect(valor('--seg-activo-fg')).toBe('#1f4fb0');
    expect(valor('--seg-activo-hover')).toBe('#d8e3f8');
  });
  it('oscuro: 1d2433 con texto a9c1f2, anillo al 45 % y hover 26314a', () => {
    expect(valor('--seg-activo-bg', oscuro)).toBe('#1d2433');
    expect(valor('--seg-activo-borde', oscuro)).toBe('color-mix(in srgb, #2f6bd8 45%, transparent)');
    expect(valor('--seg-activo-fg', oscuro)).toBe('#a9c1f2');
    expect(valor('--seg-activo-hover', oscuro)).toBe('#26314a');
  });
  it('la acción del cajón reutiliza el mismo trío (un cambio de una línea mueve ambos)', () => {
    for (const k of ['bg', 'borde', 'fg', 'hover']) expect(valor(`--accion-cajon-${k}`)).toBe(`var(--seg-activo-${k})`);
  });
  it('el comentario junto a la variable documenta la decisión, el alcance y cómo volver al neutro', () => {
    const i = tokens.indexOf('\n  --seg-activo-bg:');
    const com = tokens.slice(tokens.lastIndexOf('/*', i), i);
    for (const t of ['2F6BD8', 'e6edfa', '1f4fb0', 'd8e3f8', '7-nov-2026', 'var(--ui-soft)']) expect(com, t).toContain(t);
  });
  it('mini barras y tooltip: acento neutro por omisión y tooltip carbón con texto claro', () => {
    expect(valor('--barra-acento')).toBe('var(--ink2)');
    expect(valor('--barra-fondo')).toBe('var(--ui-soft)');
    expect(valor('--tip-bg')).toBe('#2a2a2f');
    expect(valor('--tip-fg')).toBe('#f4f4f5');
    expect(valor('--tip-borde')).toBe('transparent');
  });
  it('en oscuro el tooltip se aclara un tono', () => {
    expect(valor('--tip-bg', oscuro)).toBe('#3a3a40');
    expect(valor('--tip-fg', oscuro)).toBe('#f4f4f5');
  });
});

describe('controles finos · tipografía, iconos y marco', () => {
  it('tipografía de controles dentro de la escala cerrada 11/12/13/14/15/16/18/20/26', () => {
    for (const k of ['--t-ctl', '--t-ctl-sm', '--t-chip', '--t-etq', '--t-grupo']) {
      const px = Number(/(\d+)px/.exec(valor(k) ?? '')?.[1]);
      expect([11, 12, 13, 14, 15, 16, 18, 20, 26], k).toContain(px);
    }
  });
  it('iconos 14/16/18, aire 8 y 6, relleno horizontal 12', () => {
    expect([valor('--ico-sm'), valor('--ico'), valor('--ico-lg')]).toEqual(['14px', '16px', '18px']);
    expect([valor('--gap-ctl'), valor('--gap-ico'), valor('--btn-px')]).toEqual(['8px', '6px', '12px']);
  });
  it('marco: la marca mide lo mismo que la barra de página y el logo baja a 22 / 24 / 22 px', () => {
    expect(valor('--marca-h')).toBe(valor('--topbar-h'));
    expect([valor('--logo-sb'), valor('--logo-riel'), valor('--logo-movil'), valor('--logo-carga')]).toEqual(['22px', '24px', '22px', '40px']);
    expect(valor('--sb-w')).toBe('232px');
    expect(valor('--rail-w')).toBe('72px');
  });
  it('navegación: activo sutil por gris y peso', () => {
    expect(valor('--nav-activo-bg')).toBe('var(--ui-soft)');
    expect(valor('--nav-activo-fg')).toBe('var(--ink)');
    expect(valor('--nav-activo-peso')).toBe('600');
  });
});

describe('controles finos · reglas de las primitivas (K1-1)', () => {
  const comp = sinComentarios(leer('componentes.css'));
  const piezas = sinComentarios(leer('piezas.css'));
  it('.rv-btn usa el borde claro de Rovaq (--btn-borde-sec), no el de los campos (--input)', () => {
    expect(comp).toMatch(/\.rv-btn \{[^}]*border: var\(--borde-w, 1px\) solid var\(--btn-borde-sec\)/);
    expect(/\.rv-btn \{[^}]*var\(--input\)/.test(comp)).toBe(false);
  });
  it('.rv-btn--suave lee el trío --accion-cajon-*', () => {
    expect(comp).toMatch(/\.rv-btn--suave \{[^}]*var\(--accion-cajon-bg\)[^}]*var\(--accion-cajon-borde\)[^}]*var\(--accion-cajon-fg\)/);
    expect(comp).toMatch(/\.rv-btn--suave:hover \{[^}]*var\(--accion-cajon-hover\)/);
  });
  it('segmentado: pista blanca con borde claro; activo con el trío y solo el anillo de 1 px, SIN sombra de relieve', () => {
    expect(piezas).toMatch(/\.rv-seg \{[^}]*background: var\(--surface\)[^}]*var\(--btn-borde-sec\)/);
    const activo = /\.rv-seg__btn\[aria-checked="true"\] \{([^}]*)\}/.exec(piezas)?.[1] ?? '';
    expect(activo).toContain('var(--seg-activo-bg)');
    expect(activo).toContain('var(--seg-activo-fg)');
    expect(activo.replace(/\s+/g, ' ').trim()).toMatch(/box-shadow: 0 0 0 1px var\(--seg-activo-borde\);$/);
  });
  it('chip y filtro activos leen --seg-activo-* (ya no --chip-activo-*)', () => {
    expect(comp).not.toMatch(/\.rv-(?:chip|fl)[^{]*\{[^}]*--chip-activo/);
    expect(comp).toMatch(/\.rv-chip\[aria-pressed="true"\][^{]*\{[^}]*var\(--seg-activo-bg\)/);
    expect(comp).toMatch(/\.rv-fl\[data-activo\][^{]*\{[^}]*var\(--seg-activo-bg\)/);
  });
  it('barra de filtros de una línea de 32 px; chip de filtro en píldora; icono (i) de 14 px', () => {
    expect(comp).toMatch(/\.rv-filtros \{[^}]*min-height: var\(--ctl-h, 32px\)[^}]*padding: 2px/);
    expect(comp).toMatch(/\.rv-fl--chip \{[^}]*padding: 0 12px/);
    expect(comp).toMatch(/\.rv-info svg \{[^}]*var\(--ico-sm, 14px\)/);
  });
  it('ningún control del kit fija un borde de 2 px (excepciones técnicas: spinner y subrayado de pestaña)', () => {
    for (const h of [comp, piezas]) {
      for (const m of h.matchAll(/([^{}]*\.rv-(?:btn|fl|chip|seg|info)\b[^{}]*)\{([^}]*)\}/g)) {
        if (/spinner|forced|Highlight/.test(m[1] + m[2])) continue;
        expect(m[2], m[1].trim()).not.toMatch(/border(?:-width)?:\s*2px/);
      }
    }
  });
  it('--ctl-h-lg solo lo leen /login y las páginas públicas', () => {
    const quien: string[] = [];
    const recorrer = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const f = join(dir, n);
        if (statSync(f).isDirectory()) { if (n !== 'node_modules') recorrer(f); } else if (/\.(css|tsx?)$/.test(n) && !/\.test\./.test(n) && /var\(--ctl-h-lg/.test(readFileSync(f, 'utf8'))) quien.push(f.replace(join(__dirname, '..'), ''));
      }
    };
    recorrer(join(__dirname, '..'));
    for (const f of quien) expect(f, f).toMatch(/^\/(?:login\/login\.css|ui-v2\/marco-publico\.css)$/);
  });
});
