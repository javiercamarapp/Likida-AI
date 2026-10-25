import { beforeEach, describe, expect, it, vi } from 'vitest';

// A37-S32-08: el aprendizaje de perfil son dos pasos sin transacción; un corte entre ambos NO debe dejar el perfil atascado.
// Supabase es un doble que responde en orden y anota qué tabla y qué operación se pidió.

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
type R = { data: unknown; error: { message: string; code?: string } | null };
let guion: Array<{ tabla: string; op: string; r: R }> = [];
const pedidas: string[] = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      let op = 'select';
      const n: Record<string, unknown> = {};
      for (const m of ['eq', 'order', 'limit', 'single', 'maybeSingle']) n[m] = () => n;
      n.select = () => n;
      n.insert = () => { op = 'insert'; return n; };
      n.update = () => { op = 'update'; return n; };
      n.delete = () => { op = 'delete'; return n; };
      n.then = (ok: (v: R) => unknown) => {
        pedidas.push(`${tabla}:${op}`);
        const sig = guion.shift();
        return Promise.resolve(sig && sig.tabla === tabla && sig.op === op ? sig.r : { data: null, error: { message: `inesperado ${tabla}:${op}` } }).then(ok);
      };
      return n;
    },
  }),
}));
vi.mock('../presupuesto', () => ({ acotada: async <T,>(p: PromiseLike<T>) => p }));

const repo = await import('./repo');
const T = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';
const ok = (data: unknown): R => ({ data, error: null });
const dup: R = { data: null, error: { message: 'duplicate', code: '23505' } };
const nuevo = { clave: 'k', nombre: 'n', clienteId: null, formato: 'excel' as const, firma: { formato: 'excel' as const }, mapeos: [], ejemplos: [], nota: null, documentoId: null, actorId: null };

beforeEach(() => { guion = []; pedidas.length = 0; });

describe('crearPerfil (A37-S32-08)', () => {
  it('un perfil huérfano (sin ninguna versión) se repara con la v1 en vez de devolver «ya existe» para siempre', async () => {
    guion = [
      { tabla: 'cp_perfil', op: 'insert', r: dup },
      { tabla: 'cp_perfil', op: 'select', r: ok({ id: P }) },
      { tabla: 'cp_perfil_version', op: 'select', r: ok([]) },
      { tabla: 'cp_perfil_version', op: 'insert', r: ok(null) },
    ];
    expect(await repo.crearPerfil(T, nuevo)).toBe(P);
  });
  it('un perfil que ya tiene versión sigue devolviendo null', async () => {
    guion = [
      { tabla: 'cp_perfil', op: 'insert', r: dup },
      { tabla: 'cp_perfil', op: 'select', r: ok({ id: P }) },
      { tabla: 'cp_perfil_version', op: 'select', r: ok([{ version: 1 }]) },
    ];
    expect(await repo.crearPerfil(T, nuevo)).toBeNull();
  });
  it('si la v1 falla tras crear el perfil, el perfil se retira y el error se propaga', async () => {
    guion = [
      { tabla: 'cp_perfil', op: 'insert', r: ok({ id: P }) },
      { tabla: 'cp_perfil_version', op: 'insert', r: { data: null, error: { message: 'timeout' } } },
      { tabla: 'cp_perfil', op: 'delete', r: ok(null) },
    ];
    await expect(repo.crearPerfil(T, nuevo)).rejects.toThrow(/timeout/);
    expect(pedidas).toContain('cp_perfil:delete');
  });
});

describe('crearVersionPerfil (A37-S32-08)', () => {
  it('una versión N+1 huérfana (23505) se activa si la activa seguía en la base, y devuelve null', async () => {
    guion = [
      { tabla: 'cp_perfil_version', op: 'insert', r: dup },
      { tabla: 'cp_perfil', op: 'update', r: ok([{ id: P }]) },
    ];
    expect(await repo.crearVersionPerfil(T, P, 1, { mapeos: [], ejemplos: [], nota: null, documentoId: null, actorId: null })).toBeNull();
    expect(pedidas).toEqual(['cp_perfil_version:insert', 'cp_perfil:update']);
  });
});
