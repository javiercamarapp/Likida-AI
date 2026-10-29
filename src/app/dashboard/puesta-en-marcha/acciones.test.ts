import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireSessionTenant = vi.fn();
const emailDeUsuario = vi.fn();
const enviarCorreo = vi.fn();
const correoConfigurado = vi.fn();
const rateLimit = vi.fn();
vi.mock('@/lib/auth/guard', () => ({ requireSessionTenant: (...a: unknown[]) => requireSessionTenant(...a) }));
vi.mock('@/lib/likida/conductor/trabajo', () => ({ emailDeUsuario: (...a: unknown[]) => emailDeUsuario(...a) }));
vi.mock('@/lib/correo/enviar', () => ({
  enviarCorreo: (...a: unknown[]) => enviarCorreo(...a),
  correoConfigurado: () => correoConfigurado(),
}));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { enviarPruebaCorreo } = await import('./acciones');

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionTenant.mockResolvedValue({ userId: 'u1', tenantId: 't1', rol: 'flota_admin' });
  rateLimit.mockResolvedValue(true);
  correoConfigurado.mockReturnValue(true);
  emailDeUsuario.mockResolvedValue('dueno@ejemplo.mx');
  enviarCorreo.mockResolvedValue({ ok: true, id: 'x' });
});

describe('enviarPruebaCorreo', () => {
  it('pasa por la puerta del perfil con su ruta y manda SOLO al correo del usuario en sesión', async () => {
    const r = await enviarPruebaCorreo();
    expect(requireSessionTenant).toHaveBeenCalledWith('/dashboard/puesta-en-marcha');
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
    expect(enviarCorreo.mock.calls[0][0]).toBe('dueno@ejemplo.mx');
    expect(r).toEqual({ ok: true, destino: 'd•••@ejemplo.mx' });
  });
  it('un rol que no ve la ruta no manda nada', async () => {
    requireSessionTenant.mockResolvedValue({ userId: 'u1', tenantId: 't1', rol: 'contador' });
    const r = await enviarPruebaCorreo();
    expect(r.ok).toBe(false);
    expect(enviarCorreo).not.toHaveBeenCalled();
  });
  it('el freno por usuario corta antes de leer o enviar nada', async () => {
    rateLimit.mockResolvedValue(false);
    const r = await enviarPruebaCorreo();
    expect(r.ok).toBe(false);
    expect(rateLimit.mock.calls[0][0]).toContain('u1');
    expect(emailDeUsuario).not.toHaveBeenCalled();
    expect(enviarCorreo).not.toHaveBeenCalled();
  });
  it('sin correo capturado, base caída o envío rechazado: error dicho, nunca éxito', async () => {
    emailDeUsuario.mockResolvedValueOnce(null);
    expect((await enviarPruebaCorreo()).ok).toBe(false);
    emailDeUsuario.mockRejectedValueOnce(new Error('caída'));
    expect((await enviarPruebaCorreo()).ok).toBe(false);
    enviarCorreo.mockResolvedValueOnce({ ok: false, motivo: 'rechazado', detalle: 'x' });
    expect((await enviarPruebaCorreo()).ok).toBe(false);
    correoConfigurado.mockReturnValue(false);
    expect((await enviarPruebaCorreo()).ok).toBe(false);
  });
});
