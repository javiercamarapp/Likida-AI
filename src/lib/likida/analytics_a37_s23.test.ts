// A37-S23-01 (ALTO): `proyectar_serie(gasto)` sumaba solo el top-3 de categorías y promediaba la
// semana ISO en curso (incompleta). La cifra venía de la tool, así que la guardia de cifras la aprobaba.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rpcFalso0150, type Tablas } from './analytics_rpc_0150.fixture';

const TABLAS: Tablas = {};
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string, args: Record<string, unknown>) =>
      Promise.resolve(rpcFalso0150(fn, args, TABLAS) ?? { data: null, error: null }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: vi.fn(), ventanaDesdeDB: vi.fn() }));

const { getGastoPorSemana } = await import('./analytics');
const { proyectarPuntos } = await import('@/lib/agents/chat-tools');

describe('A37-S23-01 — el total por corte incluye TODOS los conceptos', () => {
  beforeEach(() => { for (const k of Object.keys(TABLAS)) delete TABLAS[k]; });

  it('con 5 conceptos, totalPorCorte suma los 5 aunque las series solo traigan el top-3', async () => {
    const conceptos: Array<[string, number]> = [['diesel', 5000], ['caseta', 2000], ['hospedaje', 1500], ['comida', 1000], ['otro', 500]];
    TABLAS.gasto = conceptos.map(([concepto, monto]) => ({ tenant_id: 't1', fecha: '2026-08-05', concepto, monto }));
    const r = await getGastoPorSemana('t1', 1, '2026-08-08');
    expect(r.series).toHaveLength(3);
    expect(r.totalPorCorte).toEqual([10_000]);
  });
});

describe('A37-S23-01 — la semana en curso no se promedia y se declara', () => {
  it('excluye el último corte (parcial) del promedio, pero lo cuenta en lo observado', () => {
    const r = proyectarPuntos([100, 100, 100, 100, 10], { ultimoCorteParcial: true }) as
      { promedioPorCorte: number; sumaObservada: number; supuesto: string; cortesConDatos: number };
    expect(r.promedioPorCorte).toBe(100);
    expect(r.cortesConDatos).toBe(4);
    expect(r.sumaObservada).toBe(410);
    expect(r.supuesto).toMatch(/semana en curso|corte en curso/i);
  });

  it('si solo hay el corte parcial, no proyecta: dice sinDatos', () => {
    expect(proyectarPuntos([0, 0, 50], { ultimoCorteParcial: true })).toEqual({ sinDatos: true });
  });

  it('sin la opción, el comportamiento anterior no cambia', () => {
    const r = proyectarPuntos([100, 200]) as { promedioPorCorte: number };
    expect(r.promedioPorCorte).toBe(150);
  });
});
