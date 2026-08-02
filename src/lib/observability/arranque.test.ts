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
  vi.stubEnv('DASHBOARD_PASSCODE', 'algo');
  vi.stubEnv('CUADRA_WHATSAPP_MSG_USD', '0.008');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://likidaai.vercel.app');
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

  it('grita cuando falta DASHBOARD_PASSCODE: el panel queda abierto', async () => {
    ponerTodo();
    vi.stubEnv('DASHBOARD_PASSCODE', '');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { avisarConfiguracionSilenciosa } = await import('./arranque');

    avisarConfiguracionSilenciosa();

    expect(spy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('DASHBOARD_PASSCODE');
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
});
