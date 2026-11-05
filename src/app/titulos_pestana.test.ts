/* eslint-disable security/detect-non-literal-fs-filename -- lee el árbol de FUENTE del propio repo; ninguna ruta viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// F7 / PV-05 (paridad con Vexa): toda página de producto lleva título de
// pestaña propio. Antes /admin tenía 0 de 53 y /dashboard 65 de 72; una
// pestaña sin título se lee igual que cualquier otra en la barra del
// navegador y no se distingue al tener varias abiertas.
// Excepciones: ninguna a propósito. Una página nueva sin `metadata` ni
// `generateMetadata` rompe esta prueba.
const RAICES = ['src/app/admin', 'src/app/dashboard', 'src/app/vendedor'];

function paginas(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return paginas(p);
    return n === 'page.tsx' ? [p] : [];
  });
}

describe('títulos de pestaña (PV-05)', () => {
  for (const raiz of RAICES) {
    const abs = join(process.cwd(), raiz);
    const lista = paginas(abs);
    it(`${raiz}: las ${lista.length} páginas exportan metadata o generateMetadata`, () => {
      const sin = lista
        .filter((f) => !/^export (const metadata\b|async function generateMetadata\b|function generateMetadata\b)/m.test(readFileSync(f, 'utf8')))
        .map((f) => relative(process.cwd(), f));
      expect(sin).toEqual([]);
    });
  }
});
