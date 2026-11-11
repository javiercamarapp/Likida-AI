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
  // Identidad Rovaq (10-nov-2026): el contenido va sobre el fondo hundido (--ui-sunken) y el tooltip es tarjeta (superficie/tinta).
  ['--ink', '--ui-sunken'], ['--ink2', '--ui-sunken'], ['--muted', '--ui-sunken'], ['--tip-fg', '--tip-bg'],
  // Azul de Rovaq (7-nov-2026): estado activo de segmentados/chips/filtros y acción primaria del cajón, en reposo y en hover.
  ['--seg-activo-fg', '--seg-activo-bg'], ['--seg-activo-fg', '--seg-activo-hover'],
  ['--accion-cajon-fg', '--accion-cajon-bg'], ['--accion-cajon-fg', '--accion-cajon-hover'],
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

  // PALETA DE ALTO CONTRASTE (11-nov-2026, punto 10 del dueño): las series DURAS (1, 2, 3, 5, 7) miden ≥3:1 sobre la tarjeta y sobre el fondo.
  it.each([1, 2, 3, 5, 7])('--chart-%i sobre --surface y --bg (series duras)', (n) => {
    for (const fondo of ['--surface', '--bg']) {
      const r = contraste(resolver(t, `--chart-${n}`), resolver(t, fondo));
      expect(r, `--chart-${n} sobre ${fondo} mide ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_COMPONENTE);
    }
  });
  // Las series CLARAS (4, 6, 8) se identifican por contorno: --chart-borde (≥3:1) las delimita.
  it('--chart-borde (contorno de las series claras) sobre --surface y --bg', () => {
    for (const fondo of ['--surface', '--bg']) {
      const r = contraste(resolver(t, '--chart-borde'), resolver(t, fondo));
      expect(r, `--chart-borde sobre ${fondo} mide ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_COMPONENTE);
    }
  });
  it('--kpi-filete (filete de las tiras de KPI) sobre --surface', () => {
    expect(contraste(resolver(t, '--kpi-filete'), resolver(t, '--surface'))).toBeGreaterThanOrEqual(AA_COMPONENTE);
  });
  it('la barra del ítem activo contrasta con el fondo del menú y con el contenido', () => {
    for (const fondo of ['--surface', '--ui-activo-bg', '--bg']) {
      expect(contraste(resolver(t, '--nav-activo-barra'), resolver(t, fondo))).toBeGreaterThanOrEqual(AA_COMPONENTE);
    }
  });
  it('el anillo del estado activo (--seg-activo-borde) contrasta ≥3:1 con la superficie y su fondo', () => {
    for (const fondo of ['--surface', '--seg-activo-bg']) {
      expect(contraste(resolver(t, '--seg-activo-borde'), resolver(t, fondo))).toBeGreaterThanOrEqual(AA_COMPONENTE);
    }
  });
  // Texto de cabecera de tabla NEGRO (claro) / blanco (oscuro): contraste alto, no solo AA.
  it('la cabecera de tabla pasa AAA (≥7:1) y el texto es la tinta pura', () => {
    expect(contraste(resolver(t, '--tabla-cab-ink'), resolver(t, '--tabla-cab-bg'))).toBeGreaterThanOrEqual(7);
    expect(resolver(t, '--tabla-cab-ink')).toBe(resolver(t, '--ink'));
  });
  // Semáforos como MARCA (no solo texto): 1.4.11 ≥3:1 sobre la tarjeta; siempre acompañados de texto o icono (1.4.1).
  it.each(['--ok', '--warn', '--bad'])('semáforo %s como marca sobre --surface', (v) => {
    expect(contraste(resolver(t, v), resolver(t, '--surface'))).toBeGreaterThanOrEqual(AA_COMPONENTE);
  });
});

describe('tokens v2: la paleta de datos y del cromo es monocroma', () => {
  // Decisión del dueño (11-nov-2026): NEGRO, GRIS y BLANCO; sin azul, teal ni naranja en las series. Solo los semáforos y la señal llevan matiz.
  const matiz = (hex: string) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return Math.max(...c) - Math.min(...c); };
  const FAMILIAS = ['chart', 'soft', 'ink', 'on'];
  it.each(TEMAS)('modo %s: --chart/--soft/--ink/--on-N, --heat-N y el cromo activo son grises (diferencia entre canales ≤ 8)', (_n, t) => {
    const nombres = [
      ...FAMILIAS.flatMap((f) => [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `--${f}-${n}`)),
      ...[0, 1, 2, 3, 4].map((n) => `--heat-${n}`),
      '--chart-borde', '--kpi-filete', '--nav-activo-barra', '--seg-activo-bg', '--seg-activo-borde', '--seg-activo-fg', '--seg-activo-hover',
      '--tabla-cab-bg', '--tabla-cab-ink', '--g1', '--g2', '--g3', '--g4', '--g5',
    ];
    for (const n of nombres) expect(matiz(resolver(t, n)), `${n} = ${resolver(t, n)} no es gris`).toBeLessThanOrEqual(8);
  });
  it('las 8 series claras y oscuras son distintas entre sí (ninguna repetida) y las vecinas difieren en luminosidad ≥1.25:1', () => {
    for (const [, t] of TEMAS) {
      const hex = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => resolver(t, `--chart-${n}`));
      expect(new Set(hex).size).toBe(8);
      for (let n = 0; n < 7; n++) expect(contraste(hex[n], hex[n + 1]), `${hex[n]} vs ${hex[n + 1]}`).toBeGreaterThanOrEqual(1.25);
    }
  });
});

describe('tokens v2: cobertura', () => {
  it('el oscuro redefine todo color base (si no, hereda un valor pensado para el claro)', () => {
    const base = ['--bg', '--surface', '--canvas', '--ink', '--ink2', '--muted', '--faint', '--line', '--line2', '--input',
      '--marca', '--marca-fg', '--btn-bg', '--btn-borde', '--btn-hover', '--btn-soft', '--btn-soft-fg', '--ui-elevated',
      '--carga-fondo', '--ui-sunken', '--tabla-cab-bg', '--chart-barra', '--chart-fuerte', '--chart-rejilla', '--chart-eje',
      '--heat-0', '--heat-1', '--heat-2', '--heat-3', '--heat-4', '--prov-obs', '--prov-est-bg', '--prov-est-borde',
      '--prov-inf-bg', '--prov-inf-borde', '--prov-sin-borde', '--on-1', '--on-5', '--on-6', '--ok', '--okbg', '--warn', '--warnbg', '--bad', '--badbg', '--info', '--infobg', '--senal'];
    const oscuroPropio = variables(bloque(':root[data-theme="dark"] [data-ui="v2"].tema-neutro,'));
    for (const n of base) expect(oscuroPropio[n], `${n} falta en el bloque oscuro`).toBeDefined();
  });
});
