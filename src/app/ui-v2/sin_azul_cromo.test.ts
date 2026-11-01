/* eslint-disable security/detect-non-literal-fs-filename -- la guarda recorre el árbol propio del repo (rutas fijas de src/app), nunca entrada externa */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// GUARDA «SIN AZUL DE INTERFAZ» (L9a, decisión de Javier 31-oct-2026: «lo azul, por la paleta negro/gris/blanco»).
//
// El cromo de v2 (todo `ui-v2` salvo las gráficas), `dashboard/shell`, /login y TODAS las páginas públicas no pueden tener azul:
// ni clases de Tailwind blue/sky/indigo/cyan/violet/navy/teal, ni nombres CSS de color azul (`blue`, `navy`, `steelblue`…), ni los
// azules históricos (#0B5FFF, #1F4FB0), ni un hex, `rgb()` o `hsl()` de matiz azul. El azul SOLO vive en los colores de DATOS: la serie
// de 8 matices (`--chart-N`, `--soft-N`, `--ink-N`, `--on-N`, `--region-*` del mapa), las gráficas y el logotipo de Google (obligatorio por su marca).
//
// El ALCANCE ES DERIVADO (recorrido del árbol), no una lista a mano: una página pública nueva entra sola.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = join(__dirname, '..');

/** Carpetas de `src/app` que NO son páginas públicas ni cromo v2 (paneles autenticados y APIs): quedan fuera del alcance. */
const FUERA_DE_ALCANCE_RAIZ = new Set(['admin', 'dashboard', 'vendedor', 'api', 'ui-v2']);
/** Dentro de `ui-v2`: gráficas y arte son DATOS. */
const DATOS_UI_V2 = /^ui-v2\/(graficas|svg)(\/|\.|$)/;

function recorrer(dir: string, salida: string[] = []): string[] {
  for (const n of readdirSync(join(RAIZ, dir))) {
    const rel = dir ? `${dir}/${n}` : n;
    if (statSync(join(RAIZ, rel)).isDirectory()) {
      if (n === '__fixtures__' || n === 'node_modules') continue;
      recorrer(rel, salida);
    } else if (/\.(tsx|css)$/.test(n) && !/\.test\./.test(n) && !/\.d\.ts$/.test(n)) salida.push(rel);
  }
  return salida;
}

function alcance(): string[] {
  const todos = recorrer('');
  return todos.filter((f) => {
    const [primero] = f.split('/');
    if (f.startsWith('ui-v2/')) return !DATOS_UI_V2.test(f);
    if (f.startsWith('dashboard/shell/')) return true;
    return !FUERA_DE_ALCANCE_RAIZ.has(primero);
  });
}

