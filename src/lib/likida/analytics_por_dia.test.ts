// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 12, ALTO (pruebas): `getLiquidacionesPorDia` tenía 0% de cobertura
// y un bug de zona horaria vivo — `.slice(0,10)` sobre el timestamptz UTC
// fechaba en el día siguiente los cierres de la tarde. Es la gráfica de barras
// que el guion del demo proyecta en el paso 4.
//
// ESCALA 50k (mig. 0150): el bucket por día LOCAL MX vive ahora en
// `liquidaciones_por_dia_tenant`; el mock es el Postgres falso de la 0150.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rpcFalso0150, type Tablas } from './analytics_rpc_0150.fixture';

const TABLAS: Tablas = {};
/** La cota inferior que la consulta mandó a la base (auditoría de escala 15k:
 *  sin ella, la gráfica de 7 días leía TODO el histórico de `liquidacion`). */
let corteVisto: unknown = null;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      corteVisto = args.p_desde;
      return Promise.resolve(rpcFalso0150(fn, args, TABLAS) ?? { data: null, error: null });
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: vi.fn(), ventanaDesdeDB: vi.fn() }));

const { getLiquidacionesPorDia } = await import('./analytics');

const sembrar = (filas: Array<{ created_at: string }>) => {
  TABLAS.liquidacion = filas.map((f) => ({ tenant_id: 't1', ...f }));
};

describe('getLiquidacionesPorDia — el bucket por día respeta la hora local', () => {
  beforeEach(() => { sembrar([]); corteVisto = null; });

  it('acota la lectura a la ventana: la cota es la medianoche UTC del día MX más viejo', async () => {
    // Ventana de 3 días terminando el 2026-08-01 → día más viejo 2026-07-30.
    // MX (UTC-6) empieza ese día a las 06:00Z, así que la cota de 00:00Z solo
    // puede sobrar hacia el pasado — nunca recortar un cierre de la ventana.
    await getLiquidacionesPorDia('t1', 3, '2026-08-01');
    expect(corteVisto).toBe('2026-07-30T00:00:00Z');
  });

  it('un cierre de las 20:00 CDMX cae en SU día local, no en el UTC siguiente', async () => {
    // 31-jul-2026 20:00 CDMX (UTC-6) = 2026-08-01T02:00:00Z. El slice crudo
    // daba '2026-08-01' y la barra se movía un día. Con TZ_MX debe dar 2026-07-31.
    sembrar([{ created_at: '2026-08-01T02:00:00.000000+00:00' }]);
    const r = await getLiquidacionesPorDia('t1', 3, '2026-08-01');
    const dia = r.find((x) => x.valor > 0)!;
    expect(dia.dia).toBe('2026-07-31');
  });

  it('un cierre de las 10:00 CDMX cae en el MISMO día UTC (sin corrimiento)', async () => {
    sembrar([{ created_at: '2026-07-31T16:00:00.000000+00:00' }]);  // 10:00 CDMX
    const r = await getLiquidacionesPorDia('t1', 3, '2026-08-01');
    const dia = r.find((x) => x.valor > 0)!;
    expect(dia.dia).toBe('2026-07-31');
  });

  it('llena la ventana completa con ceros — el hueco es un día sin cierres, no un dato ausente', async () => {
    sembrar([{ created_at: '2026-07-31T16:00:00.000000+00:00' }]);
    const r = await getLiquidacionesPorDia('t1', 3, '2026-08-01');
    expect(r).toHaveLength(3);
    expect(r.map((x) => x.dia)).toEqual(['2026-07-30', '2026-07-31', '2026-08-01']);
    expect(r.reduce((s, x) => s + x.valor, 0)).toBe(1);
  });
});
