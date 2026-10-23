/* eslint-disable security/detect-non-literal-fs-filename -- lee el árbol de FUENTE del propio repo; ninguna ruta viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// A37-S05-01 / A37-S06-01. El `requireSuperadmin()` del layout de /admin no
// basta: en Next un layout no se vuelve a ejecutar si la petición RSC declara
// que el cliente ya lo tiene, y muchas páginas leen con service role datos de
// TODAS las flotas. Cada page.tsx de /admin debe llamar su PROPIA puerta.
const RAIZ = join(process.cwd(), 'src/app/admin');

function paginas(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return paginas(p);
    return n === 'page.tsx' ? [p] : [];
  });
}

const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('A37-S05-01/S06-01 · toda página de /admin lleva su propia puerta', () => {
  const todas = paginas(RAIZ);
  it('hay páginas que revisar', () => expect(todas.length).toBeGreaterThan(40));
  it('cada page.tsx LLAMA requireSuperadmin* (en código, no en un comentario) (fail-closed, no solo el layout)', () => {
    const sin = todas
      .filter((f) => !/\brequireSuperadmin\w*\(/.test(sinComentarios(readFileSync(f, 'utf8'))))
      .map((f) => relative(process.cwd(), f));
    expect(sin).toEqual([]);
  });
});
