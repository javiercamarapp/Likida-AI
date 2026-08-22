import { describe, it, expect, vi, afterEach } from 'vitest';

// El pulso para el monitor externo (D4): la única promesa es que el status
// HTTP diga la verdad — 200 solo con la base respondiendo, 503 si no — y que
// el cuerpo no filtre un solo dato de negocio.

let dbFalla = false;
/** Las filas de `cron_latido` (RES-7). */
let latidos: Array<{ id: string; ultimo_latido: string; estado: string }> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => ({
      select: async () => tabla === 'cron_latido'
        ? { data: latidos, error: null }
        : (dbFalla ? { count: null, error: { message: 'caída' } } : { count: 0, error: null }),
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const alertarOperador = vi.fn(async () => {});
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...(a as [])) }));

const { GET } = await import('./route');

describe('/api/health', () => {
  it('con la base viva: 200, ok true, y el cuerpo solo trae pulso (nada de negocio)', async () => {
    dbFalla = false;
    const r = await GET();
    expect(r.status).toBe(200);
    const c = await r.json();
    expect(c.ok).toBe(true);
    expect(c.db).toBe('ok');
    expect(Object.keys(c).sort()).toEqual(['crons', 'db', 'hora', 'ok', 'ratelimit', 'sentry', 'version']);
    // Sin latidos todavía no es un cron muerto: nada que alertar.
    expect(c.crons['wa-pendientes']).toBe('sin_latido');
    expect(alertarOperador).not.toHaveBeenCalled();
    // Ni tablas, ni tenants, ni correos: el health es público a propósito.
    expect(JSON.stringify(c)).not.toMatch(/tenant_id|@|supabase/i);
  });

  // RES-7: un cron que lleva 21 min sin latir (cada minuto + 20 de tolerancia)
  // sale `vencido` y el operador recibe UNA alerta — antes era invisible.
  it('un cron vencido se dice en `crons` y alerta al operador; el status sigue midiendo la base', async () => {
    dbFalla = false;
    alertarOperador.mockClear();
    latidos = [
      // Tres horas sin latir: vencido con cualquier cadencia de las cortas.
      { id: 'wa-pendientes', ultimo_latido: new Date(Date.now() - 180 * 60_000).toISOString(), estado: 'ok' },
      { id: 'escalar', ultimo_latido: new Date(Date.now() - 30 * 60_000).toISOString(), estado: 'ok' },
    ];
    const r = await GET();
    expect(r.status).toBe(200);
    const c = await r.json();
    expect(c.crons).toMatchObject({ 'wa-pendientes': 'vencido', escalar: 'ok', purgar: 'sin_latido' });
    expect(alertarOperador).toHaveBeenCalledWith('cron.sin_latido', expect.objectContaining({ codigo: 'cron_sin_latido' }));
    latidos = [];
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
