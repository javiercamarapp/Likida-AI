import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// Auditoría 5 · ALTO «`.env.example` no documenta las dos variables que
// gobiernan el panel».
//
// El documento ya se arregló, pero el reporte cierra con la parte que un
// documento no puede resolver: «el procedimiento documentado no las produce **y
// nada avisa si desaparecen**». `DEMO_TENANT_ID` es el caso de manual — sin ella
// el panel NO falla: consulta el tenant del seed y pinta cero liquidaciones. En
// la sala, el 6 de agosto, eso se ve como "el producto no guardó nada".
//
// Lo que se prueba aquí es que la ausencia se oiga en el arranque, que es el
// único momento en que alguien mira los logs a propósito.
// ═══════════════════════════════════════════════════════════════════════════

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function ponerTodo() {
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('DEMO_TENANT_ID', '11111111-1111-1111-1111-111111111111');
  vi.stubEnv('LIKIDA_WHATSAPP_MSG_USD', '0.008');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://likidaai.vercel.app');
  vi.stubEnv('ALERTA_EMAIL', 'operador@likida.ai');
  vi.stubEnv('LIKIDA_FLOTA_COOKIE_LLAVE', 'llave-de-prueba');
  // Auditoría prod (SEG-1): sin las dos, el límite de tasa cuenta por
  // instancia y el techo del login se multiplica por las lambdas abiertas.
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fake.upstash.io');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'tok-de-prueba');
}

