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

/** Los `range(desde,hasta)` que pidió `corridasFiltradas` — ADM-10. */
const rangos: Array<[number, number]> = [];
/** ADM-10: sembrado para simular una lectura de `agente_corrida` caída. */
let errorLectura: { message: string } | null = null;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => {
      tablasLeidas.push(t);
      const b: Record<string, unknown> = {};
      // ADM-10: `.eq()` ahora se acumula (agente/estado/tenant_id pueden
      // combinarse) en vez de pisar una sola variable `id` — pero
      // `trazaDeCorrida` sigue funcionando: su ÚNICO `.eq('id', v)` se lee
      // igual desde el mapa de filtros.
      const filtros: Array<[string, string]> = [];
      let pidioConteo = false;
      b.select = (_cols?: unknown, opts?: { count?: string }) => {
        if (opts?.count === 'exact') pidioConteo = true;
        return b;
      };
      b.order = () => b;
      b.limit = () => b;
      b.eq = (c: string, v: string) => { filtros.push([c, v]); return b; };
      const filtradas = () => {
        let todas = [...corridas.values()];
        for (const [c, v] of filtros) {
          const col = c === 'tenant_id' ? 'tenant_id' : c;
          todas = todas.filter((f) => f[col] === v);
        }
        return todas;
      };
      b.maybeSingle = () => {
        const idFiltro = filtros.find(([c]) => c === 'id')?.[1];
        return Promise.resolve({ data: (idFiltro && corridas.get(idFiltro)) ?? null, error: null });
      };
      b.range = (desde: number, hasta: number) => {
        rangos.push([desde, hasta]);
        if (errorLectura) return Promise.resolve({ data: null, error: errorLectura, count: null });
        const todas = filtradas();
        return Promise.resolve({
          data: todas.slice(desde, hasta + 1),
          error: null,
          count: pidioConteo ? todas.length : null,
        });
      };
      b.then = (ok: (v: Resp) => unknown) => Promise.resolve({ data: filtradas(), error: null }).then(ok);
      return b;
    },
    rpc: (fn: string, args: unknown) => {
      llamadasRpc.push({ fn, args });
      return Promise.resolve(rpcs.get(fn) ?? { data: null, error: { message: 'sin fixture' } });
    },
  }),
}));

const { trazaDeCorrida, corridasFiltradas, CORRIDAS_POR_PAGINA } = await import('./corridas-cruzadas');

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

// ═══════════════════════════════════════════════════════════════════════════
// EL GASTO MEDIDO DE LA CORRIDA (`agente_corrida.costo_usd`, 0123).
//
// La columna llevaba desde la 0123 escribiéndose y NINGUNA pantalla la leía:
// `COLUMNAS` la omitía del select, así que la traza sustituía el gasto medido
// por una correlación temporal contra `llm_costo`. Al añadirla, lo único que
// hay que blindar es la distinción que el resto del repo ya defiende
// (`backoffice.ts:17`): NULL es «no se midió», nunca $0.
// ═══════════════════════════════════════════════════════════════════════════
describe('costoUsd: NULL es «no se midió», jamás cero', () => {
  beforeEach(() => { corridas.clear(); rpcs.clear(); llamadasRpc.length = 0; tablasLeidas.length = 0; });

  it('un costo medido llega como número', async () => {
    corridas.set('c1', { ...CORRIDA, costo_usd: 0.0342 });
    rpcs.set('resumen_costo_ia_tenant', { data: { totales: { n: 1, costoUsd: 1, tokensIn: 1, tokensOut: 1 } }, error: null });
    expect((await trazaDeCorrida('c1'))?.corrida.costoUsd).toBe(0.0342);
  });

  it('un CERO medido se conserva como cero — es una medición, no un hueco', async () => {
    corridas.set('c1', { ...CORRIDA, costo_usd: 0 });
    rpcs.set('resumen_costo_ia_tenant', { data: { totales: { n: 1, costoUsd: 1, tokensIn: 1, tokensOut: 1 } }, error: null });
    expect((await trazaDeCorrida('c1'))?.corrida.costoUsd).toBe(0);
  });

  it('NULL y la columna ausente son null, NUNCA 0', async () => {
    // `Number(null)` es 0: sin el `== null` de por medio, una corrida que no
    // midió su gasto se pintaría "US$0.0000" y se leería como un agente que
    // trabaja gratis. Es el bug que esta prueba existe para impedir.
    corridas.set('c1', { ...CORRIDA, costo_usd: null });
    corridas.set('c2', { ...CORRIDA, id: 'c2' });
    rpcs.set('resumen_costo_ia_tenant', { data: { totales: { n: 1, costoUsd: 1, tokensIn: 1, tokensOut: 1 } }, error: null });
    expect((await trazaDeCorrida('c1'))?.corrida.costoUsd).toBeNull();
    expect((await trazaDeCorrida('c2'))?.corrida.costoUsd).toBeNull();
  });
});

