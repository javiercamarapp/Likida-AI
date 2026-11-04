import { beforeEach, describe, expect, it, vi } from 'vitest';

// CT-SEG-20: sin tope GLOBAL, un atacante rotando IPs (o una IPv6 /64) infla logs y Sentry sin limite.
const llaves: string[] = [];
let negarGlobal = false;
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (llave: string) => { llaves.push(llave); return !(negarGlobal && llave === 'client-error:global'); },
  clientIp: () => '203.0.113.5',
}));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));
const { POST } = await import('./route');
const pet = () => new Request('https://x/api/client-error', { method: 'POST', body: JSON.stringify({ msg: 'app.global_error' }) });

beforeEach(() => { llaves.length = 0; negarGlobal = false; logger.error.mockClear(); });

describe('/api/client-error: tope global (CT-SEG-20)', () => {
  it('consulta un limite global ademas del de IP', async () => {
    await POST(pet());
    expect(llaves).toContain('client-error:global');
    expect(llaves.some((l) => l.startsWith('client-error:') && l !== 'client-error:global')).toBe(true);
  });
  it('agotado el global responde 429 y no escribe nada en el log', async () => {
    negarGlobal = true;
    const r = await POST(pet());
    expect(r.status).toBe(429);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
