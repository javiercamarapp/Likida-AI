import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { accessToken, tokenMatches } from './passcode';

beforeAll(() => {
  process.env.DASHBOARD_PASSCODE = 'demo-1234';
  process.env.DASHBOARD_SECRET = 'secreto-de-prueba';
});

describe('passcode (HMAC)', () => {
  it('el token NO es reversible (no contiene el passcode ni su base64)', async () => {
    const t = await accessToken('demo-1234');
    expect(t).toHaveLength(64);                 // hex de SHA-256
    expect(t).not.toContain('demo-1234');
    expect(t).not.toContain(Buffer.from('demo-1234').toString('base64'));
  });
  it('tokenMatches acepta el token correcto y rechaza el resto', async () => {
    const t = await accessToken('demo-1234');
    expect(await tokenMatches(t)).toBe(true);
    expect(await tokenMatches('deadbeef')).toBe(false);
    expect(await tokenMatches(undefined)).toBe(false);
    expect(await tokenMatches(await accessToken('otro'))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SIN DASHBOARD_SECRET, EL CANDADO SE ABRE SOLO.
//
// `secret()` caía a `likida:${DASHBOARD_PASSCODE}` cuando faltaba
// DASHBOARD_SECRET. O sea: la cookie es HMAC(passcode) con una clave DERIVADA
// del propio passcode. Quien capture UNA cookie puede probar candidatos offline
// —sin tocar /acceso y sin su rate-limit— hasta dar con el passcode, y entrar
// por el formulario normal indefinidamente.
//
// Un passcode de demo tiene poca entropía: eso es minutos de cómputo.
//
// En producción se falla RUIDOSO. Un candado que parece cerrado y no lo está es
// peor que uno que avisa que no está puesto.
// ═══════════════════════════════════════════════════════════════════════════
describe('secreto del HMAC', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; vi.unstubAllEnvs(); });

  it('en producción, sin DASHBOARD_SECRET, falla ruidoso', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.DASHBOARD_SECRET;
    process.env.DASHBOARD_PASSCODE = 'demo2026';
    await expect(accessToken('demo2026')).rejects.toThrow(/DASHBOARD_SECRET/);
  });

  it('en producción CON el secreto, funciona normal', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.DASHBOARD_SECRET = 'un-secreto-de-servidor-largo';
    process.env.DASHBOARD_PASSCODE = 'demo2026';
    await expect(accessToken('demo2026')).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it('en desarrollo sigue funcionando sin secreto: no estorba el día a día', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    delete process.env.DASHBOARD_SECRET;
    process.env.DASHBOARD_PASSCODE = 'dev';
    await expect(accessToken('dev')).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it('el token depende del secreto: cambiarlo invalida las cookies viejas', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.DASHBOARD_SECRET = 'secreto-A';
    const a = await accessToken('demo2026');
    process.env.DASHBOARD_SECRET = 'secreto-B';
    const b = await accessToken('demo2026');
    expect(a).not.toBe(b);
  });
});
