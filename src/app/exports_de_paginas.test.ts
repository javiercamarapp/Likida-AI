/* eslint-disable security/detect-non-literal-fs-filename, security/detect-unsafe-regex -- rutas del propio repo y regex sobre código fuente propio (no entrada de usuario) */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Una page.tsx / layout.tsx solo puede exportar lo que Next conoce. Cualquier
// otro nombre (p. ej. `export function quienDe`) pasa vitest y tsc normal, pero
// `next build` lo rechaza ("Property 'x' is incompatible with index signature")
// y la rama no se puede desplegar. Pasó con admin/bitacora/page.tsx (10-nov-2026).
// Los helpers viven en un archivo hermano.

const PERMITIDOS = new Set([
  'default', 'metadata', 'generateMetadata', 'viewport', 'generateViewport', 'dynamic', 'revalidate',
  'fetchCache', 'runtime', 'preferredRegion', 'maxDuration', 'generateStaticParams', 'dynamicParams',
]);

function archivos(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivos(ruta, salida);
    else if (e.name === 'page.tsx' || e.name === 'layout.tsx') salida.push(ruta);
  }
  return salida;
}

/** Nombres de valor exportados (los `export type/interface` se borran al compilar y no cuentan). */
function exportsDeValor(fuente: string): string[] {
  const nombres: string[] = [];
  const sinComentarios = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const m of sinComentarios.matchAll(/^export\s+default\b/gm)) nombres.push(m[0] && 'default');
  for (const m of sinComentarios.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class|enum)\s+([A-Za-z_$][\w$]*)/gm)) nombres.push(m[1]);
  for (const m of sinComentarios.matchAll(/^export\s+(?!type\b)\{([^}]*)\}/gm)) {
    for (const parte of m[1].split(',')) {
      const t = parte.trim();
      if (!t || t.startsWith('type ')) continue;
      nombres.push(t.split(/\s+as\s+/).pop()!.trim());
    }
  }
  return nombres;
}

describe('page.tsx y layout.tsx solo exportan lo que Next permite', () => {
  it('ninguno exporta helpers (rompen next build)', () => {
    const malos: string[] = [];
    for (const f of archivos(join(process.cwd(), 'src', 'app'))) {
      for (const n of exportsDeValor(readFileSync(f, 'utf8'))) {
        if (!PERMITIDOS.has(n)) malos.push(`${f.replace(process.cwd() + '/', '')}: ${n}`);
      }
    }
    expect(malos).toEqual([]);
  });

  it('el detector sí ve un export no permitido', () => {
    expect(exportsDeValor('export function quienDe() {}\nexport default function P() {}')).toEqual(['default', 'quienDe']);
    expect(exportsDeValor("export { a as dynamic, b }")).toEqual(['dynamic', 'b']);
    expect(exportsDeValor('export type X = 1;\nexport interface Y {}')).toEqual([]);
  });
});
