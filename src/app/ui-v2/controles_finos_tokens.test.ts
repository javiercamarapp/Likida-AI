/* eslint-disable security/detect-non-literal-fs-filename -- lee el CSS del propio módulo por rutas fijas. */
import { readFileSync } from 'node:fs';
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

describe('controles finos · color de estados activos y acción del cajón (decisión de color PENDIENTE de Javier)', () => {
  it('valor por omisión NEUTRO: gris muy claro con texto negro', () => {
    expect(valor('--seg-activo-bg')).toBe('var(--ui-soft)');
    expect(valor('--seg-activo-borde')).toBe('var(--line2)');
    expect(valor('--seg-activo-fg')).toBe('var(--ink)');
    expect(valor('--seg-activo-hover')).toMatch(/^color-mix\(/);
  });
  it('la acción del cajón reutiliza el mismo trío (un cambio de una línea mueve ambos)', () => {
    for (const k of ['bg', 'borde', 'fg', 'hover']) expect(valor(`--accion-cajon-${k}`)).toBe(`var(--seg-activo-${k})`);
  });
  it('el azul de Rovaq queda documentado en el comentario junto a la variable, sin # ni rgb()', () => {
    const i = tokens.indexOf('\n  --seg-activo-bg:');
    const com = tokens.slice(tokens.lastIndexOf('/*', i), i);
    for (const t of ['2F6BD8', 'e6edfa', '1f4fb0', 'd8e3f8', 'PENDIENTE']) expect(com, t).toContain(t);
    expect(com).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
  });
  it('mini barras y tooltip: acento neutro por omisión y tooltip carbón con texto claro', () => {
    expect(valor('--barra-acento')).toBe('var(--ink2)');
    expect(valor('--barra-fondo')).toBe('var(--ui-soft)');
    expect(valor('--tip-bg')).toBe('#2a2a2f');
    expect(valor('--tip-fg')).toBe('#f4f4f5');
    expect(valor('--tip-borde')).toBe('transparent');
  });
  it('en oscuro el tooltip se aclara un tono y los estados activos heredan por var() (sin duplicar)', () => {
    expect(valor('--tip-bg', oscuro)).toBe('#3a3a40');
    expect(valor('--tip-fg', oscuro)).toBe('#f4f4f5');
    expect(valor('--seg-activo-bg', oscuro)).toBeUndefined();
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
