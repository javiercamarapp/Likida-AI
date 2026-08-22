import { describe, it, expect, vi, afterEach } from 'vitest';

// El pulso para el monitor externo (D4): la única promesa es que el status
// HTTP diga la verdad — 200 solo con la base respondiendo, 503 si no — y que
// el cuerpo no filtre un solo dato de negocio.

let dbFalla = false;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: async () => (dbFalla ? { count: null, error: { message: 'caída' } } : { count: 0, error: null }),
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { GET } = await import('./route');

describe('/api/health', () => {
  it('con la base viva: 200, ok true, y el cuerpo solo trae pulso (nada de negocio)', async () => {
    dbFalla = false;
    const r = await GET();
    expect(r.status).toBe(200);
    const c = await r.json();
    expect(c.ok).toBe(true);
    expect(c.db).toBe('ok');
    expect(Object.keys(c).sort()).toEqual(['db', 'hora', 'ok', 'ratelimit', 'sentry', 'version']);
    // Ni tablas, ni tenants, ni correos: el health es público a propósito.
    expect(JSON.stringify(c)).not.toMatch(/tenant_id|@|supabase/i);
  });

  it('con la base caída: 503 y ok false — lo que un monitor entiende sin leer el cuerpo', async () => {
    dbFalla = true;
    const r = await GET();
    expect(r.status).toBe(503);
    expect((await r.json()).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD (22-ago-2026) · SEG-1 — ¿el límite de tasa es global o de
// mentira?
//
// Sin `UPSTASH_REDIS_REST_URL`/`TOKEN`, `ratelimit.ts` cuenta en la memoria de
// CADA instancia: 10 intentos de login por 5 minutos se vuelven 10 × las
// lambdas que quien insiste consiga abrir. Eso solo se sabía leyendo la línea
// de arranque de una instancia que ya hubiera atendido algo. Ahora se pregunta
// desde fuera, en cualquier momento.
// ═══════════════════════════════════════════════════════════════════════════
describe('/api/health — el backend del límite de tasa', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('con credenciales de Upstash dice `redis`', async () => {
    dbFalla = false;
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fake.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'tok');
    expect((await (await GET()).json()).ratelimit).toBe('redis');
  });

  it('sin ellas dice `memoria` — y lo dice en claro, no lo esconde', async () => {
    dbFalla = false;
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const c = await (await GET()).json();
    expect(c.ratelimit).toBe('memoria');
    // No filtra host ni credencial: el health sigue siendo público.
    expect(JSON.stringify(c)).not.toMatch(/upstash|tok/i);
  });
});
