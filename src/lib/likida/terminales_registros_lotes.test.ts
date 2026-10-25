import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-S19-04: `terminalesDeRegistros` mandaba hasta 900 uuids en UN `.in()`.
const tamanos: number[] = [];
vi.mock('./presupuesto', () => ({ acotada: <T,>(q: T) => q }));
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
              Promise.resolve({ data: ids.map((id) => ({ id, terminal_id: 'T1' })), error: null }).then(res),
          });
        },
      });
      return b;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { terminalesDeRegistros } = await import('./terminales');

beforeEach(() => { tamanos.length = 0; });

describe('A37-S19-04 terminalesDeRegistros en lotes', () => {
  it('parte 400 uuids en lotes de 150 como máximo', async () => {
    const ids = Array.from({ length: 400 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const mapa = await terminalesDeRegistros('operador', 't1', ids);
    expect(Math.max(...tamanos)).toBeLessThanOrEqual(150);
    expect(mapa.size).toBe(400);
  });
});
