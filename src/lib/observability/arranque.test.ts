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
