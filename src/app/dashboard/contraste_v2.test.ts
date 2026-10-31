/* eslint-disable security/detect-non-literal-fs-filename -- lee el CSS del propio repo por una ruta fija relativa a este archivo; nada viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// CONTRASTE DE LA CAPA v2 — se mide, no se recuerda (gemela de contraste.test.ts, que mide v1).
//
// Lee `ui-v2/tokens.css` (nunca una copia en el test: una copia se queda vieja y la prueba mediría un
// color que ya no se sirve), resuelve el claro y el oscuro como los resuelve el navegador (el oscuro
// hereda del claro lo que no redefine, y los alias `var(--x)` se siguen) y mide TODOS los pares con la
// fórmula WCAG 2.1 (1.4.3 texto 4.5:1; 1.4.11 componentes y marcas 3:1).
// ═══════════════════════════════════════════════════════════════════════════

const CSS = readFileSync(fileURLToPath(new URL('../ui-v2/tokens.css', import.meta.url)), 'utf8');

type Tokens = Record<string, string>;

function bloque(inicio: string): string {
  const i = CSS.indexOf(inicio);
  expect(i, `no encontré el bloque "${inicio}" en tokens.css`).toBeGreaterThan(-1);
  const abre = CSS.indexOf('{', i);
  return CSS.slice(abre + 1, CSS.indexOf('\n}', abre));
}
function variables(cuerpo: string): Tokens {
  const sinComentarios = cuerpo.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Tokens = {};
  for (const m of sinComentarios.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
}
function resolver(t: Tokens, nombre: string, profundidad = 0): string {
  const v = t[nombre];
  expect(v, `${nombre} no está definido en tokens.css`).toBeDefined();
  const alias = /^var\((--[a-z0-9-]+)\)$/i.exec(v);
  if (alias) {
    expect(profundidad, `alias circular en ${nombre}`).toBeLessThan(8);
    return resolver(t, alias[1], profundidad + 1);
  }
  return v.toLowerCase();
}

const CLARO = variables(bloque(':root [data-ui="v2"] {'));
const OSCURO = { ...CLARO, ...variables(bloque(':root[data-theme="dark"] [data-ui="v2"].tema-neutro,')) };
const TEMAS: Array<[string, Tokens]> = [['claro', CLARO], ['oscuro', OSCURO]];

function luminancia(hex: string): number {
  expect(hex, `no es #rrggbb: ${hex}`).toMatch(/^#[0-9a-f]{6}$/);
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contraste(a: string, b: string): number {
  const [alto, bajo] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (alto + 0.05) / (bajo + 0.05);
}

const AA_TEXTO = 4.5;
const AA_COMPONENTE = 3;

/** [tinta, fondo, descripción] — texto que se lee. */
const PARES_TEXTO: Array<[string, string]> = [
  ['--ink', '--surface'], ['--ink', '--bg'], ['--ink', '--canvas'], ['--ink', '--canvas2'],
  ['--ink2', '--surface'], ['--ink2', '--bg'], ['--ink2', '--canvas'],
  ['--muted', '--surface'], ['--muted', '--bg'], ['--muted', '--canvas'],
  ['--faint', '--surface'], ['--faint', '--bg'], ['--faint', '--canvas'],
  ['--marca-fg', '--marca'], ['--marca-fg', '--marca-hover'], ['--accent-fg', '--accent'],
  ['--ok', '--okbg'], ['--ok', '--surface'],
  ['--warn', '--warnbg'], ['--warn', '--surface'],
  ['--bad', '--badbg'], ['--bad', '--surface'],
  ['--info', '--infobg'], ['--info', '--surface'],
  ['--tip-ink', '--tip'],
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n): [string, string] => [`--ink-${n}`, `--soft-${n}`]),
  // Capa v2 (rediseño al sistema Rovaq): botón primario tenue y su alternativa, cabecera de tabla, aliases del cromo,
  // texto sobre segmento relleno de cada matiz de datos y el logo (tinta) sobre la capa de carga.
  // Paleta negro/gris/blanco: la tinta del ítem activo sobre su fondo suave.
  ['--ui-activo-ink', '--ui-activo-bg'], ['--tabla-cab-ink', '--tint-info'], ['--info', '--infobg'],
  ['--marca-fg', '--marca-hover'],
  ['--btn-fg', '--btn-bg'], ['--btn-fg', '--btn-hover'], ['--btn-soft-fg', '--btn-soft'], ['--btn-soft-fg', '--btn-soft-hover'],
  ['--tabla-cab-ink', '--tabla-cab-bg'], ['--ink', '--ui-elevated'], ['--ink', '--ui-soft'], ['--muted', '--ui-soft'],
  ['--ink', '--carga-fondo'], ['--ink-6', '--ui-soft'],
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n): [string, string] => [`--on-${n}`, `--chart-${n}`]),
];

