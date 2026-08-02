import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ auth: { getUser: (...a: unknown[]) => getUser(...a) }, from: (...a: unknown[]) => from(...(a as [])) }),
}));

const { getSessionTenant } = await import('./session');

describe('getSessionTenant', () => {
  beforeEach(() => { getUser.mockReset(); maybeSingle.mockReset(); eq.mockClear(); select.mockClear(); from.mockClear(); });

  it('sin usuario autenticado, regresa null', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await getSessionTenant()).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('con usuario y fila en app_user, regresa tenantId/rol/nombre', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u-1' } } });
    maybeSingle.mockResolvedValue({ data: { tenant_id: 't-1', rol: 'flota_admin', nombre: 'Ana' } });
    const r = await getSessionTenant();
    expect(from).toHaveBeenCalledWith('app_user');
    expect(select).toHaveBeenCalledWith('tenant_id, rol, nombre');
    expect(eq).toHaveBeenCalledWith('id', 'u-1');
    expect(r).toEqual({ userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana' });
  });

  it('usuario autenticado sin fila en app_user, tenantId null y valores por defecto', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u-2' } } });
    maybeSingle.mockResolvedValue({ data: null });
    const r = await getSessionTenant();
    expect(r).toEqual({ userId: 'u-2', tenantId: null, rol: 'flota_admin', nombre: null });
  });

  it('superadmin con fila app_user pero tenant_id null, preserva rol/nombre reales', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u-3' } } });
    maybeSingle.mockResolvedValue({ data: { tenant_id: null, rol: 'superadmin', nombre: 'Ana' } });
    const r = await getSessionTenant();
    expect(r).toEqual({ userId: 'u-3', tenantId: null, rol: 'superadmin', nombre: 'Ana' });
  });

  it('si Supabase truena, regresa null en vez de lanzar', async () => {
    getUser.mockRejectedValue(new Error('fetch failed'));
    expect(await getSessionTenant()).toBeNull();
  });
});
