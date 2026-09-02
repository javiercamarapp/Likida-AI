import { describe, it, expect, vi, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · SEG-5 — HSTS con `includeSubDomains; preload` y `media-src`
// explícito en la CSP. `proxy.test.ts` ya cubre presencia de CSP y el resto de
// cabeceras; aquí solo lo que cambió, en producción y fuera de ella.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function cabecerasDe(path: string) {
  const { NextRequest } = await import('next/server');
  const { proxy } = await import('./proxy');
  const res = await proxy(new NextRequest(`https://app.likida.ai${path}`));
  return res.headers;
}

describe('SEG-5: HSTS y media-src', () => {
  it('en producción, HSTS de un año con subdominios y preload — el mismo literal que next.config.ts', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const h = await cabecerasDe('/');
    expect(h.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains; preload');
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('next.config.ts', 'utf8')).toContain("'max-age=31536000; includeSubDomains; preload'");
  });

  it('fuera de producción no se publica HSTS (en localhost no hace nada)', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const h = await cabecerasDe('/');
    expect(h.get('Strict-Transport-Security')).toBeNull();
  });

  it('la CSP declara media-src para Storage, sin aflojar default-src', async () => {
    const csp = (await cabecerasDe('/')).get('Content-Security-Policy') ?? '';
    expect(csp).toContain("media-src 'self' https://*.supabase.co");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
