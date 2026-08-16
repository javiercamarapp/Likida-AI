// ═══════════════════════════════════════════════════════════════════════════
// `getSerieComparativa` — DESDE EL 15-AGO-2026 (mig. 0112) la agregación vive
// EN SQL (`serie_comparativa_tenant`), no en TS: periodos consecutivos sin
// traslape, bucketeo por día LOCAL MX de `liquidacion.created_at` y conteo de
// liquidados son garantías de la función SQL, y ese SQL es runtime-ruidoso
// (si falta la migración, la llamada al RPC falla).
//
// Lo que TS conserva y estos tests prueban:
//   1. Llama al RPC con el contrato exacto (p_tenant/ventana/pasos/hoy).
//   2. Exige EXACTAMENTE `pasos` periodos — forma distinta = fail-closed con
//      aviso de la migración 0112 (no se lee "cero" como "flota sin actividad").
//   3. Mapea a números y conserva `null` cuando no hay viajes en el bucket.
//   4. El error del RPC se propaga, no se traga.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';

const rpcEstado: { args?: Record<string, unknown>; respuesta?: unknown; error?: unknown } = {};

function mockBuilder() {
  return {
    from: () => ({ select: () => ({ limit: () => ({ order: () => ({ data: [], error: null }) }) }) }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== 'serie_comparativa_tenant') return { data: [], error: null };
      rpcEstado.args = args;
      if (rpcEstado.error) return { data: null, error: rpcEstado.error };
      return { data: rpcEstado.respuesta, error: null };
    },
  };
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => mockBuilder() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { getSerieComparativa } = await import('./analytics');

function periodo(desde: string, hasta: string, datos: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    desde,
    hasta,
    gastoTotal: 0,
    totalViajes: 0,
    costoPorViaje: null,
    liquidado: 0,
    viajesLiquidados: 0,
    ...datos,
  };
}

describe('getSerieComparativa (contrato TS → RPC, mig. 0112)', () => {
  beforeEach(() => {
    rpcEstado.args = undefined;
    rpcEstado.respuesta = undefined;
    rpcEstado.error = undefined;
  });

  it('llama al RPC con el contrato exacto (tenant, ventana, pasos, hoy) y devuelve `pasos` periodos', async () => {
    rpcEstado.respuesta = [periodo('2026-08-02', '2026-08-08'), periodo('2026-07-26', '2026-08-01'), periodo('2026-07-19', '2026-07-25')];
    const r = await getSerieComparativa('t1', 7, 3, '2026-08-08');
    expect(rpcEstado.args).toMatchObject({ p_tenant: 't1', p_ventana_dias: 7, p_pasos: 3, p_hoy: '2026-08-08' });
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({ desde: '2026-08-02', hasta: '2026-08-08' });
  });

  it('mapea a números y conserva null cuando el periodo no tiene costo por viaje', async () => {
    rpcEstado.respuesta = [
      periodo('2026-08-02', '2026-08-08', { gastoTotal: '100', totalViajes: '2', costoPorViaje: '50' }),
      periodo('2026-07-26', '2026-08-01', { gastoTotal: 80, totalViajes: 0, costoPorViaje: null }),
    ];
    const r = await getSerieComparativa('t1', 7, 2, '2026-08-08');
    expect(r[0].gastoTotal).toBe(100);
    expect(r[0].totalViajes).toBe(2);
    expect(r[0].costoPorViaje).toBe(50);
    expect(r[1].costoPorViaje).toBeNull();
    expect(r[1].gastoTotal).toBe(80);
  });

  it('fail-closed: forma distinta de `pasos` periodos lanza y avisa de la migración 0112', async () => {
    rpcEstado.respuesta = [periodo('2026-08-02', '2026-08-08')]; // 1, pero pedimos 3
    await expect(getSerieComparativa('t1', 7, 3, '2026-08-08')).rejects.toThrow(/0112|otra forma/);
  });

  it('el error del RPC se propaga con contexto del caller', async () => {
    rpcEstado.error = { message: 'relation public.serie_comparativa_tenant does not exist' };
    await expect(getSerieComparativa('t1', 7, 2, '2026-08-08')).rejects.toThrow(/getSerieComparativa/);
  });
});