describe('avisarConfiguracionSilenciosa', () => {
  it('grita cuando falta DEMO_TENANT_ID en un despliegue real', async () => {
    ponerTodo();
    vi.stubEnv('DEMO_TENANT_ID', '');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { avisarConfiguracionSilenciosa } = await import('./arranque');

    avisarConfiguracionSilenciosa();

    const linea = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(linea).toContain('startup.config_silenciosa');
    expect(linea).toContain('"level":"error"');
    expect(linea).toContain('DEMO_TENANT_ID');
  });

  it('grita cuando falta NEXT_PUBLIC_APP_URL: el login redirige al dominio equivocado', async () => {
    // El caso más caro de este rubro en la rama de auth: sin ella el magic link
    // se arma contra el fallback del código y el contralor nunca completa la
    // sesión, sin que nada falle en ningún log.
    ponerTodo();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { avisarConfiguracionSilenciosa } = await import('./arranque');

    avisarConfiguracionSilenciosa();

    const linea = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(linea).toContain('startup.config_silenciosa');
    expect(linea).toContain('NEXT_PUBLIC_APP_URL');
  });

  it('grita cuando falta ALERTA_EMAIL: los fallos de cron no le llegan a nadie por correo', async () => {
    // Auditoría 4, D1: exactamente la clase de fallo de esta lista — sin ella
    // el sistema arranca, atiende, y un cron puede fallar nueve días sin que
    // nadie reciba un correo.
    ponerTodo();
    vi.stubEnv('ALERTA_EMAIL', '');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { avisarConfiguracionSilenciosa } = await import('./arranque');

    avisarConfiguracionSilenciosa();

    const linea = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(linea).toContain('startup.config_silenciosa');
    expect(linea).toContain('ALERTA_EMAIL');
  });

  it('con todo puesto deja constancia y no alarma', async () => {
    ponerTodo();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { avisarConfiguracionSilenciosa } = await import('./arranque');

    avisarConfiguracionSilenciosa();

    expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toContain('"ok":true');
    expect(err.mock.calls.map((c) => String(c[0])).join('\n')).not.toContain('startup.config_silenciosa');
  });

  it('el valor de la variable NUNCA sale en el aviso, solo su nombre', async () => {
    // El aviso se emite en el arranque de producción: nombrar el tenant o el
    // passcode ahí sería filtrarlos por la puerta que abrimos para vigilar.
    ponerTodo();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { avisarConfiguracionSilenciosa } = await import('./arranque');

    avisarConfiguracionSilenciosa();

    expect(log.mock.calls.map((c) => String(c[0])).join('\n')).not.toContain('algo');
  });

  it('nombra el grupo y la variable que falta de la configuración dura', async () => {
    // Auditoría 5, MEDIO: `requireEnv` existía, su comentario decía «llamar en
    // los paths críticos» y no lo llamaba nadie. Ahora el inventario de `env.ts`
    // tiene un consumidor: el arranque. Sin `OPENROUTER_API_KEY` el sistema hoy
    // arranca y falla en el turno de un operador, con el error del SDK.
    ponerTodo();
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { avisarConfiguracionSilenciosa } = await import('./arranque');

    avisarConfiguracionSilenciosa();

    const linea = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(linea).toContain('startup.entorno_grupos');
    expect(linea).toContain('OPENROUTER_API_KEY');
  });

  it('el aviso de los grupos NO comparte `msg` con el de las silenciosas', async () => {
    // Sentry agrupa por mensaje: dos avisos distintos en el mismo cubo es cómo
    // se pierde el segundo.
    ponerTodo();
    vi.stubEnv('DEMO_TENANT_ID', '');
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { avisarConfiguracionSilenciosa } = await import('./arranque');

    avisarConfiguracionSilenciosa();

    const msgs = spy.mock.calls.map((c) => JSON.parse(String(c[0])).msg);
    expect(new Set(msgs)).toEqual(new Set(['startup.config_silenciosa', 'startup.entorno_grupos']));
  });

  it('en local no mete ruido', async () => {
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEMO_TENANT_ID', '');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { avisarConfiguracionSilenciosa } = await import('./arranque');

    avisarConfiguracionSilenciosa();

    const todo = [...err.mock.calls, ...log.mock.calls].map((c) => String(c[0])).join('\n');
    expect(todo).not.toContain('startup.config_silenciosa');
  });

  it('en local SÍ dice qué variable DURA falta — es donde nadie tiene panel de logs (M17)', async () => {
    // Día 1 de alguien nuevo: `cp .env.example .env.local` deja todo vacío y el
    // servidor levantaba sin decir una palabra; el primer síntoma era el error
    // del SDK de Supabase al abrir /dashboard. La lista exacta de lo que falta
    // existía (`faltantes()`) y se callaba precisamente en local.
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { avisarConfiguracionSilenciosa } = await import('./arranque');

    avisarConfiguracionSilenciosa();

    const errores = err.mock.calls.map((c) => String(c[0])).join('\n');
    expect(errores).toContain('startup.entorno_grupos');
    expect(errores).toContain('OPENROUTER_API_KEY');
    // Y sigue sin el ruido de las silenciosas ni del "todo bien".
    const todo = [...err.mock.calls, ...log.mock.calls].map((c) => String(c[0])).join('\n');
    expect(todo).not.toContain('startup.config_silenciosa');
  });
});

// AUDITORÍA PROD (22-ago-2026) · SEG-1 — el límite de tasa sin Redis no es un
// límite: `ratelimit.ts` cae a un Map por instancia y N intentos se vuelven
// N × (instancias que el atacante consiga abrir en paralelo).
describe('las credenciales de Upstash entraron a la lista silenciosa', () => {
  it('grita si falta la URL, y nombra la consecuencia (no el valor)', async () => {
    ponerTodo();
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { avisarConfiguracionSilenciosa } = await import('./arranque');

    avisarConfiguracionSilenciosa();

    const linea = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(linea).toContain('UPSTASH_REDIS_REST_URL');
    expect(linea).toContain('memoria de CADA instancia');
    expect(linea).not.toContain('fake.upstash.io');
  });

  it('y también si falta solo el TOKEN: media credencial es tan inútil como ninguna', async () => {
    ponerTodo();
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { avisarConfiguracionSilenciosa } = await import('./arranque');

    avisarConfiguracionSilenciosa();

    expect(spy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('UPSTASH_REDIS_REST_TOKEN');
  });
});
