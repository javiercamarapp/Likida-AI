import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// El pulso para el monitor externo (D4): la única promesa es que el status
// HTTP diga la verdad — 200 solo con base y crons sanos, 503 si falla/degrada —
// y que el cuerpo no filtre un solo dato de negocio.

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
  it('sin latidos todavía: degraded y el cuerpo solo trae pulso (nada de negocio)', async () => {
    dbFalla = false;
    const r = await GET();
    expect(r.status).toBe(503);
    const c = await r.json();
    expect(c.ok).toBe(false);
    expect(Object.keys(c).sort()).toEqual(['checks', 'hora', 'ok', 'status', 'version']);
    expect(c.status).toBe('degraded');
    expect(c.checks.crons).toBe('unknown');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(alertarOperador).not.toHaveBeenCalled();
    // Ni tablas, ni tenants, ni correos: el health es público a propósito.
    expect(JSON.stringify(c)).not.toMatch(/tenant_id|@|supabase/i);
  });

  it('con todos los latidos frescos: 200 y ok true', async () => {
    dbFalla = false;
    const ahora = new Date().toISOString();
    latidos = ['wa-pendientes', 'wa-outbox', 'escalar', 'facturar', 'purgar', 'runner', 'gps']
      .map((id) => ({ id, ultimo_latido: ahora, estado: 'ok' }));
    const r = await GET();
    const c = await r.json();
    expect(r.status).toBe(200);
    expect(c).toMatchObject({ ok: true, status: 'ok', checks: { db: 'ok', crons: 'ok' } });
  });

  beforeEach(() => { latidos = []; });

  // RES-7: un cron vencido degrada el monitor y el detalle de qué cron fue se
  // queda en logs/alerta privados, no en el endpoint público.
  it('un cron vencido degrada el health y alerta al operador sin fuga pública', async () => {
    dbFalla = false;
    alertarOperador.mockClear();
    latidos = [
      // Tres horas sin latir: vencido con cualquier cadencia de las cortas.
      { id: 'wa-pendientes', ultimo_latido: new Date(Date.now() - 180 * 60_000).toISOString(), estado: 'ok' },
      { id: 'escalar', ultimo_latido: new Date(Date.now() - 30 * 60_000).toISOString(), estado: 'ok' },
    ];
    const r = await GET();
    expect(r.status).toBe(503);
    const c = await r.json();
    expect(c).toMatchObject({ ok: false, status: 'degraded', checks: { db: 'ok', crons: 'degraded' } });
    expect(JSON.stringify(c)).not.toContain('wa-pendientes');
    expect(alertarOperador).toHaveBeenCalledWith('cron.sin_latido', expect.objectContaining({ codigo: 'cron_sin_latido' }));
    latidos = [];
  });

  it('un latido fresco en fallo también degrada: frescura no oculta el resultado', async () => {
    dbFalla = false;
    alertarOperador.mockClear();
    const ahora = new Date().toISOString();
    latidos = ['wa-pendientes', 'wa-outbox', 'escalar', 'facturar', 'purgar', 'runner', 'gps']
      .map((id) => ({ id, ultimo_latido: ahora, estado: id === 'runner' ? 'fallo' : 'ok' }));

    const r = await GET();
    const c = await r.json();

    expect(r.status).toBe(503);
    expect(c).toMatchObject({ ok: false, status: 'degraded', checks: { db: 'ok', crons: 'degraded' } });
    expect(JSON.stringify(c)).not.toContain('runner');
    expect(alertarOperador).toHaveBeenCalledWith('cron.estado_no_ok', expect.objectContaining({ codigo: 'cron_estado_no_ok' }));
  });

  it('con la base caída: 503 y fail — lo que un monitor entiende sin leer el cuerpo', async () => {
    dbFalla = true;
    const r = await GET();
    expect(r.status).toBe(503);
    const c = await r.json();
    expect(c.ok).toBe(false);
    expect(c.status).toBe('fail');
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
describe('/api/health — no expone configuración interna', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('no expone Sentry, Redis ni nombres de infraestructura', async () => {
    dbFalla = false;
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fake.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'tok');
    const c = await (await GET()).json();
    expect(JSON.stringify(c)).not.toMatch(/upstash|sentry|token|wa-pendientes/i);
  });
});
