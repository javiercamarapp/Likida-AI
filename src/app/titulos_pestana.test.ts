/* eslint-disable security/detect-non-literal-fs-filename -- lee el árbol de FUENTE del propio repo; ninguna ruta viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

// F7 / PV-05 (paridad con Vexa): toda página lleva título de pestaña propio. Antes /admin tenía 0 de
// 53 y /dashboard 65 de 72; una pestaña sin título se lee igual que cualquier otra en la barra del
// navegador y no se distingue al tener varias abiertas.
//
// R4: la prueba cubre TODAS las áreas con `page.tsx` bajo src/app (hoy: admin, dashboard, vendedor,
// aviso, blog, pago, mcp, login, cuenta, demo, sin-acceso, privacidad, terminos…), no solo tres. Una
// página tiene título si ella misma exporta `metadata`/`generateMetadata`, o si lo hace un
// `layout.tsx` de su cadena DEBAJO de la raíz (caso de /demo, cuya página es 'use client' y Next no
// deja exportar metadata desde ahí). La home (`/`) hereda el título del layout raíz, que también se
// verifica. Excepciones: ninguna a propósito; una página nueva sin título rompe esta prueba.
const SRC_APP = join(process.cwd(), 'src/app');
const EXPORTA_TITULO = /^export (const metadata\b|async function generateMetadata\b|function generateMetadata\b)/m;

function paginas(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return paginas(p);
    return n === 'page.tsx' ? [p] : [];
  });
}

function tieneTitulo(pagina: string): boolean {
  if (EXPORTA_TITULO.test(readFileSync(pagina, 'utf8'))) return true;
  // Layouts de la cadena, de la carpeta de la página hacia arriba, SIN contar la raíz.
  for (let d = dirname(pagina); d !== SRC_APP; d = dirname(d)) {
    const layout = join(d, 'layout.tsx');
    if (existsSync(layout) && EXPORTA_TITULO.test(readFileSync(layout, 'utf8'))) return true;
  }
  return false;
}

const todas = paginas(SRC_APP);
const area = (f: string) => relative(SRC_APP, f).split(sep).slice(0, -1)[0] ?? '(raíz)';
const areas = [...new Set(todas.map(area))].sort();

describe('títulos de pestaña (PV-05)', () => {
  it('la prueba ve todas las áreas del producto (no solo tres)', () => {
    expect(todas.length).toBeGreaterThan(100);
    for (const a of ['admin', 'dashboard', 'vendedor', 'login', 'cuenta', 'demo', 'sin-acceso', 'mcp', 'pago', 'blog', 'aviso']) {
      expect(areas, a).toContain(a);
    }
  });

  for (const a of areas) {
    const lista = todas.filter((f) => area(f) === a && !(a === '(raíz)'));
    if (lista.length === 0) continue;
    it(`/${a}: las ${lista.length} páginas tienen título de pestaña propio`, () => {
      const sin = lista.filter((f) => !tieneTitulo(f)).map((f) => relative(process.cwd(), f));
      expect(sin).toEqual([]);
    });
  }

  it('la home hereda el título del layout raíz, y ese título existe', () => {
    expect(readFileSync(join(SRC_APP, 'layout.tsx'), 'utf8')).toMatch(/export const metadata[^=]*=\s*\{\s*[^}]*title:/s);
  });
});
