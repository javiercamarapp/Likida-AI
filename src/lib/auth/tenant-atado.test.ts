import { describe, it, expect, vi, beforeEach } from 'vitest';

// MX-002 / PT-02: la flota que la pantalla pintó es la flota donde se escribe.
const getSessionTenant = vi.fn();
vi.mock('./session', () => ({ getSessionTenant: () => getSessionTenant() }));
const resolverTenantEfectivo = vi.fn();
vi.mock('./tenant-efectivo', () => ({ resolverTenantEfectivo: (...a: unknown[]) => resolverTenantEfectivo(...a) }));

const { firmarFlotaPintada, flotaPintadaVerificada, resolverTenantAtadoAccion, resolverTenantAtadoFirmado, MENSAJE_FLOTA_CAMBIO, TTL_FLOTA_PINTADA_MS } =
  await import('./tenant-atado');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  process.env.LIKIDA_FLOTA_COOKIE_LLAVE = 'llave-de-prueba-0123456789';
  getSessionTenant.mockReset();
  resolverTenantEfectivo.mockReset();
});

describe('firma de la flota pintada', () => {
  it('ida y vuelta: la firma de un usuario verifica para ese usuario', () => {
    const f = firmarFlotaPintada(A, 'u1')!;
    expect(flotaPintadaVerificada(f, 'u1')).toBe(A);
  });
  it('no sirve para otro usuario, ni manipulada, ni caducada, ni sin llave', () => {
    const f = firmarFlotaPintada(A, 'u1')!;
    expect(flotaPintadaVerificada(f, 'u2')).toBeNull();
    expect(flotaPintadaVerificada(f.replace(A, B), 'u1')).toBeNull();
    expect(flotaPintadaVerificada(f, 'u1', Date.now() + TTL_FLOTA_PINTADA_MS + 1000)).toBeNull();
    expect(flotaPintadaVerificada('basura', 'u1')).toBeNull();
    expect(flotaPintadaVerificada(undefined, 'u1')).toBeNull();
    delete process.env.LIKIDA_FLOTA_COOKIE_LLAVE;
    expect(firmarFlotaPintada(A, 'u1')).toBeNull();
    expect(flotaPintadaVerificada(f, 'u1')).toBeNull();
  });
});

describe('resolverTenantAtadoAccion (closure)', () => {
  it('devuelve la sesión cuando la flota de ahora es la pintada', async () => {
    resolverTenantEfectivo.mockResolvedValue({ tenantId: A, rol: 'flota_admin' });
    expect(await resolverTenantAtadoAccion('/dashboard/x', undefined, A)).toMatchObject({ tenantId: A });
  });
  it('devuelve null cuando la cookie compartida ya apunta a otra flota (dos pestañas)', async () => {
    resolverTenantEfectivo.mockResolvedValue({ tenantId: B, rol: 'superadmin' });
    expect(await resolverTenantAtadoAccion('/dashboard/x', undefined, A)).toBeNull();
  });
  it('expone el mensaje único', () => { expect(MENSAJE_FLOTA_CAMBIO).toMatch(/No se guardó nada/); });
});

describe('resolverTenantAtadoFirmado (módulo)', () => {
  it('superadmin con la firma de A: resuelve A aunque la cookie diga B', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u1', rol: 'superadmin', tenantId: null });
    resolverTenantEfectivo.mockImplementation(async (_d: string, sp?: { tenant?: string }) => ({ tenantId: sp?.tenant ?? B, rol: 'superadmin' }));
    const s = await resolverTenantAtadoFirmado('/dashboard/x', firmarFlotaPintada(A, 'u1'));
    expect(s?.tenantId).toBe(A);
    expect(resolverTenantEfectivo).toHaveBeenCalledWith('/dashboard/x', { tenant: A });
  });
  it('superadmin SIN firma, con firma ajena o falsificada: null (no escribe en la flota equivocada)', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u1', rol: 'superadmin', tenantId: null });
    resolverTenantEfectivo.mockResolvedValue({ tenantId: B, rol: 'superadmin' });
    expect(await resolverTenantAtadoFirmado('/dashboard/x', undefined)).toBeNull();
    expect(await resolverTenantAtadoFirmado('/dashboard/x', firmarFlotaPintada(A, 'otro-usuario'))).toBeNull();
    expect(await resolverTenantAtadoFirmado('/dashboard/x', `fp1.${A}.9999999999999.mala`)).toBeNull();
  });
  it('superadmin cuya resolución cae en otra flota que la firmada: null', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u1', rol: 'superadmin', tenantId: null });
    resolverTenantEfectivo.mockResolvedValue({ tenantId: B, rol: 'superadmin' });
    expect(await resolverTenantAtadoFirmado('/dashboard/x', firmarFlotaPintada(A, 'u1'))).toBeNull();
  });
  it('dueño de flota: su sesión basta aunque falte el campo; una firma de OTRA flota se niega', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u2', rol: 'flota_admin', tenantId: A });
    resolverTenantEfectivo.mockResolvedValue({ tenantId: A, rol: 'flota_admin' });
    expect((await resolverTenantAtadoFirmado('/dashboard/x', undefined))?.tenantId).toBe(A);
    expect((await resolverTenantAtadoFirmado('/dashboard/x', firmarFlotaPintada(A, 'u2')))?.tenantId).toBe(A);
    expect(await resolverTenantAtadoFirmado('/dashboard/x', firmarFlotaPintada(B, 'u2'))).toBeNull();
  });
  it('sin sesión: null', async () => {
    getSessionTenant.mockResolvedValue(null);
    expect(await resolverTenantAtadoFirmado('/dashboard/x', undefined)).toBeNull();
  });
});
