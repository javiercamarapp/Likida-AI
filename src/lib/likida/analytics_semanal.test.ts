// ═══════════════════════════════════════════════════════════════════════════
// `getGastoPorSemana`/`getLiquidadoPorSemana` — las gráficas "Gasto por
// categoría" y "Liquidado por semana" que volvieron al Resumen el 8-ago-2026
// (pedido explícito de Javier, con capturas de referencia). Lo que hay que
// comprobar, mismo criterio que `analytics_serie_comparativa.test.ts`:
//
//   1. Los buckets son semanas ISO reales (lunes-domingo), no ventanas de 7
//      días sueltas que puedan partir una semana calendario a la mitad.
//   2. `getGastoPorSemana` NO fija categorías a mano — 'viaticos' es un
//      concepto heredado (el OCR ya no lo emite) y no debe aparecer en
//      ceros desplazando una categoría real con gasto de verdad.
//   3. `getLiquidadoPorSemana` bucketea por DÍA LOCAL MX (timestamptz), no
//      por el UTC crudo — mismo bug ya pagado en `getLiquidacionesPorDia`.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';

const filasPorTabla = new Map<string, unknown[]>();

function mockPaginado(tabla: string) {
  const b = {
    select: () => b,
    eq: () => b,
    gte: () => b,
    lte: () => b,
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

const { getGastoPorSemana, getLiquidadoPorSemana } = await import('./analytics');

describe('getGastoPorSemana', () => {
  beforeEach(() => { filasPorTabla.clear(); });

  it('devuelve `semanas` etiquetas, terminando en la semana de hoy', async () => {
    filasPorTabla.set('gasto', []);
    // 2026-08-08 es viernes de la semana ISO 32.
    const r = await getGastoPorSemana('t1', 3, '2026-08-08');
    expect(r.categorias).toEqual(['2026-S30', '2026-S31', '2026-S32']);
  });

  it('solo enseña las 3 categorías con más gasto — no fija ninguna a mano', async () => {
    filasPorTabla.set('gasto', [
      { fecha: '2026-08-05', concepto: 'diesel', monto: 1000 },
      { fecha: '2026-08-05', concepto: 'caseta', monto: 300 },
      { fecha: '2026-08-05', concepto: 'hospedaje', monto: 200 },
      { fecha: '2026-08-05', concepto: 'viaticos', monto: 10 }, // el concepto heredado, casi sin uso
    ]);
    const r = await getGastoPorSemana('t1', 1, '2026-08-08');
    expect(r.series.map((s) => s.nombre)).toEqual(['diesel', 'caseta', 'hospedaje']);
    expect(r.series.map((s) => s.nombre)).not.toContain('viaticos');
  });

  it('agrupa el gasto de cada semana en su propio bucket', async () => {
    filasPorTabla.set('gasto', [
      { fecha: '2026-08-05', concepto: 'diesel', monto: 500 }, // semana 32
      { fecha: '2026-07-29', concepto: 'diesel', monto: 300 }, // semana 31
    ]);
    const r = await getGastoPorSemana('t1', 2, '2026-08-08');
    const diesel = r.series.find((s) => s.nombre === 'diesel')!;
    expect(diesel.valores).toEqual([300, 500]); // [S31, S32]
  });
});

describe('getLiquidadoPorSemana', () => {
  beforeEach(() => { filasPorTabla.clear(); });

  it('suma PESOS (total_comprobado), no cuenta cierres', async () => {
    filasPorTabla.set('liquidacion', [
      { created_at: '2026-08-05T16:00:00.000000+00:00', total_comprobado: 1000 }, // 10:00 CDMX
      { created_at: '2026-08-05T18:00:00.000000+00:00', total_comprobado: 500 },
    ]);
    const r = await getLiquidadoPorSemana('t1', 1, '2026-08-08');
    expect(r[0].valor).toBe(1500);
  });

  it('bucketea por DÍA LOCAL MX, no por el UTC crudo del timestamptz', async () => {
    // 31-jul-2026 20:00 CDMX (UTC-6) = 2026-08-01T02:00:00Z, día local 31-jul
    // → semana ISO 31, no la 32 que el slice crudo le hubiera dado.
    filasPorTabla.set('liquidacion', [
      { created_at: '2026-08-01T02:00:00.000000+00:00', total_comprobado: 900 },
    ]);
    const r = await getLiquidadoPorSemana('t1', 2, '2026-08-08');
    expect(r).toEqual([
      { dia: '2026-S31', valor: 900 },
      { dia: '2026-S32', valor: 0 },
    ]);
  });

  it('sin liquidaciones en la ventana, todas las semanas salen en cero — no se omiten', async () => {
    filasPorTabla.set('liquidacion', []);
    const r = await getLiquidadoPorSemana('t1', 3, '2026-08-08');
    expect(r).toHaveLength(3);
    expect(r.every((x) => x.valor === 0)).toBe(true);
  });
});
