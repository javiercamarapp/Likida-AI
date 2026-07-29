import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// Auditoría 5 · CRÍTICO «No hay observabilidad en producción».
//
// El reporte avisa de que poner `SENTRY_DSN` no cierra el hallazgo por sí solo,
// y enumera por qué. Estas pruebas fijan los tres puntos que sí son código:
//
//   2. `reportar()` nunca llamaba a `flush()`. En Vercel el trabajo corre dentro
//      de `after()` y la invocación se CONGELA al resolverse: el evento que más
//      importa —el último error antes de morir— era el que menos probabilidad
//      tenía de salir del proceso.
//   3. No había `onRequestError`: una excepción no atrapada en un Server
//      Component del panel no llegaba nunca (ver instrumentation.test.ts).
//   4. Solo se usaba `captureMessage`. `captureException` estaba en el tipo y no
//      se llamaba en ninguna parte → cero stack traces.
//
// Se mockea `@sentry/nextjs` a propósito: `sentry.test.ts` sigue probando el
// módulo contra el paquete real (que un DSN basura no tumbe una liquidación).
// ═══════════════════════════════════════════════════════════════════════════

const sdk = {
  init: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(async () => true),
};

vi.mock('@sentry/nextjs', () => sdk);

beforeEach(() => {
  vi.resetModules();
  sdk.init.mockClear();
  sdk.captureMessage.mockClear();
  sdk.captureException.mockClear();
  sdk.flush.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('reportar — el evento tiene que salir antes de que la invocación se congele', () => {
  it('hace flush después de capturar', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://algo@sentry.io/1');
    const { reportar, flushObservabilidad } = await import('./sentry');

    reportar('error', 'agent.fail', { tenant: 'id:9f2c1a4b77de' });
    await flushObservabilidad();

    expect(sdk.captureMessage).toHaveBeenCalledTimes(1);
    expect(sdk.flush).toHaveBeenCalled();
  });

  it('flushObservabilidad espera a los envíos en vuelo', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://algo@sentry.io/1');
    const { reportar, flushObservabilidad } = await import('./sentry');

    reportar('error', 'processInbound.fail', { viaje: 'id:aaa' });
    reportar('warn', 'pdf.upload', { path: 'id:bbb/id:ccc.pdf' });
    await flushObservabilidad();

    expect(sdk.captureMessage).toHaveBeenCalledTimes(2);
  });

  it('un aviso y su desmentido NO caen en el mismo cubo de Sentry', async () => {
    // Sentry agrupa por el texto del mensaje. El repo reutiliza el mismo `msg`
    // para un estado y su contrario: `startup.migraciones` sale como error
    // cuando falta una migración del camino del dinero y con `ok:true` cuando
    // están todas. Agrupados juntos, el error se lee como "ya lo vi".
    vi.stubEnv('SENTRY_DSN', 'https://algo@sentry.io/1');
    const { reportar, flushObservabilidad } = await import('./sentry');

    reportar('error', 'startup.migraciones', { ok: false });
    reportar('warn', 'startup.migraciones', { ok: true });
    await flushObservabilidad();

    const huellas = sdk.captureMessage.mock.calls.map((c) => JSON.stringify((c[1] as { fingerprint?: string[] }).fingerprint));
    expect(new Set(huellas).size).toBe(2);
  });

  it('sin DSN, flushObservabilidad no lanza ni carga nada', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    const { flushObservabilidad } = await import('./sentry');
    await expect(flushObservabilidad()).resolves.toBeUndefined();
    expect(sdk.init).not.toHaveBeenCalled();
  });
});

describe('reportarExcepcion — stack traces, y redactados', () => {
  it('usa captureException, no captureMessage', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://algo@sentry.io/1');
    const { reportarExcepcion, flushObservabilidad } = await import('./sentry');

    reportarExcepcion(new Error('boom'), { ruta: '/dashboard' });
    await flushObservabilidad();

    expect(sdk.captureException).toHaveBeenCalledTimes(1);
    const [err] = sdk.captureException.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).stack).toBeTruthy();
  });

  it('el mensaje y el stack salen por el MISMO redactor que los logs', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://algo@sentry.io/1');
    const { reportarExcepcion, flushObservabilidad } = await import('./sentry');
    const { huellaId } = await import('@/lib/logger');

    const uuid = '11111111-1111-1111-1111-111111111111';
    reportarExcepcion(new Error(`no se pudo cerrar el viaje ${uuid} de XAXX010101000`));
    await flushObservabilidad();

    const [err] = sdk.captureException.mock.calls[0];
    const msg = (err as Error).message;
    expect(msg).not.toContain(uuid);
    expect(msg).not.toContain('XAXX010101000');
    expect(msg).toContain(huellaId(uuid)); // la traza sobrevive
    expect(msg).toContain('[RFC]');
  });

  it('conserva el digest de Next: es el hash que ve el usuario en pantalla', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://algo@sentry.io/1');
    const { reportarExcepcion, flushObservabilidad } = await import('./sentry');

    const e = Object.assign(new Error('falló el render'), { digest: '3155718393' });
    reportarExcepcion(e, { ruta: '/dashboard' });
    await flushObservabilidad();

    const [, ctx] = sdk.captureException.mock.calls[0];
    expect(JSON.stringify(ctx)).toContain('3155718393');
  });

  it('sin DSN no hace nada y no lanza', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    const { reportarExcepcion } = await import('./sentry');
    expect(() => reportarExcepcion(new Error('x'))).not.toThrow();
    expect(sdk.captureException).not.toHaveBeenCalled();
  });
});

describe('avisarObservabilidad — arrancar sin observabilidad tiene que DECIRSE', () => {
  it('en producción sin SENTRY_DSN emite un error de arranque', async () => {
    // La causa raíz del hallazgo: "el sistema arranca en producción sin
    // observabilidad y no lo dice". El único momento en que alguien mira los
    // logs de Vercel a propósito es justo después de desplegar.
    vi.stubEnv('SENTRY_DSN', '');
    vi.stubEnv('VERCEL_ENV', 'production');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { avisarObservabilidad } = await import('./sentry');

    avisarObservabilidad();

    const lineas = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(lineas).toContain('startup.observabilidad');
    expect(lineas).toContain('"level":"error"');
    expect(lineas).toContain('"sentry":false');
  });

  it('con SENTRY_DSN deja constancia de que sí está encendida', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://algo@sentry.io/1');
    vi.stubEnv('VERCEL_ENV', 'production');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { avisarObservabilidad } = await import('./sentry');

    avisarObservabilidad();

    const lineas = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(lineas).toContain('startup.observabilidad');
    expect(lineas).toContain('"sentry":true');
  });

  it('en local no mete ruido', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('NODE_ENV', 'development');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { avisarObservabilidad } = await import('./sentry');

    avisarObservabilidad();

    const todo = [...err.mock.calls, ...log.mock.calls].map((c) => String(c[0])).join('\n');
    expect(todo).not.toContain('startup.observabilidad');
  });
});
