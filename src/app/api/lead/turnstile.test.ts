import { beforeEach, describe, expect, it, vi } from 'vitest';

// S-03: /api/lead consulta Turnstile (token en el JSON o en x-turnstile-token); apagado = no cambia nada.
const { veredicto, verificar } = vi.hoisted(() => {
  const veredicto = { ok: true };
  return { veredicto, verificar: vi.fn(async () => ({ ok: veredicto.ok, modo: 'bloquear', motivo: 'x' })) };
});
vi.mock('@/lib/seguridad/turnstile', () => ({ verificarTurnstile: verificar }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => { const b: Record<string, unknown> = {}; Object.assign(b, { select: () => b, eq: () => b, limit: () => b, insert: () => b, update: () => b, then: (r: (x: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r) }); return b; } }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true, bodyExcede: () => false, clientIp: () => '1.2.3.4' }));
const { POST } = await import('./route');
const pet = (cuerpo: unknown, headers: Record<string, string> = {}) => POST(new Request('https://app.likida.ai/api/lead', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://likida.ai', ...headers }, body: JSON.stringify(cuerpo),
}));

beforeEach(() => { verificar.mockClear(); veredicto.ok = true; });

describe('/api/lead + Turnstile', () => {
  it('pasa el token del JSON con la superficie lead', async () => {
    await pet({ empresa: 'GAL', turnstile_token: 'tok-json' });
    expect(verificar).toHaveBeenCalledWith({ token: 'tok-json', superficie: 'lead' });
  });
  it('acepta el token por cabecera', async () => {
    await pet({ empresa: 'GAL' }, { 'x-turnstile-token': 'tok-cab' });
    expect(verificar).toHaveBeenCalledWith({ token: 'tok-cab', superficie: 'lead' });
  });
  it('si la verificacion bloquea: 403 y no se escribe nada', async () => {
    veredicto.ok = false;
    const r = await pet({ empresa: 'GAL' });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'verificacion_fallida' });
  });
  it('el preflight CORS permite la cabecera del token', async () => {
    const { OPTIONS } = await import('./route');
    const r = await OPTIONS(new Request('https://app.likida.ai/api/lead', { method: 'OPTIONS', headers: { origin: 'https://likida.ai' } }));
    expect(r.headers.get('access-control-allow-headers')).toContain('X-Turnstile-Token');
  });
});
