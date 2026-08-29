import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { CRONS } from '@/lib/admin/salud';

// El pulso para el monitor externo (D4): la única promesa es que el status
// HTTP diga la verdad — 200 solo con base y crons sanos, 503 si falla/degrada —
// y que el cuerpo no filtre un solo dato de negocio.

let dbFalla = false;
/** Las filas de `cron_latido` (RES-7), con `detalle` opcional (auditoría prod
 *  29-ago-2026: distinguir un hueco de configuración de una regresión real). */
let latidos: Array<{ id: string; ultimo_latido: string; estado: string; detalle?: Record<string, unknown> }> = [];
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
const alertarOperador = vi.fn(async (..._a: unknown[]) => {});
const alertarHuecoConfiguracion = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/observability/alerta', () => ({
  alertarOperador: (...a: unknown[]) => alertarOperador(...(a as [])),
  alertarHuecoConfiguracion: (...a: unknown[]) => alertarHuecoConfiguracion(...(a as [])),
}));

// OPERABILIDAD-19C2-3: permitido por default en todas las pruebas de este
// archivo — el rate limit tiene su propio caso dedicado abajo.
let permitido = true;
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => permitido,
  clientIp: () => '203.0.113.5',
}));

const { GET } = await import('./route');
const peticion = () => new Request('https://app.likida.ai/api/health') as never;

describe('/api/health', () => {
  it('sin latidos todavía: degraded y el cuerpo solo trae pulso (nada de negocio)', async () => {
    dbFalla = false;
    const r = await GET(peticion());
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
    // La lista REAL de crons, no una copia: la copia se quedó vieja al nacer
    // `asistencia` (Fase 5) y esta prueba llamó enfermo a un sistema sano.
    latidos = [...CRONS].map((id) => ({ id, ultimo_latido: ahora, estado: 'ok' }));
    const r = await GET(peticion());
    const c = await r.json();
    expect(r.status).toBe(200);
    expect(c).toMatchObject({ ok: true, status: 'ok', checks: { db: 'ok', crons: 'ok' } });
  });

  beforeEach(() => { latidos = []; permitido = true; });

  it('OPERABILIDAD-19C2-3: excedido el límite de tasa por IP, 429 sin tocar la base', async () => {
    permitido = false;
    const r = await GET(peticion());
    expect(r.status).toBe(429);
    const c = await r.json();
    expect(c.ok).toBe(false);
  });

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
    const r = await GET(peticion());
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

    const r = await GET(peticion());
    const c = await r.json();

    expect(r.status).toBe(503);
    expect(c).toMatchObject({ ok: false, status: 'degraded', checks: { db: 'ok', crons: 'degraded' } });
    expect(JSON.stringify(c)).not.toContain('runner');
    expect(alertarOperador).toHaveBeenCalledWith('cron.estado_no_ok', expect.objectContaining({ codigo: 'cron_estado_no_ok' }));
  });

  // AUDITORÍA PROD 29-ago-2026: ocho correos "Urgente" en doce horas por
  // `descarga-sat` sin LIKIDA_SAT_PROVEEDOR — un hueco de configuración que el
  // propio cron ya declaró con toda precisión, indistinguible de una
  // regresión real porque `alertarOperador('cron.estado_no_ok', ...)` se
  // disparaba en CADA ping de un monitor externo. Fija el comportamiento
  // nuevo: el health sigue diciendo la verdad (503/degraded), pero el hueco
  // declarado ya NO manda el correo urgente repetido.
  it('hueco de configuración declarado: degrada el health pero NO manda el correo urgente repetido', async () => {
    dbFalla = false;
    alertarOperador.mockClear();
    alertarHuecoConfiguracion.mockClear();
    const ahora = new Date().toISOString();
    latidos = [
      {
        id: 'descarga-sat',
        ultimo_latido: ahora,
        estado: 'parcial',
        detalle: {
          motivo: 'La descarga masiva no está configurada: falta LIKIDA_SAT_PROVEEDOR en el servidor. Lo destraba Javier (contrato con el PAC y variables de entorno).',
        },
      },
    ];

    const r = await GET(peticion());
    const c = await r.json();

    // El monitor externo sigue viendo la verdad: el cron no está sano.
    expect(r.status).toBe(503);
    expect(c).toMatchObject({ ok: false, status: 'degraded', checks: { db: 'ok', crons: 'degraded' } });
    // Pero el canal urgente no se dispara por un hueco ya conocido...
    expect(alertarOperador).not.toHaveBeenCalled();
    // ...se avisa por el canal de "pendiente de configurar", con el motivo tal cual.
    expect(alertarHuecoConfiguracion).toHaveBeenCalledWith(
      'cron.config_ausente:descarga-sat',
      expect.stringMatching(/LIKIDA_SAT_PROVEEDOR/),
      expect.objectContaining({ cron: 'descarga-sat' }),
    );
  });

  it('un hueco declarado y una regresión real a la vez: cada quien su canal', async () => {
    dbFalla = false;
    alertarOperador.mockClear();
    alertarHuecoConfiguracion.mockClear();
    const ahora = new Date().toISOString();
    latidos = [
      {
        id: 'descarga-sat',
        ultimo_latido: ahora,
        estado: 'parcial',
        detalle: { motivo: 'La descarga masiva no está configurada: falta LIKIDA_SAT_PROVEEDOR en el servidor.' },
      },
      // `runner` sí se rompió de verdad: nada en su motivo habla de configurar.
      { id: 'runner', ultimo_latido: ahora, estado: 'fallo', detalle: { codigo: 'timeout_proveedor' } },
    ];

    const r = await GET(peticion());
    const c = await r.json();

    expect(r.status).toBe(503);
    expect(c).toMatchObject({ ok: false, status: 'degraded', checks: { db: 'ok', crons: 'degraded' } });
    // La regresión real SIGUE alertando por el canal urgente de siempre.
    expect(alertarOperador).toHaveBeenCalledWith('cron.estado_no_ok', expect.objectContaining({
      error: expect.stringContaining('runner'),
    }));
    expect(alertarOperador).toHaveBeenCalledTimes(1);
    // El nombre del cron que sí se rompió no se cuela en el aviso del hueco.
    const detalleUrgente = alertarOperador.mock.calls[0]?.[1] as { error?: string } | undefined;
    expect(detalleUrgente?.error).not.toContain('descarga-sat');
    // El hueco declarado sigue yendo por su propio canal, no por el urgente.
    expect(alertarHuecoConfiguracion).toHaveBeenCalledWith(
      'cron.config_ausente:descarga-sat',
      expect.stringMatching(/LIKIDA_SAT_PROVEEDOR/),
      expect.anything(),
    );
  });

  it('con la base caída: 503 y fail — lo que un monitor entiende sin leer el cuerpo', async () => {
    dbFalla = true;
    const r = await GET(peticion());
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
    const c = await (await GET(peticion())).json();
    expect(JSON.stringify(c)).not.toMatch(/upstash|sentry|token|wa-pendientes/i);
  });
});
