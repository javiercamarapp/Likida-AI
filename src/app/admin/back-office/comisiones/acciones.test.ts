import { beforeEach, describe, expect, it, vi } from 'vitest';

const d = vi.hoisted(() => ({ requireSuperadmin: vi.fn(), pasoExtra: vi.fn(), anotar: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: d.revalidatePath }));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: d.requireSuperadmin }));
vi.mock('@/lib/admin/acciones_riesgo', () => ({ pasoExtraSuperadmin: d.pasoExtra, anotarAccionAdmin: d.anotar, AVISO_SIN_BITACORA: ' OJO' }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('no debe tocar la base'); } }));
vi.mock('@/lib/saas/transferencia', () => ({ listarFacturasSaas: vi.fn(), TECHO_FACTURAS_SAAS: 2000 }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { accionAutorizarPago, accionDevengarPeriodo, accionMarcarPagado, accionRegistrarCfdi } from './acciones';

const forma = (o: Record<string, string>): FormData => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

beforeEach(() => {
  d.requireSuperadmin.mockReset().mockResolvedValue({ userId: 'u1', rol: 'superadmin' });
  d.pasoExtra.mockReset().mockResolvedValue(null);
  d.anotar.mockReset().mockResolvedValue(true);
});

describe('acciones de Comisiones', () => {
  it('todas mueven dinero: puerta del superadmin y segundo factor; sin él no avanzan', async () => {
    d.pasoExtra.mockResolvedValue('Falta el segundo factor');
    for (const a of [accionDevengarPeriodo, accionRegistrarCfdi, accionAutorizarPago, accionMarcarPagado]) {
      expect(await a(null, forma({}))).toEqual({ error: 'Falta el segundo factor' });
    }
    expect(d.requireSuperadmin).toHaveBeenCalledTimes(4);
    expect(d.anotar).not.toHaveBeenCalled();
  });

  it('devengar un periodo inválido se rechaza antes de tocar la base', async () => {
    expect(await accionDevengarPeriodo(null, forma({ periodo: '2026-13-01' }))).toEqual({ error: expect.stringContaining('periodo') });
  });

  it('el CFDI de honorarios debe tener formato de UUID y la fecha de recibido no puede ser futura', async () => {
    expect(await accionRegistrarCfdi(null, forma({ vendedorId: 'v1', periodo: '2026-11-01', cfdiUuid: 'nada', recibidoEn: '2026-11-10' }))).toEqual({ error: expect.stringContaining('UUID') });
    expect(await accionRegistrarCfdi(null, forma({ vendedorId: 'v1', periodo: '2026-11-01', cfdiUuid: 'aaaaaaaa-0000-4000-8000-000000000001', recibidoEn: '2099-01-01' }))).toEqual({ error: expect.stringContaining('futura') });
  });

  it('marcar pagado exige referencia (nunca marca sin evidencia)', async () => {
    expect(await accionMarcarPagado(null, forma({ pagoId: 'p1', pagadoEn: '2026-11-10' }))).toEqual({ error: expect.stringContaining('referencia de banco') });
  });
});