describe.each(TEMAS)('tokens v2, modo %s: texto ≥ 4.5:1', (_nombre, t) => {
  it.each(PARES_TEXTO)('%s sobre %s', (tinta, fondo) => {
    const r = contraste(resolver(t, tinta), resolver(t, fondo));
    expect(r, `${tinta} sobre ${fondo} mide ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXTO);
  });
});

describe.each(TEMAS)('tokens v2, modo %s: controles y marcas ≥ 3:1', (_nombre, t) => {
  // 1.4.11: el borde de un campo y la barra de señal tienen que verse sin leer nada.
  it.each([
    ['--input', '--surface'], ['--input', '--bg'], ['--btn-borde', '--surface'], ['--btn-borde', '--bg'], ['--ui-activo-barra', '--ui-activo-bg'], ['--input', '--ui-soft'], ['--senal', '--surface'], ['--senal', '--bg'], ['--senal', '--ui-soft'],
    // Bordes de procedencia (Estimado / Inferido / Sin dato) sobre su relleno y sobre la tarjeta; neutro de barra y ejes de gráfica.
    ['--prov-est-borde', '--prov-est-bg'], ['--prov-inf-borde', '--prov-inf-bg'], ['--prov-sin-borde', '--surface'],
    ['--chart-barra', '--surface'], ['--chart-fuerte', '--surface'], ['--ink', '--carga-fondo'], ['--prov-obs', '--surface'],
  ])('%s sobre %s', (a, b) => {
    const r = contraste(resolver(t, a), resolver(t, b));
    expect(r, `${a} sobre ${b} mide ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_COMPONENTE);
  });

  // Las 8 tintas de DATOS (barras, líneas, filete de KPI) sobre la tarjeta. Una marca de color nunca va sola:
  // siempre lleva etiqueta/patrón (regla E-10), pero el umbral de la marca en sí también se mide.
  it.each([1, 2, 3, 5, 6, 7, 8])('--chart-%i sobre --surface', (n) => {
    const r = contraste(resolver(t, `--chart-${n}`), resolver(t, '--surface'));
    expect(r, `--chart-${n} mide ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_COMPONENTE);
  });
});

describe('tokens v2: excepción declarada', () => {
  // --chart-4 (ámbar) es el matiz que NO llega a 3:1 como marca sobre la tarjeta clara. Su par de texto (--ink-4 sobre
  // --soft-4) sí pasa 4.5:1 arriba; como relleno de barra o de punto siempre lleva etiqueta de texto al lado (E-10).
  // Si alguien lo oscurece hasta 3:1, esta prueba lo avisa para que la excepción se retire.
  it('--chart-4 claro: medido y documentado', () => {
    const r = contraste(resolver(CLARO, '--chart-4'), resolver(CLARO, '--surface'));
    expect(r).toBeGreaterThan(1.5);
    if (r >= AA_COMPONENTE) throw new Error('--chart-4 ya pasa 3:1: retira esta excepción y súmalo a la lista de marcas');
  });
  it('--chart-4 oscuro pasa 3:1', () => {
    expect(contraste(resolver(OSCURO, '--chart-4'), resolver(OSCURO, '--surface'))).toBeGreaterThanOrEqual(AA_COMPONENTE);
  });
});

describe('tokens v2: cobertura', () => {
  it('el oscuro redefine todo color base (si no, hereda un valor pensado para el claro)', () => {
    const base = ['--bg', '--surface', '--canvas', '--ink', '--ink2', '--muted', '--faint', '--line', '--line2', '--input',
      '--marca', '--marca-fg', '--btn-bg', '--btn-borde', '--btn-hover', '--btn-soft', '--btn-soft-fg', '--ui-elevated',
      '--carga-fondo', '--tabla-cab-bg', '--chart-barra', '--chart-fuerte', '--chart-rejilla', '--chart-eje',
      '--heat-0', '--heat-1', '--heat-2', '--heat-3', '--heat-4', '--prov-obs', '--prov-est-bg', '--prov-est-borde',
      '--prov-inf-bg', '--prov-inf-borde', '--prov-sin-borde', '--on-1', '--on-5', '--on-6', '--ok', '--okbg', '--warn', '--warnbg', '--bad', '--badbg', '--info', '--infobg', '--senal'];
    const oscuroPropio = variables(bloque(':root[data-theme="dark"] [data-ui="v2"].tema-neutro,'));
    for (const n of base) expect(oscuroPropio[n], `${n} falta en el bloque oscuro`).toBeDefined();
  });
});
