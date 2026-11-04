import { describe, expect, it, vi } from 'vitest';

// CT-SEG-17: el GET del PDF sella la descarga; una peticion de otro sitio se rechaza antes de tocar nada.
const m = vi.hoisted(() => ({ rpc: vi.fn(), resolver: vi.fn() }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true, clientIp: () => '1.1.1.1' }));
vi.mock('@/lib/auth/tenant-api', () => ({ resolverTenantApi: (...a: unknown[]) => m.resolver(...a) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc: m.rpc }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { GET } = await import('./route');
const ctx = { params: Promise.resolve({ id: '11111111-2222-4333-8444-555555555555' }) };

describe('CT-SEG-17 · export/pdf/[id] rechaza peticiones de otro sitio', () => {
  it.each<Record<string, string>>([
    { 'sec-fetch-site': 'cross-site' },
    { origin: 'https://malo.example', host: 'app.likida.ai' },
    { referer: 'https://malo.example/x', host: 'app.likida.ai' },
  ])('403 sin tocar sesion ni la RPC con %o', async (cab) => {
    const r = await GET(new Request('https://app.likida.ai/api/export/pdf/x', { headers: cab }), ctx);
    expect(r.status).toBe(403);
    expect(m.resolver).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });
});
