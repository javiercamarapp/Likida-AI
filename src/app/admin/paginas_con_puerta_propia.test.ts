/* eslint-disable security/detect-non-literal-fs-filename -- lee el árbol de FUENTE del propio repo; ninguna ruta viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// A37-S05-01 / A37-S06-01 / A39-S05-01. El `requireSuperadmin()` del layout de
// /admin no basta: en Next un layout no se vuelve a ejecutar si la petición RSC
// declara que el cliente ya lo tiene, y muchas páginas leen con service role
// datos de TODAS las flotas. Cada page.tsx de /admin debe llamar su PROPIA
// puerta EN EL RENDER (cuerpo del `export default`), no solo dentro de una
// acción `'use server'`: la versión anterior de esta prueba aceptaba el texto
// en cualquier parte del archivo y pasaba en vacío (A39-S06-01).
const RAIZ = join(process.cwd(), 'src/app/admin');

function paginas(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return paginas(p);
    return n === 'page.tsx' ? [p] : [];
  });
}

const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Índice del cierre que corresponde al `abre` de `desde` (ignora el contenido de comillas simples/dobles). */
function cierre(t: string, desde: number): number {
  const abre = t[desde];
  const cierra = abre === '(' ? ')' : abre === '{' ? '}' : ']';
  let prof = 0;
  for (let i = desde; i < t.length; i++) {
    const c = t[i];
    if (c === "'" || c === '"') {
      const q = c;
      i++;
      while (i < t.length && t[i] !== q) { if (t[i] === '\\') i++; i++; }
      continue;
    }
    if (c === abre) prof++;
    else if (c === cierra) { prof--; if (prof === 0) return i; }
  }
  return -1;
}

/**
 * Cuerpo del `export default function` sin los cuerpos de las funciones
 * `'use server'` anidadas, y sin lo que quede a más de un nivel de llaves (una
 * puerta dentro de un `if` o de un callback no cubre el render completo).
 */
export function cuerpoDelRender(fuente: string): string | null {
  const t = sinComentarios(fuente);
  const m = /export\s+default\s+(?:async\s+)?function\s*\w*\s*\(/.exec(t);
  if (!m) return null;
  const abreParams = m.index + m[0].length - 1;
  const cierraParams = cierre(t, abreParams);
  if (cierraParams < 0) return null;
  const abreCuerpo = t.indexOf('{', cierraParams);
  if (abreCuerpo < 0) return null;
  const cierraCuerpo = cierre(t, abreCuerpo);
  if (cierraCuerpo < 0) return null;
  const cuerpo = t.slice(abreCuerpo + 1, cierraCuerpo);
  let salida = '';
  let prof = 0;
  for (let i = 0; i < cuerpo.length; i++) {
    const c = cuerpo[i];
    if (c === '{') {
      prof++;
      continue;
    }
    if (c === '}') { prof--; continue; }
    if (prof === 0) salida += c;
  }
  return salida;
}

describe('A37-S05-01/S06-01 · toda página de /admin lleva su propia puerta', () => {
  const todas = paginas(RAIZ);
  it('hay páginas que revisar', () => expect(todas.length).toBeGreaterThan(40));
  it('cada page.tsx LLAMA requireSuperadmin* en el RENDER (no solo en una acción ni en un comentario) (fail-closed, no solo el layout)', () => {
    const sin = todas
      .filter((f) => {
        const cuerpo = cuerpoDelRender(readFileSync(f, 'utf8'));
        return cuerpo === null || !/\brequireSuperadmin\w*\(/.test(cuerpo);
      })
      .map((f) => relative(process.cwd(), f));
    expect(sin).toEqual([]);
  });

  it('el detector no pasa en vacío: una acción con la puerta NO cubre el render', () => {
    const fuente = [
      'export default async function P() {',
      '  const datos = await leerTodo();',
      '  async function accion() { \'use server\'; await requireSuperadmin(); }',
      '  return null;',
      '}',
    ].join('\n');
    expect(/\brequireSuperadmin\w*\(/.test(cuerpoDelRender(fuente) ?? '')).toBe(false);
    const buena = 'export default async function P({ a }: { a: string }) {\n  await requireSuperadmin();\n  return null;\n}';
    expect(/\brequireSuperadmin\w*\(/.test(cuerpoDelRender(buena) ?? '')).toBe(true);
  });
});
