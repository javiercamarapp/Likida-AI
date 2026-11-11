import { describe, it, expect, vi, beforeEach } from 'vitest';

const sesion = vi.fn();
const updateUser = vi.fn();
const limite = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: () => sesion() }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ auth: { updateUser } }) }));
vi.mock('@/lib/ratelimit', async (orig) => ({ ...(await orig<typeof import('@/lib/ratelimit')>()), rateLimit: (...a: unknown[]) => limite(...a) }));

const { POST } = await import('./route');

const pedir = (cuerpo: unknown, cabeceras: Record<string, string> = {}) =>
  new Request('https://app.likida.ai/api/preferencias/idioma', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...cabeceras },
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  });

beforeEach(() => {
  sesion.mockReset().mockResolvedValue({ userId: 'u1', tenantId: 't1', rol: 'flota_admin' });
  updateUser.mockReset().mockResolvedValue({ error: null });
  limite.mockReset().mockResolvedValue(true);
});

describe('POST /api/preferencias/idioma: su puerta', () => {
  it('sin sesión: 401 y no escribe nada', async () => {
    sesion.mockResolvedValue(null);
    const r = await POST(pedir({ idioma: 'en' }));
    expect(r.status).toBe(401);
    expect(updateUser).not.toHaveBeenCalled();
    expect(r.headers.get('set-cookie')).toBeNull();
  });
  it('desde otro sitio: 403', async () => {
    const r = await POST(pedir({ idioma: 'en' }, { 'sec-fetch-site': 'cross-site' }));
    expect(r.status).toBe(403);
    expect(updateUser).not.toHaveBeenCalled();
  });
  it('rate limit por usuario: 429', async () => {
    limite.mockResolvedValue(false);
    expect((await POST(pedir({ idioma: 'en' }))).status).toBe(429);
    expect(limite.mock.calls[0][0]).toBe('preferencias-idioma:u1');
  });
  it('cuerpo demasiado grande: 413', async () => {
    const r = await POST(pedir({ idioma: 'en' }, { 'content-length': '5000' }));
    expect(r.status).toBe(413);
  });
  it('idioma fuera de la lista cerrada o cuerpo roto: 400, sin reflejar nada', async () => {
    for (const cuerpo of [{ idioma: 'fr' }, { idioma: '<img src=x>' }, {}, '{no json', 'null']) {
      const r = await POST(pedir(cuerpo));
      expect(r.status).toBe(400);
      expect(await r.text()).not.toContain('<img');
    }
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe('POST /api/preferencias/idioma: lo que escribe', () => {
  it('cookie likida_lang (httpOnly, 1 año) + user_metadata.idioma', async () => {
    const r = await POST(pedir({ idioma: 'en' }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, idioma: 'en', guardado: true });
    expect(updateUser).toHaveBeenCalledWith({ data: { idioma: 'en' } });
    const c = r.headers.get('set-cookie') ?? '';
    expect(c).toContain('likida_lang=en');
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=lax/i);
    expect(c).toContain('Max-Age=31536000');
  });
  it('si Supabase no guarda la preferencia, la cookie ya vale y lo DICE (guardado: false)', async () => {
    updateUser.mockResolvedValue({ error: { message: 'x' } });
    const r = await POST(pedir({ idioma: 'es' }));
    expect(r.status).toBe(200);
    expect((await r.json()).guardado).toBe(false);
    expect(r.headers.get('set-cookie')).toContain('likida_lang=es');
    updateUser.mockRejectedValue(new Error('red'));
    expect((await (await POST(pedir({ idioma: 'es' }))).json()).guardado).toBe(false);
  });
});
