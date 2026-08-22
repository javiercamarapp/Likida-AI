// ═══════════════════════════════════════════════════════════════════════════
// `getGastoPorSemanaSeries`/`getLiquidadoPorSemanaSeries`/
// `getTopRutasPorGastoSeries` — el selector único Semanal/Mensual/Histórico
// que el 8-ago-2026 pasó a mover TODAS las gráficas secundarias del
// Resumen, no solo Actividad. Son wrappers delgados sobre funciones ya
// probadas (`getGastoPorSemana`, `getLiquidadoPorSemana`,
// `getTopRutasPorGasto`); lo único nuevo que vale la pena comprobar es el
// mapeo semanas-por-modo (`SEMANAS_POR_MODO`) y que "histórico" en rutas
// vaya SIN ventana, no con una ventana grande disfrazada de "todo".
//
// ESCALA 50k (mig. 0150): la ventana ahora viaja como `p_desde`/`p_hasta`
// de `top_rutas_gasto_tenant` (null = sin cota).
//
// Y FE-4 (22-ago-2026): las tres piden sus modos con `Promise.allSettled`.
// Antes era `Promise.all`, que rechaza con el PRIMER rechazo, y la página
// envuelve la llamada entera en `safe()` → la gráfica desaparecía completa
// porque el modo "histórico" (52 semanas, el más caro) tocó el tope de 8 s.
// Aquí se comprueba lo contrario: el modo caído vale `null` y los otros dos
// se entregan.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rpcFalso0150, type Tablas } from './analytics_rpc_0150.fixture';

const TABLAS: Tablas = {};
const llamadas: Array<{ fn: string; args: Record<string, unknown> }> = [];
/** Hace fallar la RPC cuando el predicado dice que sí — para tumbar UN modo. */
let tumbar: ((fn: string, args: Record<string, unknown>) => boolean) | null = null;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      llamadas.push({ fn, args });
      if (tumbar?.(fn, args)) return Promise.resolve({ data: null, error: { message: 'tope de consulta agotado' } });
      return Promise.resolve(rpcFalso0150(fn, args, TABLAS) ?? { data: null, error: null });
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: vi.fn(), ventanaDesdeDB: vi.fn() }));

const {
  getGastoPorSemanaSeries, getLiquidadoPorSemanaSeries, getTopRutasPorGastoSeries,
} = await import('./analytics');

beforeEach(() => { TABLAS.gasto = []; TABLAS.liquidacion = []; TABLAS.viaje = []; llamadas.length = 0; tumbar = null; });

describe('getGastoPorSemanaSeries / getLiquidadoPorSemanaSeries', () => {
  it('gasto: semanal=5 semanas, mensual=13, histórico=52', async () => {
    const r = await getGastoPorSemanaSeries('t1', '2026-08-08');
    expect(r.semanal!.categorias).toHaveLength(5);
    expect(r.mensual!.categorias).toHaveLength(13);
    expect(r.historico!.categorias).toHaveLength(52);
  });

  it('liquidado: mismo mapeo de semanas', async () => {
    const r = await getLiquidadoPorSemanaSeries('t1', '2026-08-08');
    expect(r.semanal).toHaveLength(5);
    expect(r.mensual).toHaveLength(13);
    expect(r.historico).toHaveLength(52);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FE-4 · UN MODO CAÍDO NO SE LLEVA LOS OTROS DOS
// ═══════════════════════════════════════════════════════════════════════════
describe('FE-4 · el modo que falla vale null; los que respondieron se entregan', () => {
  /** El modo "histórico" es el más caro (52 semanas) y el primero en tocar
   *  el tope de 8 s: su ventana es la que empieza más atrás. */
  const esHistorico = (_fn: string, args: Record<string, unknown>) =>
    String(args.p_desde ?? '') <= '2025-09-01';

  it('gasto: histórico null, semanal y mensual completos', async () => {
    tumbar = esHistorico;
    const r = await getGastoPorSemanaSeries('t1', '2026-08-08');
    expect(r.historico).toBeNull();
    expect(r.semanal!.categorias).toHaveLength(5);
    expect(r.mensual!.categorias).toHaveLength(13);
  });

  it('liquidado: histórico null, los otros dos vivos', async () => {
    tumbar = esHistorico;
    const r = await getLiquidadoPorSemanaSeries('t1', '2026-08-08');
    expect(r.historico).toBeNull();
    expect(r.semanal).toHaveLength(5);
    expect(r.mensual).toHaveLength(13);
  });

  it('top rutas: el histórico (sin ventana) cae y los acotados sobreviven', async () => {
    tumbar = (_fn, args) => args.p_desde === null;
    const r = await getTopRutasPorGastoSeries('t1', 5, '2026-08-08');
    expect(r.historico).toBeNull();
    expect(r.semanal).toEqual([]);
    expect(r.mensual).toEqual([]);
  });

  it('los tres pueden caer: los tres valen null, y NUNCA lanza', async () => {
    tumbar = () => true;
    const r = await getGastoPorSemanaSeries('t1', '2026-08-08');
    expect([r.semanal, r.mensual, r.historico]).toEqual([null, null, null]);
  });

  it('el modo caído se LOGUEA — un modo apagado en silencio es el fallo que no se quiere', async () => {
    tumbar = esHistorico;
    const { logger } = await import('@/lib/logger');
    vi.mocked(logger.error).mockClear();
    await getGastoPorSemanaSeries('t1', '2026-08-08');
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith('analytics.modo_caido', expect.objectContaining({
      consulta: 'getGastoPorSemanaSeries', modo: 'historico',
    }));
  });

  it('los tres modos se piden EN PARALELO, no en cascada', async () => {
    await getGastoPorSemanaSeries('t1', '2026-08-08');
    expect(llamadas.filter((l) => l.fn === 'gasto_semanal_tenant')).toHaveLength(3);
  });
});

describe('getTopRutasPorGastoSeries', () => {
  it('histórico NO manda ventana — p_desde/p_hasta nulos, no una de 52 semanas disfrazada', async () => {
    await getTopRutasPorGastoSeries('t1', 5, '2026-08-08');
    // La tercera llamada (semanal, mensual, histórico en orden) es histórico.
    const rutas = llamadas.filter((l) => l.fn === 'top_rutas_gasto_tenant');
    expect(rutas).toHaveLength(3);
    expect(rutas[2].args.p_desde).toBeNull();
    expect(rutas[2].args.p_hasta).toBeNull();
  });

  it('semanal SÍ manda ventana de 5 semanas', async () => {
    await getTopRutasPorGastoSeries('t1', 5, '2026-08-08');
    const rutas = llamadas.filter((l) => l.fn === 'top_rutas_gasto_tenant');
    expect(rutas[0].args.p_desde).toBe('2026-07-05');
    expect(rutas[0].args.p_hasta).toBe('2026-08-08');
    expect(rutas[0].args.p_top).toBe(5);
  });
});
