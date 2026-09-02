// ═══════════════════════════════════════════════════════════════════════════
// AUD24 · cobertura de dinero — borde nuevo para `saveLiquidacion` (repo.ts).
//
// `repo_escritura.test.ts` ya ancla `p_n_gastos: 6` y `p_n_gastos: null`
// (sin conteo), pero no el borde entre "no comprobar" (null) y "comprobar
// contra CERO" (0): un viaje con TODOS sus comprobantes rechazados o
// borrados antes de cerrar cierra con `nGastos = 0`, no `undefined`. El
// error clásico es `nGastos || null`, que convierte ese 0 legítimo en
// `null` — y el sello CU003 (mig. 0158) deja de poder comparar "el viaje
// tenía 0 y ahora tiene 1" justo en el caso que más le interesa detectar:
// una foto que entró después de que el chofer dijo "ya no traigo nada".
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Liquidacion } from '@/types/likida';

const rpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => ({ insert: vi.fn() }), rpc: (...a: unknown[]) => rpc(...a) }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { saveLiquidacion } = await import('./repo');

const liq: Omit<Liquidacion, 'id' | 'creadaEn'> = {
  viajeId: 'v1', totalComprobado: 0, totalAnticipo: 5000, diferencia: 5000,
  estatus: 'cuadrada', totalDeducible: 0, totalNoDeducible: 0, totalPorConfirmar: 0,
  diferencias: [], gastos: [], iepsAcreditable: 0, litrosDieselAcreditables: 0,
  ivaAcreditable: 0, peajeAcreditable: 0,
};

describe('saveLiquidacion — el borde de nGastos = 0', () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: 'liq-1', error: null }); });

  it('con nGastos=0 (todos los comprobantes rechazados), la RPC recibe 0, NUNCA null', async () => {
    await saveLiquidacion('t1', liq, undefined, 0);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_n_gastos: 0 });
    // El error clásico (`||`) convertiría 0 en null — que es exactamente lo
    // que `p_n_gastos: null` ya cubre para "sin conteo, no comprobar".
    expect(rpc.mock.calls[0][1].p_n_gastos).not.toBeNull();
  });
});
