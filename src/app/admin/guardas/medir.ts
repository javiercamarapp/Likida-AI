/* eslint-disable security/detect-non-literal-fs-filename -- recorre el árbol de FUENTE del propio repo; ninguna ruta viene de entrada de usuario. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REDIRECCIONES_308 } from './redirecciones_308';

// Medidores compartidos por las guardas de trinquete de /admin (Fase 0, K3). Cada guarda tiene una línea base MEDIDA (`base.ts`) que
// solo puede BAJAR: un archivo nuevo no entra, un conteo no sube, y un archivo que ya quedó limpio se borra de la base.

export const SRC = join(process.cwd(), 'src');
export const ADMIN = join(SRC, 'app/admin');

export function archivos(dir: string, ext: RegExp, salida: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const r = join(dir, n);
    if (statSync(r).isDirectory()) {
      if (n !== 'node_modules' && n !== '__fixtures__') archivos(r, ext, salida);
      continue;
    }
    if (ext.test(n) && !/\.(test|nav|tmp)\.|harness/.test(n)) salida.push(r);
  }
  return salida;
}

export const ruta = (f: string): string => relative(SRC, f);
export const leer = (f: string): string => readFileSync(f, 'utf8');
export const sinComentarios = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const cuenta = (t: string, re: RegExp): number => (t.match(re) ?? []).length;

// ── una_barra_de_pestanas ──────────────────────────────────────────────────
/** Barras de pestañas propias: `<TabsLinea`, `<Tabs`, `<PestanasHub` o un `role="tablist"` a mano. La única permitida es la automática. */
export function barrasDePestanas(src: string): number {
  const t = sinComentarios(src);
  return cuenta(t, /<(TabsLinea|Tabs|PestanasHub)(?=[\s/>])/g) + cuenta(t, /role=["']tablist["']/g);
}

// ── admin_encabezados_contrato ─────────────────────────────────────────────
export const barraPagina = (src: string): number => cuenta(sinComentarios(src), /<BarraPagina(?=[\s/>])/g);
export const h1Propio = (src: string): number => cuenta(sinComentarios(src), /<h1(?=[\s/>])/g);
export const marcosDePagina = (src: string): number => cuenta(sinComentarios(src), /<MarcoPagina(?=[\s/>])/g);
/** `apoyo` escrito como literal con más de 140 caracteres (los dinámicos no se pueden medir aquí). */
export function apoyosLargos(src: string): number {
  let n = 0;
  for (const m of sinComentarios(src).matchAll(/apoyo=(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`$]*)`)\s*\})/g)) {
    if ((m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '').length > 140) n++;
  }
  return n;
}

/** Directorios de ruta (con `page.tsx`) y los `.tsx` que viven directamente en cada uno. Los stubs 308 (`REDIRECCIONES_308`) no cuentan:
 *  no son pantallas, solo guardan la dirección vieja, y su guarda propia es `redirecciones_308`. */
export function rutasConArchivos(): Array<{ dir: string; paginas: string[] }> {
  const salida: Array<{ dir: string; paginas: string[] }> = [];
  const stubs = new Set(Object.keys(REDIRECCIONES_308).map((d) => `app${d}`));
  const visita = (dir: string) => {
    const hijos = readdirSync(dir);
    if (hijos.includes('page.tsx') && !stubs.has(ruta(dir))) {
      salida.push({ dir: ruta(dir), paginas: hijos.filter((n) => n.endsWith('.tsx') && !/\.(test|nav|tmp)\./.test(n)).map((n) => join(dir, n)) });
    }
    for (const n of hijos) { const r = join(dir, n); if (statSync(r).isDirectory()) visita(r); }
  };
  visita(ADMIN);
  return salida;
}

// ── admin_paginas_en_menu ──────────────────────────────────────────────────
/** Direcciones estáticas de /admin (una por `page.tsx` sin segmentos dinámicos). Los grupos `(x)` no cuentan en la dirección. */
export function direccionesEstaticas(): string[] {
  return rutasConArchivos()
    .map(({ dir }) => dir.replace(/^app/, '').replace(/\/\([^/]+\)/g, ''))
    .filter((d) => !/\[|\]/.test(d))
    .sort();
}

// ── sin_emojis_en_producto ─────────────────────────────────────────────────
/** Emoji de verdad (presentación gráfica, o pictograma con selector FE0F). No marca ©, ™, flechas ni ✓/✗ de texto. */
export const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/gu;
export const emojis = (src: string): number => cuenta(src, EMOJI);

// ── Trinquete ──────────────────────────────────────────────────────────────
/** Compara lo medido con la base y devuelve los problemas: subió, entró nuevo, o quedó limpio y sigue listado. */
export function problemasDeTrinquete(medido: Record<string, number>, base: Record<string, number>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(medido)) {
    if (v <= 0) continue;
    const tope = base[k];
    if (tope === undefined) out.push(`${k}: ${v} (archivo nuevo, no entra a la base)`);
    else if (v > tope) out.push(`${k}: ${v} > base ${tope}`);
  }
  for (const [k, tope] of Object.entries(base)) {
    const v = medido[k] ?? 0;
    if (v < tope) out.push(`${k}: ahora ${v} y la base dice ${tope}; BAJA la base (GENERAR_BASE_GUARDAS_ADMIN=1)`);
  }
  return out;
}

// ── Mediciones completas (las usan las guardas y el generador de la base) ──
const soloSi = (r: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(r).filter(([, v]) => v > 0));

export function medirPestanas(): Record<string, number> {
  const r: Record<string, number> = {};
  // La barra automática vive en pestanas-admin.tsx (la monta chrome.tsx) y las primitivas en ui-v2: ahí SÍ se definen.
  for (const f of archivos(ADMIN, /\.tsx$/)) if (!f.endsWith('/pestanas-admin.tsx')) r[ruta(f)] = barrasDePestanas(leer(f));
  return soloSi(r);
}

export function medirEncabezados() {
  const barra: Record<string, number> = {};
  const h1: Record<string, number> = {};
  const apoyo: Record<string, number> = {};
  const marcosMultiples: Record<string, number> = {};
  for (const f of archivos(ADMIN, /\.tsx$/)) {
    const s = leer(f);
    barra[ruta(f)] = barraPagina(s);
    h1[ruta(f)] = h1Propio(s);
    apoyo[ruta(f)] = apoyosLargos(s);
  }
  const sinMarco: string[] = [];
  for (const { dir, paginas } of rutasConArchivos()) {
    const marcos = paginas.reduce((n, f) => n + marcosDePagina(leer(f)), 0);
    if (marcos === 0) sinMarco.push(dir);
    if (marcos > 1) marcosMultiples[dir] = marcos - 1;
  }
  return { barra: soloSi(barra), h1: soloSi(h1), apoyo: soloSi(apoyo), marcosMultiples, sinMarco: sinMarco.sort() };
}

export function medirEmojis(): Record<string, number> {
  const r: Record<string, number> = {};
  for (const f of [...archivos(join(SRC, 'app'), /\.(ts|tsx)$/), ...archivos(join(SRC, 'lib'), /\.(ts|tsx)$/)]) r[ruta(f)] = emojis(leer(f));
  return soloSi(r);
}
