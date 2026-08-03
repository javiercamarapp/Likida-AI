import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirect(...(a as [])) }));

const getSessionTenant = vi.fn();
vi.mock('./session', () => ({ getSessionTenant: (...a: unknown[]) => getSessionTenant(...a) }));

const { requireSessionTenant, requireOperador, requireSuperadmin } = await import('./guard');

describe('requireSessionTenant', () => {
  beforeEach(() => { redirect.mockClear(); getSessionTenant.mockReset(); });

  it('sin sesión, manda a /login con el next codificado', async () => {
    getSessionTenant.mockResolvedValue(null);
    await expect(requireSessionTenant('/dashboard/abc-123')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/dashboard/abc-123')}`);
  });

  it('con sesión pero sin tenant y sin alta en app_user (rol default flota_admin), manda a /sin-acceso', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u-1', tenantId: null, rol: 'flota_admin', nombre: null });
    await expect(requireSessionTenant('/dashboard')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/sin-acceso');
  });

  it('superadmin (tenant_id null por diseño) NO va a /sin-acceso — cae al tenant demo', async () => {
    vi.stubEnv('DEMO_TENANT_ID', 'demo-tenant-id');
    getSessionTenant.mockResolvedValue({ userId: 'u-2', tenantId: null, rol: 'superadmin', nombre: 'Javier' });
    const r = await requireSessionTenant('/dashboard');
    expect(redirect).not.toHaveBeenCalled();
    expect(r).toEqual({ userId: 'u-2', tenantId: 'demo-tenant-id', rol: 'superadmin', nombre: 'Javier' });
    vi.unstubAllEnvs();
  });

  it('con sesión y tenant, regresa el SessionTenant tal cual', async () => {
    const s = { userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana' };
    getSessionTenant.mockResolvedValue(s);
    await expect(requireSessionTenant('/dashboard')).resolves.toEqual(s);
    expect(redirect).not.toHaveBeenCalled();
  });
});

// `requireOperador` es la puerta de /mis-viajes (Task 5 del plan de roles):
// el reverso de `requireSessionTenant`, que asume el panel de flota_admin/
// encargado/contador. Un chofer que aterrice ahí por error no debe ver ESE
// panel (RLS ya se lo impediría, pero la UI ni se lo ofrece).
describe('requireOperador', () => {
  beforeEach(() => { redirect.mockClear(); getSessionTenant.mockReset(); });

  it('sin sesión, manda a /login', async () => {
    getSessionTenant.mockResolvedValue(null);
    await expect(requireOperador()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/mis-viajes')}`);
  });

  it('rol distinto de operador (flota_admin, encargado, contador, superadmin) manda a /dashboard — es SU panel, no el de un chofer', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana', operadorId: null });
    await expect(requireOperador()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('operador sin operador_id ligado (alta a medias) manda a /sin-acceso', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u-2', tenantId: 't-1', rol: 'operador', nombre: 'Juan', operadorId: null });
    await expect(requireOperador()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/sin-acceso');
  });

  it('operador con todo en regla, regresa la sesión con operadorId no nulo', async () => {
    const s = { userId: 'u-3', tenantId: 't-1', rol: 'operador', nombre: 'Juan', operadorId: 'o-9' };
    getSessionTenant.mockResolvedValue(s);
    await expect(requireOperador()).resolves.toEqual(s);
    expect(redirect).not.toHaveBeenCalled();
  });
});

// `requireSuperadmin` es la puerta de /admin — la consola de negocio de
// Likida (docs/superpowers/plans/2026-08-02-panel-superadmin.md). Ningún
// otro rol la ve: ni siquiera flota_admin, que sí ve todo SU tenant, ve
// cuánto gasta Likida en IA o cuántos tenants tiene.
describe('requireSuperadmin', () => {
  beforeEach(() => { redirect.mockClear(); getSessionTenant.mockReset(); });

  it('sin sesión, manda a /login', async () => {
    getSessionTenant.mockResolvedValue(null);
    await expect(requireSuperadmin()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/admin')}`);
  });

  it('cualquier rol que no sea superadmin manda a /dashboard — es SU panel, no la consola de negocio', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana', operadorId: null });
    await expect(requireSuperadmin()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('superadmin entra sin redirigir', async () => {
    const s = { userId: 'u-2', tenantId: null, rol: 'superadmin', nombre: 'Javier', operadorId: null };
    getSessionTenant.mockResolvedValue(s);
    await expect(requireSuperadmin()).resolves.toEqual(s);
    expect(redirect).not.toHaveBeenCalled();
  });
});
