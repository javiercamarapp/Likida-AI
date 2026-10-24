import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../presupuesto', () => ({ acotada: (q: unknown) => q }));

// A37-S32-07: 200 perfiles × 30 versiones = 6000 filas, más que el tope de 5000 de la consulta anterior.
const PERFILES = Array.from({ length: 200 }, (_, i) => ({
  id: `p-${String(i).padStart(3, '0')}`, clave: `c${i}`, nombre: `Perfil ${i}`, cliente_id: null, formato: 'excel',
  firma: { formato: 'excel' }, version_activa: 30, created_at: '2026-10-01',
}));
const VERSIONES = PERFILES.flatMap((p) => Array.from({ length: 30 }, (_, k) => ({
  perfil_id: p.id, tenant_id: 't-1', version: k + 1, mapeos: [], ejemplos: [], nota: null,
})));

function consulta(tabla: string) {
  let filas: Array<Record<string, unknown>> = tabla === 'cp_perfil' ? [...PERFILES] : [...VERSIONES];
  let tope = Infinity;
  const api: Record<string, unknown> = {};
  api.select = () => api;
  api.eq = (c: string, v: unknown) => { if (c !== 'tenant_id') filas = filas.filter((f) => f[c] === v); return api; };
  api.in = (c: string, vs: unknown[]) => { filas = filas.filter((f) => vs.includes(f[c])); return api; };
  api.order = () => api;
  api.limit = (n: number) => { tope = n; return api; };
  api.then = (res: (v: unknown) => unknown) => res({ data: filas.slice(0, tope), error: null });
  return api;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => consulta(t) }) }));

const { listarPerfiles } = await import('./repo');

describe('A37-S32-07: listarPerfiles trae la versión activa de TODOS los perfiles', () => {
  it('con más de 5000 versiones en total ningún perfil pierde la suya', async () => {
    const r = await listarPerfiles('t-1');
    expect(r).toHaveLength(200);
    expect(r.every((p) => p.activa.version === 30)).toBe(true);
  });
});
