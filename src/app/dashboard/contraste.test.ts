import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// EL CONTRASTE SE MIDE, NO SE RECUERDA.
//
// La ronda 3 midió y corrigió `--color-bad`. La ronda 5 encontró que
// `--color-ok` —el color de las cuatro cifras acreditables del detalle: "IVA
// acreditable $12,480"— seguía en 2.22:1 sobre blanco, por debajo del 3:1 que
// AA pide hasta para texto grande. El problema no fue el arreglo anterior: fue
// que se auditó UN token en vez de la lista de tokens que se usan como tinta.
//
// Esta prueba lee `globals.css` y mide los tres tokens con significado en los
// dos modos. Un token nuevo con mal contraste, o un cambio de paleta que rompa
// uno viejo, falla aquí y no en la sala con el proyector encendido.
// ═══════════════════════════════════════════════════════════════════════════

const CSS = readFileSync(
  fileURLToPath(new URL('../globals.css', import.meta.url)),
  'utf8',
);

/** Luminancia relativa (WCAG 2.1, 1.4.3). */
function luminancia(hex: string): number {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function contraste(a: string, b: string): number {
  const [alto, bajo] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (alto + 0.05) / (bajo + 0.05);
}

/**
 * Lee el valor de una variable dentro de un bloque de `globals.css`.
 *
 * Se lee del archivo y no de una constante duplicada a propósito: una copia en
 * el test se queda vieja en silencio y entonces la prueba mide un color que ya
 * no se sirve.
 */
function token(bloque: string, nombre: string): string {
  const i = CSS.indexOf(bloque);
  expect(i, `no encontré el bloque "${bloque}" en globals.css`).toBeGreaterThan(-1);
  const cuerpo = CSS.slice(i, CSS.indexOf('}', CSS.indexOf('{', i + bloque.length)) + 1);
  const m = cuerpo.match(new RegExp(`${nombre}:\\s*(#[0-9a-fA-F]{6})`));
  expect(m, `no encontré ${nombre} dentro de "${bloque}"`).not.toBeNull();
  return m![1].toLowerCase();
}

// AA: 4.5:1 para texto normal, 3:1 para texto grande (≥24px o ≥19px en negrita).
// Las cifras del panel son `text-3xl`/`text-5xl`, pero se exige el umbral de
// texto normal porque los mismos tokens pintan etiquetas chicas (el error del
// login va en `text-xs` con `--color-bad`).
const AA_TEXTO = 4.5;

describe('modo claro: lo que se proyecta en la sala', () => {
  const SUPERFICIE = '#ffffff'; // --surface, el fondo de las tarjetas
  const FONDO = '#fbfbfd';      // --bg

  it('--color-ok pasa AA como TINTA (era 2.22:1: la cifra menos legible de la pantalla)', () => {
    const ok = token(':root[data-theme="light"]', '--color-ok');
    expect(contraste(ok, SUPERFICIE)).toBeGreaterThanOrEqual(AA_TEXTO);
    expect(contraste(ok, FONDO)).toBeGreaterThanOrEqual(AA_TEXTO);
  });

  it('--color-bad sigue pasando (cerrado en la ronda 3, no se puede desandar)', () => {
    const bad = token(':root[data-theme="light"]', '--color-bad');
    expect(contraste(bad, SUPERFICIE)).toBeGreaterThanOrEqual(AA_TEXTO);
  });

  it('el default del tema (@theme) es el mismo que el del bloque claro', () => {
    // Si divergen, quien no fuerza `data-theme` ve un color distinto del medido.
    expect(token('@theme', '--color-ok')).toBe(token(':root[data-theme="light"]', '--color-ok'));
    expect(token('@theme', '--color-bad')).toBe(token(':root[data-theme="light"]', '--color-bad'));
  });

  // ═════════════════════════════════════════════════════════════════════════
  // AUDITORÍA 10, MEDIO — "las citas legales están a 2.56:1". `--faint`
  // (#a1a1aa) medía 2.56:1 contra blanco, muy por debajo del 4.5:1 de AA — y
  // pinta texto de 12px o menos en 40 sitios: notas de KpiTile, subtítulos
  // de ChartCard, citas legales ("LIF 2026, Art. 20-A"), ejes de gráfica.
  // Ninguno es "texto grande" (≥24px), así que ninguno tiene la excepción de
  // 3:1 — todos necesitan el umbral completo. `--faint` vive en el bloque
  // `:root { }` (no en `[data-theme="light/dark"]`, a diferencia de
  // --color-ok/--color-bad), así que se lee de ahí directamente.
  // ═════════════════════════════════════════════════════════════════════════
  it('--faint pasa AA como texto (era 2.56:1 — notas, citas legales, ejes de gráfica)', () => {
    const faint = token(':root', '--faint');
    expect(contraste(faint, SUPERFICIE)).toBeGreaterThanOrEqual(AA_TEXTO);
    expect(contraste(faint, FONDO)).toBeGreaterThanOrEqual(AA_TEXTO);
  });

  it('--faint se queda MÁS CLARO que --muted — conserva la jerarquía visual', () => {
    // No es solo "que pase AA": si quedara igual o más oscuro que --muted,
    // dejaría de leerse como el nivel MÁS secundario de los dos. `--muted`
    // dentro de `:root {}` es `var(--color-muted)` (no un hex directo), así
    // que el valor real se lee de `@theme`, donde SÍ está en hex.
    const faint = token(':root', '--faint');
    const muted = token('@theme', '--color-muted');
    expect(contraste(faint, SUPERFICIE)).toBeLessThan(contraste(muted, SUPERFICIE));
  });
});

describe('modo oscuro: el mismo token, el otro color', () => {
  const SUPERFICIE = '#16161c';

  it('--color-ok pasa AA sobre superficie oscura', () => {
    const ok = token(':root[data-theme="dark"]', '--color-ok');
    expect(contraste(ok, SUPERFICIE)).toBeGreaterThanOrEqual(AA_TEXTO);
  });

  it('--color-bad pasa AA sobre superficie oscura', () => {
    const bad = token(':root[data-theme="dark"]', '--color-bad');
    expect(contraste(bad, SUPERFICIE)).toBeGreaterThanOrEqual(AA_TEXTO);
  });

  it('cada modo tiene SU verde: sin override, el del otro modo reprueba', () => {
    const claro = token(':root[data-theme="light"]', '--color-ok');
    const oscuro = token(':root[data-theme="dark"]', '--color-ok');
    expect(claro).not.toBe(oscuro);
    // La razón de que hagan falta dos: cada uno reprueba en el modo contrario.
    expect(contraste(claro, SUPERFICIE)).toBeLessThan(3);
    expect(contraste(oscuro, '#ffffff')).toBeLessThan(3);
  });

  // La prueba de "el override automático (prefers-color-scheme) dice lo mismo
  // que data-theme" se quitó con el bloque `@media (prefers-color-scheme:
  // dark)` mismo (docs/superpowers/plans/2026-08-02-roles-flota.md): el panel
  // cambiaba a oscuro solo por el sistema operativo del contralor, sin que
  // nadie en Likida lo hubiera pedido, y así se veía "todo negro" sin
  // decisión. El estilo de referencia (usehandle.ai) no tiene modo oscuro. El
  // bloque `[data-theme="dark"]` se conserva por si algún día hay un switch
  // manual — eso sí seguiría midiéndose arriba.
});
