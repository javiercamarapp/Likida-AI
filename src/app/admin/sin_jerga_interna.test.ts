import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// R9: el superadmin no lee números de migración ni «Fase N del roadmap» en las pantallas. Se escanea el código SIN comentarios.
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : /\.tsx$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

describe('sin jerga interna visible en /admin', () => {
  it('ni «migración 0NNN» ni «Fase N del roadmap» en el marcado', () => {
    const malos: string[] = [];
    for (const f of archivos(__dirname)) {
      const s = sinComentarios(readFileSync(f, 'utf8'));
      if (/migraci[oó]n\s+0\d{3}|Fase\s+\d\s+del\s+roadmap|desde la 0\d{3}/i.test(s)) malos.push(f.replace(__dirname, ''));
    }
    expect(malos).toEqual([]);
  });
});