const TAILWIND_AZUL = /\b(?:text|bg|border|ring|from|to|via|fill|stroke|outline|decoration|divide|accent|shadow|placeholder|caret)-(?:blue|sky|indigo|cyan|violet|navy|teal)-\d{2,3}\b/;
const NOMBRES_AZUL = /--(?:marino|azul|petroleo|tint-azul)\b|#0b5fff|#1f4fb0/i;
/** Nombres de color CSS de matiz azul, como VALOR (propiedad CSS o cadena de estilo en TSX). */
const NOMBRE_AZUL = /\b(?:blue|navy|royalblue|dodgerblue|skyblue|lightskyblue|steelblue|lightsteelblue|deepskyblue|cornflowerblue|mediumblue|darkblue|midnightblue|slateblue|darkslateblue|aliceblue|cadetblue|lightblue|powderblue|cyan|darkcyan|teal|indigo|mediumslateblue)\b/i;
/** Texto donde un nombre de color puede ser VALOR: lo que sigue a `:` en CSS, o las cadenas entre comillas en TSX. */
function valores(l: string, css: boolean): string[] {
  if (css) return l.includes(':') ? [l.slice(l.indexOf(':') + 1)] : [];
  return [...l.matchAll(/(['"`])([^'"`]*)\1/g)].map((m) => m[2]);
}
// Línea de la serie de datos (permitida): `--chart-1: …`, `--soft-3: …`, `--ink-5: …`, `--on-2: …`.
const SERIE_DATOS = /--(?:chart|soft|ink|on)-\d\s*:|--region-[a-z]+\s*:/;
// Marca de terceros que no se puede recolorear (logotipo de Google).
const MARCA_TERCEROS = /#4285F4/;

/** Tono (0..1) y saturación (0..1) desde RGB 0..1. */
function tonoSat(r: number, g: number, b: number): { tono: number; sat: number; max: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return { tono: 0, sat: 0, max };
  let tono: number;
  if (max === r) tono = (((g - b) / (max - min)) % 6) / 6;
  else if (max === g) tono = ((b - r) / (max - min) + 2) / 6;
  else tono = ((r - g) / (max - min) + 4) / 6;
  if (tono < 0) tono += 1;
  return { tono, sat: (max - min) / max, max };
}
const esAzul = ({ tono, sat, max }: { tono: number; sat: number; max: number }) => tono >= 0.5 && tono <= 0.72 && sat >= 0.22 && max > 0.2;

function esHexAzul(hex: string): boolean {
  const h = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return esAzul(tonoSat(r, g, b));
}
function esRgbAzul(args: string): boolean {
  const n = args.split(/[\s,/]+/).filter(Boolean).slice(0, 3).map((v) => (v.endsWith('%') ? (parseFloat(v) / 100) : parseFloat(v) / 255));
  return n.length === 3 && n.every((x) => Number.isFinite(x)) && esAzul(tonoSat(n[0], n[1], n[2]));
}
function esHslAzul(args: string): boolean {
  const [h, s, l] = args.split(/[\s,/]+/).filter(Boolean).slice(0, 3).map((v) => parseFloat(v));
  if (![h, s, l].every(Number.isFinite)) return false;
  return h >= 180 && h <= 260 && s >= 22 && l > 8;
}

/** Quita comentarios (bloque y línea) conservando los saltos de línea, para que los números de línea no se muevan. */
function sinComentarios(texto: string, css: boolean): string {
  const quitar = (m: string) => m.replace(/[^\n]/g, ' ');
  let t = texto.replace(/\/\*[\s\S]*?\*\//g, quitar);
  if (!css) t = t.replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + quitar(m.slice(p.length)));
  return t;
}

export function culpablesDe(f: string, fuente: string): string[] {
  const css = f.endsWith('.css');
  const lineas = sinComentarios(fuente, css).split('\n');
  const culpables: string[] = [];
  lineas.forEach((l, i) => {
    if (SERIE_DATOS.test(l)) return;
    const donde = `${f}:${i + 1}`;
    if (TAILWIND_AZUL.test(l)) culpables.push(`${donde} clase de Tailwind azul`);
    if (NOMBRES_AZUL.test(l)) culpables.push(`${donde} nombre/valor de azul histórico`);
    if (valores(l, css).some((v) => NOMBRE_AZUL.test(v))) culpables.push(`${donde} nombre de color CSS azul`);
    const sinMarca = l.replace(MARCA_TERCEROS, '');
    for (const m of sinMarca.matchAll(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
      // En .tsx los comentarios citan incidencias («#124»): ahí solo se mira el hex de 6 u 8 dígitos.
      if (!css && m[1].length === 3) continue;
      if (esHexAzul(m[1])) culpables.push(`${donde} ${m[0]} tiene matiz azul`);
    }
    for (const m of sinMarca.matchAll(/rgba?\(([^)]*)\)/gi)) if (esRgbAzul(m[1])) culpables.push(`${donde} ${m[0]} tiene matiz azul`);
    for (const m of sinMarca.matchAll(/hsla?\(([^)]*)\)/gi)) if (esHslAzul(m[1])) culpables.push(`${donde} ${m[0]} tiene matiz azul`);
  });
  return culpables;
}

describe('sin azul de interfaz en el cromo v2, /login y las páginas públicas', () => {
  const todos = alcance();

  it('el alcance derivado cubre lo que debe (login, marco público, tokens, shell, páginas públicas) y excluye paneles y gráficas', () => {
    for (const f of ['login/login.css', 'login/vista-login.tsx', 'ui-v2/tokens.css', 'ui-v2/marco-publico.css', 'ui-v2/componentes/marco-publico.tsx',
      'sin-acceso/page.tsx', 'privacidad/page.tsx', 'pago/[token]/page.tsx', 'mcp/autorizar/page.tsx', 'not-found.tsx', 'global-error.tsx']) {
      expect(todos, f).toContain(f);
    }
    expect(todos.some((f) => f.startsWith('admin/') || f.startsWith('vendedor/') || f.startsWith('api/'))).toBe(false);
    expect(todos.some((f) => f.startsWith('dashboard/') && !f.startsWith('dashboard/shell/'))).toBe(false);
    expect(todos.some((f) => DATOS_UI_V2.test(f))).toBe(false);
    expect(todos.length).toBeGreaterThan(60);
  });

  for (const f of todos) {
    it(`${f}: sin azul de interfaz`, () => {
      const culpables = culpablesDe(f, readFileSync(join(RAIZ, f), 'utf8'));
      expect(culpables, culpables.join('\n')).toEqual([]);
    });
  }

  it('el detector no está ciego: ve hex, rgb(), hsl(), nombres CSS y clases de Tailwind azules, y deja pasar los grises', () => {
    const sucio = [
      '.a { color: #1f4fb0; }', '.b { background: rgb(30, 80, 200); }', '.c { color: hsl(220 60% 40%); }',
      '.d { border-color: steelblue; }', 'const c = "text-blue-600";', ".e { background: rgba(37 99 235 / .4); }",
    ];
    for (const l of sucio) expect(culpablesDe('x.css', l).length, l).toBeGreaterThan(0);
    for (const l of ['.a { color: #3a3a40; }', '.b { background: rgb(14 14 16 / .5); }', '.c { color: hsl(0 0% 40%); }', '.d { color: var(--ink); }', '/* blue */ .e { }']) {
      expect(culpablesDe('x.css', l), l).toEqual([]);
    }
  });
});
