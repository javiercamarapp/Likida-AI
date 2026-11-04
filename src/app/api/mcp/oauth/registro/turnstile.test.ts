import { beforeEach, describe, expect, it, vi } from 'vitest';

// S-03: el registro dinamico de clientes OAuth consulta Turnstile (en observacion salvo que se configure lo contrario).
const { veredicto, verificar, registrar } = vi.hoisted(() => {
  const veredicto = { ok: true };
  return {
    veredicto,
    verificar: vi.fn(async () => ({ ok: veredicto.ok, modo: 'observar', motivo: 'x' })),
    registrar: vi.fn(async () => ({ ok: true, cliente: { clientId: 'c1', nombre: 'Claude', redirectUris: ['https://claude.ai/cb'] } })),
  };
});
vi.mock('@/lib/seguridad/turnstile', () => ({ verificarTurnstile: verificar }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true, clientIp: () => '1.2.3.4' }));
vi.mock('@/lib/mcp/oauth', async (orig) => ({ ...(await orig<Record<string, unknown>>()), registrarCliente: registrar }));
const { POST } = await import('./route');
const pet = (cuerpo: unknown) => POST(new Request('https://app.likida.ai/api/mcp/oauth/registro', { method: 'POST', body: JSON.stringify(cuerpo) }));

beforeEach(() => { verificar.mockClear(); registrar.mockClear(); veredicto.ok = true; });

describe('/api/mcp/oauth/registro + Turnstile', () => {
  it('consulta la superficie mcp_register con el token del cuerpo', async () => {
    const r = await pet({ client_name: 'Claude', redirect_uris: ['https://claude.ai/cb'], turnstile_token: 'tok' });
    expect(verificar).toHaveBeenCalledWith({ token: 'tok', superficie: 'mcp_register' });
    expect(r.status).toBe(201);
  });
  it('si bloquea: 403 y no registra', async () => {
    veredicto.ok = false;
    const r = await pet({ client_name: 'x', redirect_uris: ['https://a.b/c'] });
    expect(r.status).toBe(403);
    expect(registrar).not.toHaveBeenCalled();
  });
});
