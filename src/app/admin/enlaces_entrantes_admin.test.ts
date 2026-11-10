/* eslint-disable security/detect-non-literal-fs-filename -- recorre el árbol de FUENTE del propio repo */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REDIRECCIONES_308 } from './guardas/redirecciones_308';
import { FUERA_DEL_MENU, TODAS_LAS_RUTAS, entradaDeRuta, pestanaActiva } from './rutas';

// Fase 1: la navegación se reordenó, pero NINGUNA dirección cambió salvo los 4 stubs. Esta guarda recorre el código y comprueba que cada
// enlace literal `/admin/...` (alertas de correo, mapas del Copiloto, `revalidatePath`, `href` entre pantallas) cae en una pantalla que existe
// y que no es un stub 308 (un enlace nuevo a una dirección retirada cuesta un salto y deja una pista falsa). Los correos de alerta siguen
// aterrizando en `/admin/salud-sistema` (Salud › Estado).
const SRC = join(process.cwd(), 'src');
const ADMIN = join(SRC, 'app/admin');

function fuentes(dir: string, salida: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const r = join(dir, n);
    if (statSync(r).isDirectory()) { if (n !== 'node_modules') fuentes(r, salida); continue; }
    if (/\.(ts|tsx)$/.test(n) && !/\.(test|nav|tmp)\./.test(n)) salida.push(r);
  }
  return salida;
}
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** ¿Existe una pantalla (estática o dinámica) para esta dirección de /admin? */
function existePantalla(direccion: string): boolean {
  const partes = direccion.replace(/^\/admin\/?/, '').split('/').filter(Boolean);
  let dir = ADMIN;
  for (const parte of partes) {
    if (existsSync(join(dir, parte)) && statSync(join(dir, parte)).isDirectory()) { dir = join(dir, parte); continue; }
    const dinamica = readdirSync(dir).find((n) => /^\[[^\]]+\]$/.test(n) && statSync(join(dir, n)).isDirectory());
    if (!dinamica) return false;
    dir = join(dir, dinamica);
  }
  return existsSync(join(dir, 'page.tsx')) || existsSync(join(dir, 'route.ts'));
}

describe('enlaces entrantes a /admin tras la Fase 1', () => {
  const encontrados = new Map<string, string[]>();
  for (const f of fuentes(SRC)) {
    const rel = relative(SRC, f);
    if (rel.startsWith('app/admin/guardas/')) continue;
    const texto = sinComentarios(readFileSync(f, 'utf8'));
    for (const m of texto.matchAll(/(?<![\w/.-])\/admin[a-z0-9/-]*/g)) {
      // Una dirección armada con plantilla (`/admin/x/${id}`, `/admin/x/[id]`) no es un literal comprobable.
      const sigue = texto[(m.index ?? 0) + m[0].length] ?? '';
      const direccion = m[0].replace(/[/-]+$/, '');
      if (/[${[\w]/.test(sigue) || direccion.includes('//')) continue;
      const lista = encontrados.get(direccion) ?? [];
      lista.push(rel);
      encontrados.set(direccion, lista);
    }
  }

  it('cada dirección literal de /admin existe como pantalla', () => {
    expect(encontrados.size, 'el recorrido debe ver los enlaces reales').toBeGreaterThan(30);
    const rotas = [...encontrados].filter(([d]) => !existePantalla(d)).map(([d, a]) => `${d} <- ${[...new Set(a)].join(', ')}`);
    expect(rotas).toEqual([]);
  });

  it('ningún código enlaza a un stub 308 (solo el propio stub y el registro lo nombran)', () => {
    const a = [...encontrados].filter(([d]) => d in REDIRECCIONES_308).map(([d, f]) => `${d} <- ${[...new Set(f)].join(', ')}`);
    expect(a).toEqual([]);
  });

  it('las alertas de correo siguen aterrizando en Salud › Estado (/admin/salud-sistema)', () => {
    expect(existePantalla('/admin/salud-sistema')).toBe(true);
    const e = entradaDeRuta('/admin/salud-sistema');
    expect(e?.nombre).toBe('Salud');
    expect(pestanaActiva(e!, '/admin/salud-sistema')?.nombre).toBe('Estado');
    // Los emisores de alertas y avisos con enlace a la salud del sistema:
    const emisores = ['lib/observability/alerta.ts', 'lib/admin/fuentes-alerta-extra.ts'];
    for (const f of emisores) expect(readFileSync(join(SRC, f), 'utf8'), f).toContain('/admin/salud-sistema');
  });

  it('todo lo que el menú, las pestañas y ⌘K ofrecen es una pantalla viva y ninguna es stub', () => {
    for (const r of [...TODAS_LAS_RUTAS, ...FUERA_DEL_MENU]) {
      if (r.href === '/admin') continue;
      expect(existePantalla(r.href), r.href).toBe(true);
      expect(r.href in REDIRECCIONES_308, `${r.href} es un stub`).toBe(false);
    }
  });
});
