// AUDITORÍA 25, SEGURIDAD (ALTO, línea 166, REINCIDENTE). La puerta
// compartida de /api/admin/* — antes tres copias, una por familia de rutas,
// ninguna preguntaba por el segundo factor. Mismo patrón de mocks que
// guard.test.ts: `mfaSuperadminObligatorio` se deja REAL para que la palanca
// de env sea la que se prueba.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Sesion = { tenantId: string | null; rol: string; userId: string; nombre: string | null };
const getSessionTenant = vi.fn<() => Promise<Sesion | null>>();
vi.mock('./session', () => ({ getSessionTenant: () => getSessionTenant() }));

const veredictoMfa = vi.fn(async (): Promise<string> => 'ok');
vi.mock('./mfa', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  veredictoMfaSuperadmin: () => veredictoMfa(),
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({}) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { sesionSuperadmin } = await import('./api-superadmin');

const SUPER: Sesion = { userId: 'u-1', tenantId: null, rol: 'superadmin', nombre: 'Javier' };

describe('sesionSuperadmin (puerta compartida de /api/admin/*)', () => {
  beforeEach(() => {
    getSessionTenant.mockReset();
    veredictoMfa.mockReset();
    veredictoMfa.mockResolvedValue('ok');
    vi.unstubAllEnvs();
  });

  it('sin sesión: 401', async () => {
    getSessionTenant.mockResolvedValue(null);
    const r = await sesionSuperadmin();
    expect(r.sesion).toBeNull();
    expect(r.error?.status).toBe(401);
  });

  it('otro rol: 403', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u-2', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana' });
    const r = await sesionSuperadmin();
    expect(r.sesion).toBeNull();
    expect(r.error?.status).toBe(403);
  });

  it('superadmin, palanca APAGADA: entra sin preguntar por el factor', async () => {
    getSessionTenant.mockResolvedValue(SUPER);
    veredictoMfa.mockResolvedValue('inscribir');
    const r = await sesionSuperadmin();
    expect(r.error).toBeNull();
    expect(r.sesion).toEqual(SUPER);
    expect(veredictoMfa).not.toHaveBeenCalled();
  });

  it.each(['inscribir', 'retar', 'no_verificable'])(
    'superadmin, palanca puesta, veredicto %s: 403 — la cookie phishada sin factor NO entra',
    async (veredicto) => {
      vi.stubEnv('LIKIDA_SUPERADMIN_MFA', 'obligatorio');
      getSessionTenant.mockResolvedValue(SUPER);
      veredictoMfa.mockResolvedValue(veredicto);
      const r = await sesionSuperadmin();
      expect(r.sesion).toBeNull();
      expect(r.error?.status).toBe(403);
    });

  it('superadmin, palanca puesta, veredicto ok: entra', async () => {
    vi.stubEnv('LIKIDA_SUPERADMIN_MFA', 'obligatorio');
    getSessionTenant.mockResolvedValue(SUPER);
    veredictoMfa.mockResolvedValue('ok');
    const r = await sesionSuperadmin();
    expect(r.error).toBeNull();
    expect(r.sesion).toEqual(SUPER);
  });
});
