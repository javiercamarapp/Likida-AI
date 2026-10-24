import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-S33-07: `unidadesPorPlacas` usa ilike SOLO para ignorar mayúsculas; los comodines (% _ \) de las placas leídas de un
// documento se escapan, igual que el folio en carta_porte_wa.ts. Supabase es un doble que registra el patrón recibido.

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const patrones: Array<{ col: string; patron: string }> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const n: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit']) n[m] = () => n;
      n.ilike = (col: string, patron: string) => { patrones.push({ col, patron }); return n; };
      n.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
      return n;
    },
  }),
}));
vi.mock('../presupuesto', () => ({ acotada: async <T,>(p: PromiseLike<T>) => p }));

const repo = await import('./repo');
beforeEach(() => { patrones.length = 0; });

describe('unidadesPorPlacas (A37-S33-07)', () => {
  it('escapa % y _ y \\ : unas placas «%» NO son un comodín que empareje cualquier unidad', async () => {
    await repo.unidadesPorPlacas('t', '%');
    await repo.unidadesPorPlacas('t', 'AB_12');
    await repo.unidadesPorPlacas('t', 'A\\B');
    expect(patrones.map((p) => p.patron)).toEqual(['\\%', 'AB\\_12', 'A\\\\B']);
  });
  it('unas placas normales pasan intactas', async () => {
    await repo.unidadesPorPlacas('t', 'ABC123');
    expect(patrones[0]).toEqual({ col: 'placas', patron: 'ABC123' });
  });
});
