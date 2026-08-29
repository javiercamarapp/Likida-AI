import { describe, it, expect, vi, beforeEach } from 'vitest';

// La puerta de /api/mcp: qué credencial abre, qué alcanza, y que los fallos
// distingan «no vales» (401) de «no pude verificar» (503).

const resolverLlaveMock = vi.fn();
const validarAccesoMock = vi.fn();
vi.mock('@/lib/auth/llave-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/auth/llave-api')>();
  return { ...real, resolverLlave: (...a: unknown[]) => resolverLlaveMock(...a) };
});
vi.mock('@/lib/mcp/oauth', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/mcp/oauth')>();
  return { ...real, validarAcceso: (...a: unknown[]) => validarAccesoMock(...a) };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('no debería tocar la base'); } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { resolverCredencialMcp } from './credencial';

beforeEach(() => {
  resolverLlaveMock.mockReset();
  validarAccesoMock.mockReset();
});

describe('resolverCredencialMcp', () => {
  it('sin header → 401 que dice cómo conectarse', async () => {
    const r = await resolverCredencialMcp(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it('un esquema que no es Bearer → 401', async () => {
    const r = await resolverCredencialMcp('Basic dXNlcjpwYXNz');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it('una llave resuelve tenant y su área acota: operacion NO alcanza dinero', async () => {
    resolverLlaveMock.mockResolvedValue({ ok: true, tenantId: 't-A', area: 'operacion', llaveId: 'k-1' });
    const r = await resolverCredencialMcp('Bearer lk_live_abcdef123456');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.credencial.tenantId).toBe('t-A');
      expect(r.credencial.via).toBe('llave');
      expect(r.credencial.alcanza('operacion')).toBe(true);
      expect(r.credencial.alcanza('dinero')).toBe(false);
      expect(r.credencial.alcanza('administracion')).toBe(false);
    }
  });

  it('un token OAuth resuelve por ROL: contador ve dinero y no operación', async () => {
    validarAccesoMock.mockResolvedValue({
      ok: true,
      acceso: { tokenId: 'tk', tenantId: 't-B', userId: 'u-1', userEmail: 'c@f.mx', rol: 'contador' },
    });
    const r = await resolverCredencialMcp('Bearer lk_mcp_at_xyz');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.credencial.tenantId).toBe('t-B');
      expect(r.credencial.via).toBe('oauth');
      expect(r.credencial.alcanza('dinero')).toBe(true);
      expect(r.credencial.alcanza('operacion')).toBe(false);
      expect(r.credencial.actor).toEqual({ id: 'u-1', email: 'c@f.mx' });
    }
  });

  it('un rol DESCONOCIDO en el token no alcanza nada: fail closed', async () => {
    validarAccesoMock.mockResolvedValue({
      ok: true,
      acceso: { tokenId: 'tk', tenantId: 't-B', userId: 'u-1', userEmail: null, rol: 'rol_inventado' },
    });
    const r = await resolverCredencialMcp('Bearer lk_mcp_at_xyz');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.credencial.alcanza('operacion')).toBe(false);
      expect(r.credencial.alcanza('dinero')).toBe(false);
    }
  });

  it('un refresco o un código pegados donde va el acceso → 401, sin tocar la base', async () => {
    for (const t of ['Bearer lk_mcp_rt_xyz', 'Bearer lk_mcp_ac_xyz']) {
      const r = await resolverCredencialMcp(t);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(401);
    }
    expect(validarAccesoMock).not.toHaveBeenCalled();
    expect(resolverLlaveMock).not.toHaveBeenCalled();
  });

  it('la base caída al validar el token es 503, no 401', async () => {
    validarAccesoMock.mockResolvedValue({ ok: false, error: 'no_disponible', detalle: 'No se pudo verificar el token. Intenta de nuevo.' });
    const r = await resolverCredencialMcp('Bearer lk_mcp_at_xyz');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(503);
  });

  it('el token vencido es 401 (validarAcceso ya lo decidió)', async () => {
    validarAccesoMock.mockResolvedValue({ ok: false, error: 'no_valido', detalle: 'Token inválido o expirado.' });
    const r = await resolverCredencialMcp('Bearer lk_mcp_at_xyz');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.motivo).toBe('Token inválido o expirado.');
    }
  });
});
