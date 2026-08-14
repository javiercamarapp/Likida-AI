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

  // ── AUD3 OP-A1: 216 fallos del cron = 1 issue = 1 notificación ────────────
  // Sentry solo notifica cuando NACE un issue. Con fingerprint [msg, nivel],
  // el fallo de la flota B caía en el issue viejo de la flota A y nadie se
  // enteraba. El tenant llega ya redactado como huella FNV estable (`id:…`),
  // así que puede ir en el fingerprint sin exponer el UUID.
  it('dos tenants fallando con el MISMO msg son DOS issues (OP-A1)', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://algo@sentry.io/1');
    const { reportar, flushObservabilidad } = await import('./sentry');

    reportar('error', 'wa.sendText', { tenant: 'id:9f2c1a4b77de', status: 401 });
    reportar('error', 'wa.sendText', { tenant: 'id:0a1b2c3d4e5f', status: 401 });
    await flushObservabilidad();

    const huellas = sdk.captureMessage.mock.calls.map((c) => JSON.stringify((c[1] as { fingerprint?: string[] }).fingerprint));
    expect(new Set(huellas).size).toBe(2);
  });

  it('causas distintas son issues distintos aunque la flota sea la misma (OP-A1)', async () => {
    // Un 190 (token vencido) y un 131030 (fuera de la lista de pruebas) tienen
    // arreglos completamente distintos: agrupados, el segundo se lee "ya lo vi".
    vi.stubEnv('SENTRY_DSN', 'https://algo@sentry.io/1');
    const { reportar, flushObservabilidad } = await import('./sentry');

    reportar('error', 'wa.sendTemplate', { tenantId: 'id:9f2c1a4b77de', codigo: 190 });
    reportar('error', 'wa.sendTemplate', { tenantId: 'id:9f2c1a4b77de', codigo: 131030 });
    await flushObservabilidad();

    const huellas = sdk.captureMessage.mock.calls.map((c) => JSON.stringify((c[1] as { fingerprint?: string[] }).fingerprint));
    expect(new Set(huellas).size).toBe(2);
  });

  it('sin tenant ni causa en el meta, el fingerprint sigue siendo [msg, nivel]', async () => {
    // Los eventos que no traen discriminadores (startup, avisos globales) no
    // cambian de cubo con este arreglo: cero issues duplicados retroactivos.
    vi.stubEnv('SENTRY_DSN', 'https://algo@sentry.io/1');
    const { reportar, flushObservabilidad } = await import('./sentry');

    reportar('error', 'startup.observabilidad', { err: 'SENTRY_DSN ausente' });
    await flushObservabilidad();

    const [, ctx] = sdk.captureMessage.mock.calls[0] as [string, { fingerprint?: string[] }];
    expect(ctx.fingerprint).toEqual(['startup.observabilidad', 'error']);
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

describe('codigoDeError — el discriminador estable de causa (auditoría 4, D2)', () => {
  // Pura y sin SDK: se prueba directo. Lo que fija es el contrato del
  // fingerprint: misma causa = mismo código (una corrida no abre un issue
  // nuevo), causa distinta = código distinto (la causa nueva SÍ notifica).

  it('la misma causa da el mismo código, corrida tras corrida', async () => {
    const { codigoDeError } = await import('./sentry');
    const a = codigoDeError(new Error('fetch failed'));
    const b = codigoDeError(new Error('fetch failed'));
    expect(a).toBe(b);
    expect(a).toMatch(/^err:[0-9a-f]{12}$/);
  });

  it('un UUID o un timestamp en el mensaje NO cambian el código', async () => {
    const { codigoDeError } = await import('./sentry');
    const a = codigoDeError(new Error('viaje 3f9c2a1b-77de-4e10-9a2b-0c1d2e3f4a5b sin cerrar tras 1723612345000 ms'));
    const b = codigoDeError(new Error('viaje 9e8d7c6b-5a49-4382-b1c0-d9e8f7a6b5c4 sin cerrar tras 1723698745000 ms'));
    expect(a).toBe(b);
  });

  it('causas distintas dan códigos distintos — incluidos dos HTTP status', async () => {
    const { codigoDeError } = await import('./sentry');
    expect(codigoDeError(new Error('HTTP 500'))).not.toBe(codigoDeError(new Error('HTTP 503')));
    expect(codigoDeError(new Error('token vencido'))).not.toBe(codigoDeError(new Error('tabla no existe')));
  });

  it('si el error trae `code` (PostgREST, Node, Meta), ese manda', async () => {
    const { codigoDeError } = await import('./sentry');
    // La forma del error POR VALOR de supabase-js: no es un Error, es un objeto.
    expect(codigoDeError({ message: 'relation "x" does not exist', code: '42P01' })).toBe('42P01');
    expect(codigoDeError({ message: 'token vencido', code: 190 })).toBe('190');
  });

  it('entra al fingerprint por la puerta que discriminadores ya lee', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://algo@sentry.io/1');
    const { reportar, codigoDeError, flushObservabilidad } = await import('./sentry');

    reportar('error', 'cron.purgar.falló', { error: 'a', codigo: codigoDeError(new Error('causa A')) });
    reportar('error', 'cron.purgar.falló', { error: 'b', codigo: codigoDeError(new Error('causa B')) });
    await flushObservabilidad();

    const huellas = sdk.captureMessage.mock.calls.map((c) => JSON.stringify((c[1] as { fingerprint?: string[] }).fingerprint));
    expect(new Set(huellas).size).toBe(2);
  });
});
