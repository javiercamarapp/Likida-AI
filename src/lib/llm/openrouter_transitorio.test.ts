import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 4 · ALTO — el fallback cross-provider no se disparaba con el
// error que produce un proveedor caído DE VERDAD.
//
// `isTransientError` clasificaba por el TEXTO del mensaje. Pero el SDK de OpenAI
// construye, para cualquier fallo de conexión —DNS, TCP rechazado, TLS,
// `fetch failed` de undici—, un `APIConnectionError` cuyo mensaje es la cadena
// literal "Connection error.": el detalle real queda en `err.cause`, que nunca
// se leía.
//
// Así que el fallback absorbía los 503 (que es lo que probaban los tests, con
// `new Error('503 ...')`) y NO absorbía la caída de red, que es el caso para el
// que se diseñó. En la sala del 6-ago eso es el agente contestando "se me trabó
// el sistema" ante un parpadeo que el diseño prometía tapar.
// ═══════════════════════════════════════════════════════════════════════════

process.env.OPENROUTER_API_KEY = 'test-key';
const { isTransientError } = await import('./openrouter');

/** Reconstruye el error tal como lo arma `openai@6`: mensaje genérico, causa real. */
const errorDeConexion = (causa: string) => {
  const e = new Error('Connection error.');
  e.name = 'APIConnectionError';
  (e as Error & { cause?: unknown }).cause = new TypeError(causa);
  return e;
};

describe('isTransientError — el proveedor caído tiene que contar como transitorio', () => {
  it('APIConnectionError por DNS/TCP/TLS es transitorio', () => {
    expect(isTransientError(errorDeConexion('fetch failed'))).toBe(true);
    expect(isTransientError(errorDeConexion('getaddrinfo ENOTFOUND openrouter.ai'))).toBe(true);
  });

  it('también si solo llega el mensaje genérico, sin causa', () => {
    const e = new Error('Connection error.');
    e.name = 'APIConnectionError';
    expect(isTransientError(e)).toBe(true);
  });

  it('un error con status 5xx/429/408 es transitorio aunque el mensaje no traiga el número', () => {
    for (const status of [500, 502, 503, 504, 429, 408]) {
      const e = Object.assign(new Error('upstream problem'), { status });
      expect(isTransientError(e), `status ${status}`).toBe(true);
    }
  });

  it('lo que NO es transitorio sigue sin serlo: un 400 no debe disparar el fallback', () => {
    expect(isTransientError(new Error('400 thinking.budget_tokens must be >= 1024'))).toBe(false);
    expect(isTransientError(Object.assign(new Error('bad request'), { status: 400 }))).toBe(false);
    expect(isTransientError(Object.assign(new Error('unauthorized'), { status: 401 }))).toBe(false);
  });

  it('lo que ya funcionaba sigue funcionando (regresión)', () => {
    expect(isTransientError(new Error('503 Service Unavailable: provider caído'))).toBe(true);
    expect(isTransientError(new Error('Request timed out.'))).toBe(true);
    expect(isTransientError(new Error('429 rate limit exceeded'))).toBe(true);
    expect(isTransientError(new Error('overloaded'))).toBe(true);
  });
});
