import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA SEGUNDA CAPA TIENE QUE VALER POR SÍ SOLA.
//
// Un guard que "protege" pero deja pasar cuando la cookie falta no añade nada:
// da la sensación de defensa en profundidad sin la defensa. Estos casos fijan
// que corta de verdad, y que en desarrollo no estorba.
// ═══════════════════════════════════════════════════════════════════════════
const redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });
const get = vi.fn();
vi.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirect(...(a as [])) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (...a: unknown[]) => get(...(a as [])) }) }));

const { exigirAcceso } = await import('./guard');
const { accessToken } = await import('./passcode');

describe('exigirAcceso', () => {
  beforeEach(() => { redirect.mockClear(); get.mockReset(); vi.unstubAllEnvs(); });

  it('sin passcode configurado (dev) no bloquea', async () => {
    vi.stubEnv('DASHBOARD_PASSCODE', '');
    get.mockReturnValue(undefined);
    await expect(exigirAcceso('/dashboard')).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('con passcode y SIN cookie, manda a /acceso', async () => {
    vi.stubEnv('DASHBOARD_PASSCODE', 'demo2026');
    vi.stubEnv('DASHBOARD_SECRET', 'secreto-de-servidor');
    get.mockReturnValue(undefined);
    await expect(exigirAcceso('/dashboard')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(expect.stringContaining('/acceso'));
  });

  it('con una cookie FALSA, manda a /acceso', async () => {
    vi.stubEnv('DASHBOARD_PASSCODE', 'demo2026');
    vi.stubEnv('DASHBOARD_SECRET', 'secreto-de-servidor');
    get.mockReturnValue({ value: 'a'.repeat(64) });
    await expect(exigirAcceso('/dashboard')).rejects.toThrow('NEXT_REDIRECT');
  });

  it('con la cookie BUENA, deja pasar', async () => {
    vi.stubEnv('DASHBOARD_PASSCODE', 'demo2026');
    vi.stubEnv('DASHBOARD_SECRET', 'secreto-de-servidor');
    get.mockReturnValue({ value: await accessToken('demo2026') });
    await expect(exigirAcceso('/dashboard')).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('conserva a dónde volver, incluido el id de la liquidación', async () => {
    vi.stubEnv('DASHBOARD_PASSCODE', 'demo2026');
    vi.stubEnv('DASHBOARD_SECRET', 'secreto-de-servidor');
    get.mockReturnValue(undefined);
    await exigirAcceso('/dashboard/abc-123').catch(() => {});
    expect(redirect).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('/dashboard/abc-123')));
  });
});
