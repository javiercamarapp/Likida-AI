import { describe, it, expect, vi, beforeEach } from 'vitest';

// getResumenNegocio — la consola de superadmin (docs/superpowers/plans/
// 2026-08-02-panel-superadmin.md). Cruza TENANTS, no filtra por tenant_id a
// propósito: es la única función de este repo con permiso de ver todas las
// flotas a la vez, y por eso vive fuera de analytics.ts (que es
// tenant-scoped en cada línea) — mezclar los dos hace fácil que alguien
// copie un patrón de aquí a una consulta de cliente y filtre de menos.
type Resp = { data: unknown; error: { message: string } | null };
const respuestas = new Map<string, Resp>();

function crearBuilder(tabla: string) {
  const resp = (): Resp => respuestas.get(tabla) ?? { data: [], error: null };
  const b: Record<string, unknown> = {};
  const self = () => b;
  for (const m of ['select', 'eq', 'order']) b[m] = self;
  b.then = (ok: (v: Resp) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(resp()).then(ok, fail);
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => crearBuilder(t) }) }));

const { getResumenNegocio } = await import('./negocio');

describe('getResumenNegocio', () => {
  beforeEach(() => { respuestas.clear(); });

  it('suma costo/tokens de TODOS los tenants y agrupa por fase', async () => {
    respuestas.set('tenant', { data: [{ id: 't1' }], error: null });
    respuestas.set('viaje', { data: [{ id: 'v1' }, { id: 'v2' }], error: null });
    respuestas.set('llm_costo', {
      data: [
        { fase: 'ocr', tokens_in: 1000, tokens_out: 200, costo_usd: 1.005 },
        { fase: 'ocr', tokens_in: 500, tokens_out: 100, costo_usd: 0.5 },
        { fase: 'cuadre', tokens_in: 300, tokens_out: 50, costo_usd: 0.4272 },
      ],
      error: null,
    });
    const r = await getResumenNegocio();
    expect(r.tenants).toBe(1);
    expect(r.viajesProcesados).toBe(2);
    expect(r.costoIaUsd).toBe(1.93);
    expect(r.tokensIn).toBe(1800);
    expect(r.tokensOut).toBe(350);
    expect(r.porFase).toEqual([
      { fase: 'ocr', n: 2, costoUsd: 1.51 },
      { fase: 'cuadre', n: 1, costoUsd: 0.43 },
    ]);
  });

  it('sin datos (Likida recién arrancando), ceros — no un error ni un crash', async () => {
    const r = await getResumenNegocio();
    expect(r).toEqual({ tenants: 0, viajesProcesados: 0, costoIaUsd: 0, tokensIn: 0, tokensOut: 0, porFase: [] });
  });

  it('un fallo de Supabase LANZA, no se lee como "cero negocio"', async () => {
    respuestas.set('llm_costo', { data: null, error: { message: 'fetch failed' } });
    await expect(getResumenNegocio()).rejects.toThrow('fetch failed');
  });
});
