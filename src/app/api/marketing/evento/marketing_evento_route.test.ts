import { describe, it, expect, vi, beforeEach } from 'vitest';

// El pageview del sitio: lista CERRADA de páginas por forma, 'pageview' como
// único evento admitido por esta puerta (las conversiones las escribe el
// servidor donde ocurren), y 204 SIEMPRE — la analítica jamás le contesta un
// problema al visitante.

let limiteOk = true;
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => limiteOk,
  clientIp: () => '1.2.3.4',
  bodyExcede: () => false,
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const eventos: Array<Record<string, unknown>> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ insert: async (v: Record<string, unknown>) => { eventos.push(v); return { error: null }; } }),
  }),
}));

const { POST } = await import('./route');

const pedir = (cuerpo: unknown) =>
  new Request('https://x/api/marketing/evento', { method: 'POST', body: JSON.stringify(cuerpo) });

beforeEach(() => { limiteOk = true; eventos.length = 0; });

describe('POST /api/marketing/evento', () => {
  it('pageview de una página válida → 204 y fila SIN ningún dato del visitante', async () => {
    const res = await POST(pedir({ pagina: 'blog:peajes-50-por-ciento-bitacora', evento: 'pageview' }));
    expect(res.status).toBe(204);
    expect(eventos).toEqual([{ pagina: 'blog:peajes-50-por-ciento-bitacora', evento: 'pageview' }]);
    expect(JSON.stringify(eventos[0])).not.toContain('1.2.3.4');   // la IP no se escribe
  });

  it('página fuera de la lista cerrada → 204 sin escribir', async () => {
    const res = await POST(pedir({ pagina: 'admin', evento: 'pageview' }));
    expect(res.status).toBe(204);
    expect(eventos).toHaveLength(0);
  });

  it("'conversion' NO entra por esta puerta (la escribe el servidor del prospecto)", async () => {
    const res = await POST(pedir({ pagina: 'calculadora', evento: 'conversion' }));
    expect(res.status).toBe(204);
    expect(eventos).toHaveLength(0);
  });

  it('límite de tasa o cuerpo roto → 204 sin escribir, jamás un error al visitante', async () => {
    limiteOk = false;
    expect((await POST(pedir({ pagina: 'blog', evento: 'pageview' }))).status).toBe(204);
    limiteOk = true;
    const roto = new Request('https://x/api/marketing/evento', { method: 'POST', body: '{{{' });
    expect((await POST(roto)).status).toBe(204);
    expect(eventos).toHaveLength(0);
  });
});
