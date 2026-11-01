/* eslint-disable security/detect-non-literal-fs-filename -- recorre el propio árbol de src */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// El motor del recorrido corre en el NAVEGADOR. No debe arrastrar al bundle cliente el catálogo completo de pantallas (cientos de textos),
// ni el constructor de recorridos, la matriz de cobertura ni los agentes: eso se arma en el servidor (dashboard/recorridos/index.ts).
const SRC = join(process.cwd(), 'src');
const CLIENTE = [
  'app/ui-v2/movimiento/tour/proveedor.tsx', 'app/ui-v2/movimiento/tour/capa.tsx', 'app/ui-v2/movimiento/tour/globo.tsx',
  'app/ui-v2/movimiento/tour/invitacion.tsx', 'app/ui-v2/movimiento/tour/pista.tsx', 'app/ui-v2/movimiento/tour/lanzador.tsx',
  'app/ui-v2/movimiento/tour/anfitrion-dom.ts', 'app/dashboard/shell/menu-guia.tsx',
];
const PROHIBIDOS = ['app/ui-v2/onboarding/pantallas.ts', 'app/ui-v2/onboarding/tour.ts', 'app/ui-v2/onboarding/agentes.ts', 'app/ui-v2/onboarding/cobertura.ts', 'app/ui-v2/onboarding/roles.ts'];

function resolver(desde: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : spec.startsWith('.') ? join(SRC, desde, '..', spec) : null;
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) if (existsSync(c) && /\.(ts|tsx)$/.test(c)) return c.slice(SRC.length + 1);
  return null;
}
function alcanza(): Set<string> {
  const vistos = new Set<string>();
  const pila = [...CLIENTE];
  while (pila.length) {
    const f = pila.pop()!;
    if (vistos.has(f)) continue;
    vistos.add(f);
    const src = readFileSync(join(SRC, f), 'utf8').replace(/^\s*import type [^;]+;$/gm, '');
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)) {
      const r = resolver(f, m[1]);
      if (r) pila.push(r);
    }
  }
  return vistos;
}

describe('el bundle cliente del recorrido', () => {
  it('no alcanza el catálogo de pantallas, el constructor de recorridos, la matriz ni los agentes', () => {
    const alcanzados = alcanza();
    expect(PROHIBIDOS.filter((p) => alcanzados.has(p))).toEqual([]);
    // El barrido no está ciego: llega al estado y a las pistas, que sí viajan.
    expect(alcanzados.has('app/ui-v2/onboarding/estado.ts')).toBe(true);
    expect(alcanzados.has('app/ui-v2/onboarding/pista.ts')).toBe(true);
  });
});
