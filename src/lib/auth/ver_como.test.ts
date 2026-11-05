import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getSessionTenant = vi.fn();
vi.mock('./session', () => ({ getSessionTenant: () => getSessionTenant() }));
const resolverTenantEfectivo = vi.fn();
vi.mock('./tenant-efectivo', () => ({ resolverTenantEfectivo: (...a: unknown[]) => resolverTenantEfectivo(...a) }));

const { exigirEscrituraPermitida, verComoSoloLecturaActivo, VerComoSoloLecturaError, esVerComoDeFlotaReal } = await import('./ver_como');
const { resolverTenantAtadoAccion, resolverTenantAtadoFirmado, firmarFlotaPintada } = await import('./tenant-atado');

const A = '11111111-1111-4111-8111-111111111111';
const verComoReal = { tenantId: A, rol: 'flota_admin', rolReal: 'superadmin', tenantNombre: 'Flota Cliente' };

beforeEach(() => {
  process.env.LIKIDA_FLOTA_COOKIE_LLAVE = 'llave-de-prueba-0123456789';
  resolverTenantEfectivo.mockReset();
  getSessionTenant.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('ver como: solo lectura (palanca)', () => {
  it('apagado por omisión: el superadmin sigue escribiendo', async () => {
    expect(verComoSoloLecturaActivo({})).toBe(false);
    resolverTenantEfectivo.mockResolvedValue(verComoReal);
    expect(await resolverTenantAtadoAccion('/dashboard/x', { tenant: A }, A)).toMatchObject({ tenantId: A });
  });

  it('encendido: la acción de escritura del superadmin sobre una flota real LANZA y no devuelve sesión', async () => {
    vi.stubEnv('LIKIDA_VER_COMO_SOLO_LECTURA', 'activo');
    resolverTenantEfectivo.mockResolvedValue(verComoReal);
    await expect(resolverTenantAtadoAccion('/dashboard/x', { tenant: A }, A)).rejects.toBeInstanceOf(VerComoSoloLecturaError);
  });

  it('encendido: la ruta firmada tampoco deja escribir', async () => {
    vi.stubEnv('LIKIDA_VER_COMO_SOLO_LECTURA', 'activo');
    getSessionTenant.mockResolvedValue({ userId: 'u1', rol: 'superadmin', tenantId: null });
    resolverTenantEfectivo.mockResolvedValue(verComoReal);
    await expect(resolverTenantAtadoFirmado('/dashboard/x', firmarFlotaPintada(A, 'u1'))).rejects.toBeInstanceOf(VerComoSoloLecturaError);
  });

  it('encendido: el dueño real escribe normal, y la demo (sin nombre de flota) también', async () => {
    vi.stubEnv('LIKIDA_VER_COMO_SOLO_LECTURA', 'activo');
    resolverTenantEfectivo.mockResolvedValue({ tenantId: A, rol: 'flota_admin', rolReal: 'flota_admin', tenantNombre: null });
    expect(await resolverTenantAtadoAccion('/dashboard/x', undefined, A)).toMatchObject({ tenantId: A });
    resolverTenantEfectivo.mockResolvedValue({ tenantId: A, rol: 'flota_admin', rolReal: 'superadmin', tenantNombre: null });
    expect(await resolverTenantAtadoAccion('/dashboard/x', { vista: 'demo' }, A)).toMatchObject({ tenantId: A });
  });

  it('predicado puro', () => {
    expect(esVerComoDeFlotaReal({ rolReal: 'superadmin', tenantNombre: 'X' })).toBe(true);
    expect(esVerComoDeFlotaReal({ rolReal: 'flota_admin', tenantNombre: 'X' })).toBe(false);
    expect(() => exigirEscrituraPermitida({ rolReal: 'superadmin', tenantNombre: 'X' }, { LIKIDA_VER_COMO_SOLO_LECTURA: 'activo' })).toThrow(/solo lectura/);
    expect(() => exigirEscrituraPermitida({ rolReal: 'superadmin', tenantNombre: 'X' }, {})).not.toThrow();
  });
});
