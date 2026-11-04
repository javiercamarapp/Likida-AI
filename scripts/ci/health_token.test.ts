import { afterEach, describe, expect, it, vi } from 'vitest';
import { decidir, leerHealth } from './compuerta-deploy.mjs';
import { sondearHealth } from '../../src/lib/admin/estado';

// CT-SEG-12: /api/health publico ya no trae migracion; los consumidores del repo mandan HEALTH_TOKEN.
const ok = () => new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.HEALTH_TOKEN; });

describe('consumidores de /api/health mandan x-health-token', () => {
  it('la compuerta de despliegue manda el token cuando existe', async () => {
    process.env.HEALTH_TOKEN = 'token-de-health-de-prueba-0123456789';
    const f = vi.fn(async () => ok());
    vi.stubGlobal('fetch', f);
    await leerHealth('https://x/api/health', 1);
    const init = (f.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1];
    expect(init.headers['x-health-token']).toBe('token-de-health-de-prueba-0123456789');
  });
  it('la compuerta no manda cabecera vacia si no hay token', async () => {
    const f = vi.fn(async () => ok());
    vi.stubGlobal('fetch', f);
    await leerHealth('https://x/api/health', 1);
    const init = (f.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1];
    expect(init.headers['x-health-token']).toBeUndefined();
  });
  it('un health en modo publico bloquea el despliegue y dice que falta HEALTH_TOKEN', () => {
    const v = decidir({ asunto: 'x [deploy]', codigo: '0100', prefijosCodigo: ['0100'], health: { ok: true, status: 'ok', acceso: 'publico' } });
    expect(v.construir).toBe(false);
    expect(v.motivo).toContain('HEALTH_TOKEN');
  });
  it('la guardia (sondearHealth) manda el token', async () => {
    process.env.HEALTH_TOKEN = 'token-de-health-de-prueba-0123456789';
    const f = vi.fn(async () => ok());
    await sondearHealth('https://x/api/health', f as unknown as typeof fetch);
    const init = (f.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1];
    expect(init.headers['x-health-token']).toBe('token-de-health-de-prueba-0123456789');
  });
});
