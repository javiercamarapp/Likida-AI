// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 12, ALTO (pruebas): `getLiquidacionesPorDia` tenía 0% de cobertura
// y un bug de zona horaria vivo — `.slice(0,10)` sobre el timestamptz UTC
// fechaba en el día siguiente los cierres de la tarde. Es la gráfica de barras
// que el guion del demo proyecta en el paso 4.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

let filas: Array<{ created_at: string }> = [];

function mockPaginado() {
  const pideConteo = false;
  const b = {
    select: () => b,
    eq: () => b,
    order: () => b,
    range: (desde: number, hasta: number) => Promise.resolve({
      data: filas.slice(desde, hasta + 1), error: null, count: undefined,
    }),
  };
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => mockPaginado() }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: vi.fn(), ventanaDesdeDB: vi.fn() }));

const { getLiquidacionesPorDia } = await import('./analytics');

describe('getLiquidacionesPorDia — el bucket por día respeta la hora local', () => {
  beforeEach(() => { filas = []; });

  it('un cierre de las 20:00 CDMX cae en SU día local, no en el UTC siguiente', async () => {
    // 31-jul-2026 20:00 CDMX (UTC-6) = 2026-08-01T02:00:00Z. El slice crudo
    // daba '2026-08-01' y la barra se movía un día. Con TZ_MX debe dar 2026-07-31.
    filas = [{ created_at: '2026-08-01T02:00:00.000000+00:00' }];
    const r = await getLiquidacionesPorDia('t1', 3, '2026-08-01');
    const dia = r.find((x) => x.valor > 0)!;
    expect(dia.dia).toBe('2026-07-31');
  });

  it('un cierre de las 10:00 CDMX cae en el MISMO día UTC (sin corrimiento)', async () => {
    filas = [{ created_at: '2026-07-31T16:00:00.000000+00:00' }];  // 10:00 CDMX
    const r = await getLiquidacionesPorDia('t1', 3, '2026-08-01');
    const dia = r.find((x) => x.valor > 0)!;
    expect(dia.dia).toBe('2026-07-31');
  });

  it('llena la ventana completa con ceros — el hueco es un día sin cierres, no un dato ausente', async () => {
    filas = [{ created_at: '2026-07-31T16:00:00.000000+00:00' }];
    const r = await getLiquidacionesPorDia('t1', 3, '2026-08-01');
    expect(r).toHaveLength(3);
    expect(r.map((x) => x.dia)).toEqual(['2026-07-30', '2026-07-31', '2026-08-01']);
    expect(r.reduce((s, x) => s + x.valor, 0)).toBe(1);
  });
});
