import { beforeEach, describe, expect, it, vi } from 'vitest';

// CT-SEG-11: la puerta de /v1 deja rastro de las llaves inválidas y de las rutas negadas.
const resolverLlave = vi.fn();
vi.mock('@/lib/auth/llave-api', async (orig) => ({ ...(await orig<Record<string, unknown>>()), resolverLlave: (...a: unknown[]) => resolverLlave(...a) }));
const apiDenegada = vi.fn(async (..._a: unknown[]) => false);
vi.mock('@/lib/auth/perfil_tenant', () => ({ apiDenegadaPorPerfil: (...a: unknown[]) => apiDenegada(...a), MOTIVO_PERFIL_API: 'plan' }));
vi.mock('@/lib/auth/tenant-api', () => ({ resolverTenantApi: vi.fn(async () => ({ ok: true, tenantId: 't1', rol: 'encargado' })) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const registrarLlaveInvalida = vi.fn(async (..._a: unknown[]) => {});
const registrarApiNegada = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/seguridad/registro_acceso', () => ({
  registrarLlaveInvalida: (...a: unknown[]) => registrarLlaveInvalida(...a),
  registrarApiNegada: (...a: unknown[]) => registrarApiNegada(...a),
}));

const { reiniciarLimites } = await import('@/lib/ratelimit');
const { abrir } = await import('./_comun');

let n = 0;
const peticion = (h: Record<string, string> = {}) =>
  new Request('https://app.likida.ai/api/v1/viajes', { headers: { 'x-forwarded-for': `10.9.${++n}.1`, ...h } });

beforeEach(() => { reiniciarLimites(); resolverLlave.mockReset(); apiDenegada.mockReset(); apiDenegada.mockResolvedValue(false); registrarLlaveInvalida.mockClear(); registrarApiNegada.mockClear(); });

describe('abrir() → eventos de seguridad', () => {
  it('llave inválida (401): registra con la petición', async () => {
    resolverLlave.mockResolvedValue({ ok: false, status: 401, motivo: 'Llave inválida.' });
    const req = peticion({ authorization: 'Bearer lk_mala' });
    const r = await abrir(req, 'operacion');
    expect(r.ok).toBe(false);
    expect(registrarLlaveInvalida).toHaveBeenCalledWith(req, 'Llave inválida.');
  });
  it('un 503 de infraestructura al resolver la llave NO es un intento: no registra', async () => {
    resolverLlave.mockResolvedValue({ ok: false, status: 503, motivo: 'No se pudo verificar.' });
    await abrir(peticion({ authorization: 'Bearer lk_x' }), 'operacion');
    expect(registrarLlaveInvalida).not.toHaveBeenCalled();
  });
  it('llave válida pero de área angosta: registra api_negada área_llave', async () => {
    resolverLlave.mockResolvedValue({ ok: true, tenantId: 't1', area: 'operacion', llaveId: 'k1' });
    const r = await abrir(peticion({ authorization: 'Bearer lk_ok' }), 'dinero');
    expect(r.ok).toBe(false);
    expect(registrarApiNegada).toHaveBeenCalledWith({ tenantId: 't1', pathname: '/api/v1/viajes', causa: 'area_llave' });
  });
  it('sesión sin el área: registra api_negada área_rol', async () => {
    const r = await abrir(peticion(), 'dinero'); // encargado no ve dinero
    expect(r.ok).toBe(false);
    expect(registrarApiNegada).toHaveBeenCalledWith({ tenantId: 't1', pathname: '/api/v1/viajes', causa: 'area_rol' });
  });
  it('un acceso permitido no registra nada', async () => {
    const r = await abrir(peticion(), 'operacion');
    expect(r.ok).toBe(true);
    expect(registrarLlaveInvalida).not.toHaveBeenCalled();
    expect(registrarApiNegada).not.toHaveBeenCalled();
  });
});
