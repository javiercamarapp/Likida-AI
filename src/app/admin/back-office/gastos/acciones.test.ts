import { beforeEach, describe, expect, it, vi } from 'vitest';

const d = vi.hoisted(() => ({ requireSuperadmin: vi.fn(), pasoExtra: vi.fn(), anotar: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: d.revalidatePath }));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: d.requireSuperadmin }));
vi.mock('@/lib/admin/acciones_riesgo', () => ({ pasoExtraSuperadmin: d.pasoExtra, anotarAccionAdmin: d.anotar, AVISO_SIN_BITACORA: ' OJO' }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('no debe tocar la base'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { accionAnularGasto, accionConciliarGasto, accionCrearGasto, accionRegistrarMovimiento } from './acciones';

const forma = (o: Record<string, string>): FormData => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

beforeEach(() => {
  d.requireSuperadmin.mockReset().mockResolvedValue({ userId: 'u1', rol: 'superadmin' });
  d.pasoExtra.mockReset().mockResolvedValue(null);
  d.anotar.mockReset().mockResolvedValue(true);
  d.revalidatePath.mockReset();
});

describe('acciones de Gastos', () => {
  it('todas pasan por la puerta del superadmin', async () => {
    await accionCrearGasto(null, forma({}));
    await accionConciliarGasto(null, forma({}));
    await accionAnularGasto(null, forma({}));
    await accionRegistrarMovimiento(null, forma({}));
    expect(d.requireSuperadmin).toHaveBeenCalledTimes(4);
  });

  it('un gasto en USD sin tipo de cambio se rechaza con el mensaje claro y no toca la base ni la bitácora', async () => {
    const r = await accionCrearGasto(null, forma({ fecha: '2026-11-03', concepto: 'Pro', moneda: 'USD', monto: '20', comprobante: 'sin_comprobante' }));
    expect(r).toEqual({ error: expect.stringContaining('tipo de cambio') });
    expect(d.anotar).not.toHaveBeenCalled();
    expect(d.revalidatePath).not.toHaveBeenCalled();
  });

  it('un importe ambiguo («50,000») se rechaza en vez de adivinarse', async () => {
    const r = await accionCrearGasto(null, forma({ fecha: '2026-11-03', concepto: 'Pro', moneda: 'MXN', monto: '50,000', comprobante: 'sin_comprobante' }));
    expect(r).toEqual({ error: expect.stringContaining('ambiguo') });
  });

  it('conciliar sin referencia de banco ni movimiento se rechaza', async () => {
    const r = await accionConciliarGasto(null, forma({ gastoId: 'g1' }));
    expect(r).toEqual({ error: expect.stringContaining('referencia de banco') });
    expect(d.anotar).not.toHaveBeenCalled();
  });

  it('conciliar y mover tesorería piden el segundo factor: si falta, no avanzan', async () => {
    d.pasoExtra.mockResolvedValue('Falta el segundo factor');
    expect(await accionConciliarGasto(null, forma({ gastoId: 'g1', referenciaBanco: 'SPEI 12345' }))).toEqual({ error: 'Falta el segundo factor' });
    expect(await accionRegistrarMovimiento(null, forma({ cuentaId: 'c1' }))).toEqual({ error: 'Falta el segundo factor' });
  });

  it('anular exige motivo', async () => {
    expect(await accionAnularGasto(null, forma({ gastoId: 'g1', motivo: 'x' }))).toEqual({ error: expect.stringContaining('motivo') });
  });
});
