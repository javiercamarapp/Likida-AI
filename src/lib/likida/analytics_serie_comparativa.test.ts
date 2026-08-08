// ═══════════════════════════════════════════════════════════════════════════
// `getSerieComparativa` reemplazó a `getTendenciaKpis`/`comparativoEnRango`
// el 8-ago-2026 — las flechas ‹ › de cada tarjeta de KPI necesitan una serie
// de periodos, no solo un par actual/anterior. Lo que hay que comprobar,
// igual que se hizo con `getLiquidacionesPorDia` (analytics_por_dia.test.ts):
//
//   1. Los periodos son consecutivos, SIN traslape, terminando en `hoy`.
//   2. `gasto`/`viaje` bucketean por su columna `date` (comparación directa).
//   3. `liquidacion.created_at` (timestamptz) bucketea por DÍA LOCAL MX, no
//      por el UTC crudo — el mismo bug que ya se pagó en
//      `getLiquidacionesPorDia` (un cierre de tarde cayendo en el día
//      siguiente).
//   4. `costoPorViaje` es `null` sin viajes en el bucket, no Infinity/0.
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

const { getSerieComparativa } = await import('./analytics');

describe('getSerieComparativa', () => {
  beforeEach(() => { filasPorTabla.clear(); });

  it('devuelve `pasos` periodos consecutivos de `ventanaDias` días, sin traslape, terminando en hoy', async () => {
    const r = await getSerieComparativa('t1', 7, 3, '2026-08-08');
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({ desde: '2026-08-02', hasta: '2026-08-08' });
    expect(r[1]).toMatchObject({ desde: '2026-07-26', hasta: '2026-08-01' });
    expect(r[2]).toMatchObject({ desde: '2026-07-19', hasta: '2026-07-25' });
  });

  it('gasto y viajes bucketean por fecha simple en el periodo correcto', async () => {
    // Periodos (7 días, hoy=8-ago): bucket0 = [02..08 ago], bucket1 = [26 jul..01 ago].
    filasPorTabla.set('gasto', [
      { fecha: '2026-08-08', monto: 100 }, // bucket 0
      { fecha: '2026-08-01', monto: 50 },  // bucket 1 (justo el último día)
      { fecha: '2026-07-26', monto: 30 },  // bucket 1
    ]);
    filasPorTabla.set('viaje', [
      { fecha_inicio: '2026-08-05' }, // bucket 0
      { fecha_inicio: '2026-08-05' }, // bucket 0
      { fecha_inicio: '2026-07-30' }, // bucket 1
    ]);
    filasPorTabla.set('liquidacion', []);

    const r = await getSerieComparativa('t1', 7, 2, '2026-08-08');
    expect(r[0].gastoTotal).toBe(100);
    expect(r[0].totalViajes).toBe(2);
    expect(r[0].costoPorViaje).toBe(50);
    expect(r[1].gastoTotal).toBe(80);
    expect(r[1].totalViajes).toBe(1);
  });

  it('costoPorViaje es null sin viajes en el periodo, no Infinity ni 0', async () => {
    filasPorTabla.set('gasto', [{ fecha: '2026-08-08', monto: 500 }]);
    filasPorTabla.set('viaje', []);
    filasPorTabla.set('liquidacion', []);

    const r = await getSerieComparativa('t1', 7, 1, '2026-08-08');
    expect(r[0].totalViajes).toBe(0);
    expect(r[0].costoPorViaje).toBeNull();
  });

  it('liquidado bucketea por DÍA LOCAL MX, no por el UTC crudo del timestamptz', async () => {
    // 31-jul-2026 20:00 CDMX (UTC-6) = 2026-08-01T02:00:00Z — un slice crudo
    // lo pondría en el bucket que empieza el 1-ago; el día local es 31-jul.
    filasPorTabla.set('gasto', []);
    filasPorTabla.set('viaje', []);
    filasPorTabla.set('liquidacion', [
      { created_at: '2026-08-01T02:00:00.000000+00:00', total_comprobado: 1000 }, // día local 31-jul
      { created_at: '2026-08-08T16:00:00.000000+00:00', total_comprobado: 500 },  // 10:00 CDMX, 8-ago
    ]);

    const r = await getSerieComparativa('t1', 7, 2, '2026-08-08');
    // bucket 0 = 02..08 ago: solo el segundo cierre (día local 8-ago).
    expect(r[0].liquidado).toBe(500);
    // bucket 1 = 26 jul..01 ago: el cierre de "tarde" cae aquí, en su día local.
    expect(r[1].liquidado).toBe(1000);
  });
});
