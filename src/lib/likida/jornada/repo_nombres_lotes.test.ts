import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-S19-04: `nombresDeOperadores` mandaba hasta 900 uuids en UN `.in()`
// (query string de ~35 KB). El módulo de alertas ya parte a 150; aquí igual.
const tamanos: number[] = [];
vi.mock('../presupuesto', () => ({ acotada: <T,>(q: T) => q }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        eq: () => b,
        in: (_c: string, ids: string[]) => {
          tamanos.push(ids.length);
          return Object.assign(b, {
            then: (res: (x: unknown) => unknown) =>
              Promise.resolve({ data: ids.map((id) => ({ id, nombre: `op-${id}`, numero_empleado: null })), error: null }).then(res),
          });
        },
      });
      return b;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { nombresDeOperadores } = await import('./repo');

beforeEach(() => { tamanos.length = 0; });

describe('A37-S19-04 nombresDeOperadores en lotes', () => {
  it('parte 400 ids distintos en lotes de 150 como máximo y junta todos los nombres', async () => {
    const ids = Array.from({ length: 400 }, (_, i) => `id-${i}`);
    const mapa = await nombresDeOperadores('t1', ids);
    expect(Math.max(...tamanos)).toBeLessThanOrEqual(150);
    expect(tamanos.length).toBe(3);
    expect(mapa.size).toBe(400);
  });
  it('deduplica antes de partir', async () => {
    const mapa = await nombresDeOperadores('t1', ['a', 'a', 'b']);
    expect(tamanos).toEqual([2]);
    expect(mapa.size).toBe(2);
  });
});
