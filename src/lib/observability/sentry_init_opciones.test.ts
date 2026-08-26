import { describe, it, expect, vi, afterEach } from 'vitest';

// BACKEND-19C2-3 — `beforeSend` y `beforeSendTransaction` son hooks
// INDEPENDIENTES del SDK: con `tracesSampleRate` > 0 (default 0.05), una
// transacción de performance salía sin pasar por `sanitizarEventoSentry`
// (mismas cookies/headers/RFC/domicilio que un evento de error). Este test
// fija que `init()` registra los dos hooks con el mismo saneador.

const init = vi.hoisted(() => vi.fn());
vi.mock('@sentry/nextjs', () => ({
  init,
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  flush: vi.fn(async () => true),
}));

const { reportar, flushObservabilidad } = await import('./sentry');

describe('sentry — init() sanea error Y transacción', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('registra beforeSend y beforeSendTransaction con el mismo saneador', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://algo@sentry.io/1');
    reportar('warn', 'algo.pasó');
    await flushObservabilidad();

    expect(init).toHaveBeenCalledTimes(1);
    const opciones = init.mock.calls[0][0] as { beforeSend: (e: unknown) => unknown; beforeSendTransaction: (e: unknown) => unknown };
    expect(typeof opciones.beforeSendTransaction).toBe('function');

    // Mismo comportamiento de saneado para los dos tipos de evento.
    const evento = { request: { url: 'https://app.likida.ai/x?token=secreto', cookies: 'c' }, user: { email: 'a@b.com' } };
    const porError = opciones.beforeSend(structuredClone(evento)) as { user?: unknown; request: { cookies?: unknown } };
    const porTransaccion = opciones.beforeSendTransaction(structuredClone(evento)) as { user?: unknown; request: { cookies?: unknown } };
    expect(porTransaccion.user).toBeUndefined();
    expect(porTransaccion.request.cookies).toBeUndefined();
    expect(porTransaccion).toEqual(porError);
  });

  it('la forma PROPIA de una transacción también se sanea: spans[].data y contexts.trace.data', async () => {
    // El SDK (getFetchSpanAttributes, @sentry/core) mete en `data` de cada span
    // de fetch la URL COMPLETA (`url`, `http.url`, `url.full`) y la query
    // aparte (`http.query`). Recortar solo `request.url` dejaba esa misma query
    // (`?token=…`, `rfc=eq.…`) intacta en los spans y en el span raíz.
    vi.stubEnv('SENTRY_DSN', 'https://algo@sentry.io/1');
    reportar('warn', 'algo.pasó');
    await flushObservabilidad();

    const opciones = init.mock.calls[0][0] as { beforeSendTransaction: (e: unknown) => unknown };
    const transaccion = {
      type: 'transaction',
      transaction: 'GET /api/export/liquidaciones',
      request: { url: 'https://app.likida.ai/api/export/liquidaciones?token=secreto' },
      contexts: {
        trace: { trace_id: 't1', span_id: 's0', data: { 'url.query': '?token=secreto' } },
        runtime: { name: 'node' },
      },
      spans: [{
        span_id: 's1', trace_id: 't1', start_timestamp: 1, timestamp: 2,
        op: 'http.client', description: 'GET https://x.supabase.co/rest/v1/viaje',
        data: { 'url.full': 'https://x.supabase.co/rest/v1/viaje?rfc=eq.CAPJ800101XXX', 'http.query': '?rfc=eq.CAPJ800101XXX' },
      }],
    };
    const limpio = opciones.beforeSendTransaction(structuredClone(transaccion)) as {
      request: { url?: string };
      spans: Array<Record<string, unknown>>;
      contexts: { trace: Record<string, unknown>; runtime: Record<string, unknown> };
    };
    expect(limpio.spans[0].data).toBeUndefined();
    // Lo que hace útil la traza se conserva: op, description (sin query) y tiempos.
    expect(limpio.spans[0].op).toBe('http.client');
    expect(limpio.spans[0].description).toBe('GET https://x.supabase.co/rest/v1/viaje');
    expect(limpio.contexts.trace.data).toBeUndefined();
    expect(limpio.contexts.trace.trace_id).toBe('t1');
    expect(limpio.contexts.runtime).toEqual({ name: 'node' });
    expect(limpio.request.url).toBe('https://app.likida.ai/api/export/liquidaciones');
  });
});
