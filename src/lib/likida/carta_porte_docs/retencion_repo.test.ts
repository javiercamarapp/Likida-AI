import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-A3-11 — la purga por retención del REPO real (Supabase es un doble que graba lo que se le manda): la constancia
// queda SIN contenido personal (extracción, validación, remitente, asunto, texto, archivo y los valores de las correcciones).

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const grabado: Array<{ tabla: string; update: Record<string, unknown>; filtros: Array<[string, unknown]> }> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const reg = { tabla, update: {} as Record<string, unknown>, filtros: [] as Array<[string, unknown]> };
      grabado.push(reg);
      const n: Record<string, unknown> = {};
      n.update = (v: Record<string, unknown>) => { reg.update = v; return n; };
      for (const m of ['eq', 'is', 'select']) n[m] = (...a: unknown[]) => { if (m !== 'select') reg.filtros.push([`${m}:${String(a[0])}`, a[1]]); return n; };
      n.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: 'x' }], error: null }).then(ok);
      return n;
    },
  }),
}));
vi.mock('../presupuesto', () => ({ acotada: async <T,>(p: PromiseLike<T>) => p }));

const repo = await import('./repo');
const T = '11111111-1111-4111-8111-111111111111';
const D = '22222222-2222-4222-8222-222222222222';

beforeEach(() => { grabado.length = 0; });

describe('A37-A3-11 — la constancia de purga no conserva datos personales', () => {
  it('marcarPurgado anula archivo, texto, extracción, validación, remitente y asunto', async () => {
    expect(await repo.marcarPurgado(T, D)).toBe(true);
    const u = grabado.find((g) => g.tabla === 'cp_documento')!.update;
    expect(u).toMatchObject({ storage_ruta: null, texto_extracto: null, extraccion: null, validacion: null, remitente: null, asunto: null });
    expect(typeof u.purgado_en).toBe('string');
  });

  it('anonimizarCorrecciones deja las filas (los conteos) pero sin valor_antes ni valor_despues, solo de ese documento y flota', async () => {
    await repo.anonimizarCorrecciones(T, D);
    const g = grabado.find((x) => x.tabla === 'cp_correccion')!;
    expect(g.update).toEqual({ valor_antes: null, valor_despues: null });
    expect(g.filtros).toEqual(expect.arrayContaining([['eq:tenant_id', T], ['eq:documento_id', D]]));
  });
});
