import { describe, it, expect, vi, beforeEach } from 'vitest';

// ESCALA 50k (22-ago-2026): `trazaDeCorrida` dejó de paginar `llm_costo` a JS
// (`traerTodo`, que LANZA a las 100,000 filas — una corrida de cierre masivo
// de una flota de 50k viajes/mes las cruza en horas) y pide la suma a
// `resumen_costo_ia_tenant` (0064) con la ventana [inicio, fin) de la corrida.

type Resp = { data: unknown; error: { message: string } | null };
const corridas = new Map<string, Record<string, unknown>>();
const rpcs = new Map<string, Resp>();
const llamadasRpc: Array<{ fn: string; args: unknown }> = [];
const tablasLeidas: string[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => {
      tablasLeidas.push(t);
      const b: Record<string, unknown> = {};
      let id: string | null = null;
      b.select = () => b; b.order = () => b; b.limit = () => b;
      b.eq = (_c: string, v: string) => { id = v; return b; };
      b.maybeSingle = () => Promise.resolve({ data: (id && corridas.get(id)) ?? null, error: null });
      b.then = (ok: (v: Resp) => unknown) => Promise.resolve({ data: [...corridas.values()], error: null }).then(ok);
      return b;
    },
    rpc: (fn: string, args: unknown) => {
      llamadasRpc.push({ fn, args });
      return Promise.resolve(rpcs.get(fn) ?? { data: null, error: { message: 'sin fixture' } });
    },
  }),
}));

const { trazaDeCorrida } = await import('./corridas-cruzadas');

const CORRIDA = {
  id: 'c1', agente: 'liquidacion', tenant_id: 't1', tenant: { nombre: 'Flota Uno' },
  inicio: '2026-08-20T10:00:00Z', fin: '2026-08-20T10:05:00Z', estado: 'ok', disparo: 'cron',
  tareas_hechas: 3, tareas_total: 3, resumen: null, error: null,
};

describe('trazaDeCorrida: el costo de la ventana se suma en SQL', () => {
  beforeEach(() => { corridas.clear(); rpcs.clear(); llamadasRpc.length = 0; tablasLeidas.length = 0; });

  it('pide la agregación por flota con [inicio, fin) y NO lee llm_costo por filas', async () => {
    corridas.set('c1', CORRIDA);
    rpcs.set('resumen_costo_ia_tenant', {
      data: { totales: { n: 12_345, viajes: 400, costoUsd: 61.725, tokensIn: 9_000_000, tokensOut: 1_200_000 }, porFase: [] },
      error: null,
    });
    const t = await trazaDeCorrida('c1');
    expect(t?.costo).toEqual({ llamadas: 12_345, tokensIn: 9_000_000, tokensOut: 1_200_000, costoUsd: 61.725 });
    expect(t?.costoNoDisponible).toBeNull();
    expect(llamadasRpc).toEqual([{
      fn: 'resumen_costo_ia_tenant',
      args: { p_tenant: 't1', p_desde: '2026-08-20T10:00:00Z', p_hasta: '2026-08-20T10:05:00Z' },
    }]);
    expect(tablasLeidas).not.toContain('llm_costo');
  });

  it('una corrida sin flota o sin fin NO pide el costo y lo dice', async () => {
    corridas.set('c1', { ...CORRIDA, tenant_id: null, tenant: null });
    corridas.set('c2', { ...CORRIDA, id: 'c2', fin: null });
    expect((await trazaDeCorrida('c1'))?.costoNoDisponible).toContain('sin flota');
    expect((await trazaDeCorrida('c2'))?.costoNoDisponible).toContain('no tiene fin');
    expect(llamadasRpc).toEqual([]);
  });

  it('error de la RPC o forma inesperada LANZAN — jamás "la corrida salió gratis"', async () => {
    corridas.set('c1', CORRIDA);
    rpcs.set('resumen_costo_ia_tenant', { data: null, error: { message: 'fetch failed' } });
    await expect(trazaDeCorrida('c1')).rejects.toThrow('fetch failed');
    rpcs.set('resumen_costo_ia_tenant', { data: { totales: { n: 1 } }, error: null });
    await expect(trazaDeCorrida('c1')).rejects.toThrow(/0064/);
  });

  it('una corrida que no existe es null', async () => {
    expect(await trazaDeCorrida('nadie')).toBeNull();
  });
});
