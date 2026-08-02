import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirect(...(a as [])) }));

const getSessionTenant = vi.fn();
vi.mock('./session', () => ({ getSessionTenant: (...a: unknown[]) => getSessionTenant(...a) }));

const { requireSessionTenant } = await import('./guard');

describe('requireSessionTenant', () => {
  beforeEach(() => { redirect.mockClear(); getSessionTenant.mockReset(); });

  it('sin sesión, manda a /login con el next codificado', async () => {
    getSessionTenant.mockResolvedValue(null);
    await expect(requireSessionTenant('/dashboard/abc-123')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/dashboard/abc-123')}`);
  });

  it('con sesión pero sin tenant (superadmin o sin alta), manda a /sin-acceso', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u-1', tenantId: null, rol: 'flota_admin', nombre: null });
    await expect(requireSessionTenant('/dashboard')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/sin-acceso');
  });

  it('con sesión y tenant, regresa el SessionTenant tal cual', async () => {
    const s = { userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana' };
    getSessionTenant.mockResolvedValue(s);
    await expect(requireSessionTenant('/dashboard')).resolves.toEqual(s);
    expect(redirect).not.toHaveBeenCalled();
  });
});
