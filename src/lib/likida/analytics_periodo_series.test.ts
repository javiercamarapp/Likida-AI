// ═══════════════════════════════════════════════════════════════════════════
// `getGastoPorSemanaSeries`/`getLiquidadoPorSemanaSeries`/
// `getTopRutasPorGastoSeries` — el selector único Semanal/Mensual/Histórico
// que el 8-ago-2026 pasó a mover TODAS las gráficas secundarias del
// Resumen, no solo Actividad. Son wrappers delgados sobre funciones ya
// probadas (`getGastoPorSemana`, `getLiquidadoPorSemana`,
// `getTopRutasPorGasto`); lo único nuevo que vale la pena comprobar es el
// mapeo semanas-por-modo (`SEMANAS_POR_MODO`) y que "histórico" en rutas
// vaya SIN ventana, no con una ventana grande disfrazada de "todo".
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';

const filasPorTabla = new Map<string, unknown[]>();
const filtrosVistos: Array<{ tabla: string; gte?: unknown; lte?: unknown }> = [];

function mockPaginado(tabla: string) {
  const registro: { tabla: string; gte?: unknown; lte?: unknown } = { tabla };
  filtrosVistos.push(registro);
  const b = {
    select: () => b,
    eq: () => b,
    gte: (col: string, val: unknown) => { registro.gte = [col, val]; return b; },
    lte: (col: string, val: unknown) => { registro.lte = [col, val]; return b; },
    order: () => b,
    range: (desde: number, hasta: number) => Promise.resolve({
      data: (filasPorTabla.get(tabla) ?? []).slice(desde, hasta + 1), error: null, count: undefined,
    }),
  };
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (tabla: string) => mockPaginado(tabla) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: vi.fn(), ventanaDesdeDB: vi.fn() }));

const {
  getGastoPorSemanaSeries, getLiquidadoPorSemanaSeries, getTopRutasPorGastoSeries,
} = await import('./analytics');

describe('getGastoPorSemanaSeries / getLiquidadoPorSemanaSeries', () => {
  beforeEach(() => { filasPorTabla.set('gasto', []); filasPorTabla.set('liquidacion', []); filasPorTabla.set('viaje', []); });

  it('gasto: semanal=5 semanas, mensual=13, histórico=52', async () => {
    const r = await getGastoPorSemanaSeries('t1', '2026-08-08');
    expect(r.semanal.categorias).toHaveLength(5);
    expect(r.mensual.categorias).toHaveLength(13);
    expect(r.historico.categorias).toHaveLength(52);
  });

  it('liquidado: mismo mapeo de semanas', async () => {
    const r = await getLiquidadoPorSemanaSeries('t1', '2026-08-08');
    expect(r.semanal).toHaveLength(5);
    expect(r.mensual).toHaveLength(13);
    expect(r.historico).toHaveLength(52);
  });
});

describe('getTopRutasPorGastoSeries', () => {
  beforeEach(() => {
    filasPorTabla.set('gasto', []);
    filasPorTabla.set('viaje', []);
    filtrosVistos.length = 0;
  });

  it('histórico NO manda ventana — sin gte/lte, no una de 52 semanas disfrazada', async () => {
    await getTopRutasPorGastoSeries('t1', 5, '2026-08-08');
    // La tercera llamada a "gasto" (semanal, mensual, histórico en orden) es histórico.
    const llamadasGasto = filtrosVistos.filter((f) => f.tabla === 'gasto');
    expect(llamadasGasto).toHaveLength(3);
    expect(llamadasGasto[2].gte).toBeUndefined();
    expect(llamadasGasto[2].lte).toBeUndefined();
  });

  it('semanal SÍ manda ventana de 5 semanas', async () => {
    await getTopRutasPorGastoSeries('t1', 5, '2026-08-08');
    const llamadasGasto = filtrosVistos.filter((f) => f.tabla === 'gasto');
    expect(llamadasGasto[0].gte).toEqual(['fecha', '2026-07-05']);
    expect(llamadasGasto[0].lte).toEqual(['fecha', '2026-08-08']);
  });
});
