import { beforeEach, describe, expect, it, vi } from 'vitest';

const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger }));
import { modoDeSuperficie, turnstileActivo, turnstileSiteKey, verificarTurnstile } from './turnstile';

const ENC = { TURNSTILE_ACTIVO: '1', TURNSTILE_SECRET_KEY: 'sk_test_secreta', NEXT_PUBLIC_TURNSTILE_SITE_KEY: '0x4AAA' };
const resp = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status });
const fetchDe = (r: Response | Error) => vi.fn(async () => { if (r instanceof Error) throw r; return r; }) as unknown as typeof fetch;

beforeEach(() => { logger.info.mockClear(); logger.warn.mockClear(); logger.error.mockClear(); });

describe('Turnstile apagado por omision (S-03)', () => {
  it('sin TURNSTILE_ACTIVO no hace nada: pasa y no llama a Cloudflare', async () => {
    const f = vi.fn();
    const v = await verificarTurnstile({ token: undefined, superficie: 'login' }, { env: {}, fetch: f as never });
    expect(v).toEqual({ ok: true, modo: 'apagado', motivo: 'apagado' });
    expect(f).not.toHaveBeenCalled();
    expect(turnstileActivo({})).toBe(false);
    expect(turnstileActivo({ TURNSTILE_ACTIVO: 'true' })).toBe(false);
    expect(turnstileSiteKey({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: '0x4' })).toBeNull();
  });
});

describe('encendido', () => {
  it('login bloquea por omision; lead y mcp_register solo observan', () => {
    expect(modoDeSuperficie('login', ENC)).toBe('bloquear');
    expect(modoDeSuperficie('lead', ENC)).toBe('observar');
    expect(modoDeSuperficie('mcp_register', ENC)).toBe('observar');
    expect(modoDeSuperficie('lead', { ...ENC, TURNSTILE_SUPERFICIES: 'login, lead' })).toBe('bloquear');
    expect(turnstileSiteKey(ENC)).toBe('0x4AAA');
  });
  it('token valido: pasa y manda secreto y token a Cloudflare, sin IP', async () => {
    const f = fetchDe(resp({ success: true }));
    const v = await verificarTurnstile({ token: 'tok', superficie: 'login' }, { env: ENC, fetch: f });
    expect(v.ok).toBe(true);
    const [url, init] = (f as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.body).toContain('secret=sk_test_secreta');
    expect(init.body).toContain('response=tok');
    expect(init.body).not.toContain('remoteip');
  });
  it('token ausente en login: BLOQUEA sin llamar a Cloudflare', async () => {
    const f = vi.fn();
    const v = await verificarTurnstile({ token: '', superficie: 'login' }, { env: ENC, fetch: f as never });
    expect(v).toMatchObject({ ok: false, motivo: 'sin_token' });
    expect(f).not.toHaveBeenCalled();
  });
  it('token rechazado en login: bloquea; en lead (observacion) deja pasar y registra', async () => {
    const malo = () => fetchDe(resp({ success: false, 'error-codes': ['invalid-input-response'] }));
    expect(await verificarTurnstile({ token: 'x', superficie: 'login' }, { env: ENC, fetch: malo() })).toMatchObject({ ok: false, motivo: 'rechazado' });
    expect(await verificarTurnstile({ token: 'x', superficie: 'lead' }, { env: ENC, fetch: malo() })).toMatchObject({ ok: true, modo: 'observar', motivo: 'rechazado' });
    expect(logger.warn).toHaveBeenCalledWith('turnstile.rechazado', expect.objectContaining({ superficie: 'lead' }));
  });
  it('FALTA la llave secreta: NO bloquea a nadie y grita en el log', async () => {
    const v = await verificarTurnstile({ token: '', superficie: 'login' }, { env: { ...ENC, TURNSTILE_SECRET_KEY: '' } });
    expect(v).toMatchObject({ ok: true, motivo: 'sin_llave' });
    expect(logger.error).toHaveBeenCalledWith('turnstile.sin_llave', expect.anything());
  });
  it('llave secreta invalida (error de config de Cloudflare): pasa y grita', async () => {
    const f = fetchDe(resp({ success: false, 'error-codes': ['invalid-input-secret'] }));
    const v = await verificarTurnstile({ token: 'x', superficie: 'login' }, { env: ENC, fetch: f });
    expect(v).toMatchObject({ ok: true, motivo: 'llave_invalida' });
    expect(logger.error).toHaveBeenCalledWith('turnstile.llave_invalida', expect.anything());
  });
  it('Cloudflare caido (red, 5xx o cuerpo raro): pasa con aviso', async () => {
    for (const f of [fetchDe(new Error('ECONNRESET')), fetchDe(resp({}, 503)), fetchDe(resp({ raro: 1 }))]) {
      expect(await verificarTurnstile({ token: 'x', superficie: 'login' }, { env: ENC, fetch: f })).toMatchObject({ ok: true, motivo: 'proveedor_caido' });
    }
  });
  it('un token enorme se rechaza sin llamar a Cloudflare', async () => {
    const f = vi.fn();
    const v = await verificarTurnstile({ token: 'a'.repeat(5000), superficie: 'login' }, { env: ENC, fetch: f as never });
    expect(v.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it('el token nunca aparece en el log', async () => {
    await verificarTurnstile({ token: 'TOKEN-SECRETO-123', superficie: 'login' }, { env: ENC, fetch: fetchDe(resp({ success: false, 'error-codes': ['timeout-or-duplicate'] })) });
    expect(JSON.stringify([logger.warn.mock.calls, logger.error.mock.calls, logger.info.mock.calls])).not.toContain('TOKEN-SECRETO-123');
  });
});