// ADM-10 (auditoría 24, MEDIO) — /admin/corridas pintaba las últimas 50 sin
// filtro ni paginación. `corridasFiltradas` es el mismo patrón que
// `buscarConversaciones` (ADM-1): filtros opcionales + count real + range.
describe('corridasFiltradas', () => {
  beforeEach(() => { corridas.clear(); rpcs.clear(); llamadasRpc.length = 0; tablasLeidas.length = 0; rangos.length = 0; errorLectura = null; });

  it('sin filtros trae la primera página con el total real', async () => {
    for (let i = 0; i < 3; i++) corridas.set(`c${i}`, { ...CORRIDA, id: `c${i}` });
    const r = await corridasFiltradas();
    expect(r.total).toBe(3);
    expect(r.corridas).toHaveLength(3);
    expect(r.pagina).toBe(1);
    expect(r.paginas).toBe(1);
    expect(rangos).toEqual([[0, CORRIDAS_POR_PAGINA - 1]]);
  });

  it('filtra por agente', async () => {
    corridas.set('c1', { ...CORRIDA, id: 'c1', agente: 'cobranza' });
    corridas.set('c2', { ...CORRIDA, id: 'c2', agente: 'liquidacion' });
    const r = await corridasFiltradas({ agente: 'cobranza' });
    expect(r.corridas.map((c) => c.id)).toEqual(['c1']);
    expect(r.total).toBe(1);
  });

  it('filtra por estado — solo los del dominio real (ok/parcial/fallo)', async () => {
    corridas.set('c1', { ...CORRIDA, id: 'c1', estado: 'fallo' });
    corridas.set('c2', { ...CORRIDA, id: 'c2', estado: 'ok' });
    const r = await corridasFiltradas({ estado: 'fallo' });
    expect(r.corridas.map((c) => c.id)).toEqual(['c1']);
    // Un valor fuera de dominio se IGNORA (no filtra nada), no truena.
    const rTodas = await corridasFiltradas({ estado: 'inventado' });
    expect(rTodas.total).toBe(2);
  });

  it('filtra por tenant', async () => {
    corridas.set('c1', { ...CORRIDA, id: 'c1', tenant_id: 't1' });
    corridas.set('c2', { ...CORRIDA, id: 'c2', tenant_id: 't2' });
    const r = await corridasFiltradas({ tenantId: 't1' });
    expect(r.corridas.map((c) => c.id)).toEqual(['c1']);
  });

  it('el total viene de count exact, nunca de .length de una página topada', async () => {
    for (let i = 0; i < 5; i++) corridas.set(`c${i}`, { ...CORRIDA, id: `c${i}` });
    // Página 1 con 2 por página: la página trae 2, pero el total sigue en 5.
    const r = await corridasFiltradas({ pagina: 1 });
    expect(r.total).toBe(5); // count real, no `data.length` de la página
  });

  it('con la base caída LANZA — nunca una lista vacía con cara de "sin corridas"', async () => {
    errorLectura = { message: 'fetch failed' };
    await expect(corridasFiltradas()).rejects.toThrow('fetch failed');
  });
});
