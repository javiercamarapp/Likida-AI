// ═══════════════════════════════════════════════════════════════════════════
// EL BACKEND DISTRIBUIDO (Upstash Redis) Y SUS TRES AVERÍAS.
//
// Separado de `ratelimit.test.ts` a propósito: estas pruebas varían
// credenciales y `NODE_ENV`/`VERCEL_ENV` caso por caso, así que cada `it`
// necesita `vi.resetModules()` + un import dinámico para arrancar el módulo
// con el `avisadoBackend` de fábrica — mezclarlas con las del Map local habría
// obligado a TODAS a pagar ese mismo costo.
//
// Lo que se prueba, en el orden en que aparece en la cabecera de ratelimit.ts:
//   1. con Redis sano, el conteo es del SERVIDOR (dos "instancias" que pegan
//      a la misma llave no pueden ambas colarse pasado el límite — la carrera
//      que el Map por instancia no podía cerrar);
//   2. la ventana caduca (TTL) y vuelve a permitir;
//   3. sin credenciales, se degrada al Map Y LO DICE en el arranque;
//   4. con credenciales pero el intento falla, NUNCA LANZA y NIEGA por
//      default (fail-closed — SEG-4, auditoría 24);
//   5. con `RATELIMIT_REDIS_FALLA_CERRADO=false` (o `{ fallaCerrado: false }`
//      por llamada), esa misma avería se degrada al Map local.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

function stubCredenciales() {
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fake-redis.upstash.io');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'tok-de-prueba');
}

/**
 * Un doble de la REST API de Upstash que SÍ hace lo que el script Lua
 * promete: incrementa y solo pone TTL la primera vez. No interpreta el Lua
 * de verdad (no hay VM aquí) — representa lo que Redis garantiza server-side,
 * que es justo lo que `intentarRedis` no puede — ni debe — reimplementar.
 */
function fetchRedisFalso() {
  const contadores = new Map<string, { n: number; expiraEn: number }>();
  const llamadas: Array<{ body: unknown; auth: string | null }> = [];

  const fn = vi.fn(async (_url: string, init: RequestInit) => {
    const [, , , key, windowMs] = JSON.parse(String(init.body)) as [string, string, number, string, number];
    llamadas.push({ body: init.body, auth: (init.headers as Record<string, string>)?.Authorization ?? null });

    const now = Date.now();
    const actual = contadores.get(key);
    const vivo = actual && actual.expiraEn > now;
    const n = vivo ? actual.n + 1 : 1;
    contadores.set(key, { n, expiraEn: vivo ? actual.expiraEn : now + windowMs });

    return new Response(JSON.stringify({ result: n }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { fn, llamadas };
}

describe('backend Redis — el conteo es del servidor, no de la instancia', () => {
  it('20 llamadas concurrentes a la misma llave con límite 5: exactamente 5 pasan', async () => {
    stubCredenciales();
    const { fn } = fetchRedisFalso();
    vi.stubGlobal('fetch', fn);
    const { rateLimit } = await import('./ratelimit');

    // Simula lo que el P1 de la auditoría describe: varias "instancias" (aquí,
    // varias llamadas concurrentes desde el mismo proceso) golpeando la misma
    // llave a la vez. Con el Map viejo, cada instancia habría permitido sus
    // propios 5 — aquí solo hay UN contador, en el mock que hace de Redis.
    const resultados = await Promise.all(
      Array.from({ length: 20 }, () => rateLimit('carrera:1.2.3.4', 5, 60_000)),
    );
    expect(resultados.filter(Boolean).length).toBe(5);
  });

  it('llaves distintas no comparten contador', async () => {
    stubCredenciales();
    const { fn } = fetchRedisFalso();
    vi.stubGlobal('fetch', fn);
    const { rateLimit } = await import('./ratelimit');

    expect(await rateLimit('a', 1, 60_000)).toBe(true);
    expect(await rateLimit('b', 1, 60_000)).toBe(true);
    expect(await rateLimit('a', 1, 60_000)).toBe(false);
  });

  it('manda el token como Bearer y el comando como EVAL con TTL en ms', async () => {
    stubCredenciales();
    const { fn, llamadas } = fetchRedisFalso();
    vi.stubGlobal('fetch', fn);
    const { rateLimit } = await import('./ratelimit');

    await rateLimit('x', 1, 30_000);
    expect(llamadas[0].auth).toBe('Bearer tok-de-prueba');
    const cuerpo = JSON.parse(String(llamadas[0].body));
    expect(cuerpo[0]).toBe('EVAL');
    expect(cuerpo[4]).toBe(30_000); // windowMs viaja tal cual, para PEXPIRE
  });

  it('la ventana caduca (TTL) y vuelve a permitir', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    stubCredenciales();
    const { fn } = fetchRedisFalso();
    vi.stubGlobal('fetch', fn);
    const { rateLimit } = await import('./ratelimit');

    expect(await rateLimit('ventana', 1, 60_000)).toBe(true);
    expect(await rateLimit('ventana', 1, 60_000)).toBe(false);
    vi.setSystemTime(60_001);
    expect(await rateLimit('ventana', 1, 60_000)).toBe(true);
  });
});

describe('sin credenciales — degrada al Map local y lo DICE en el arranque', () => {
  it('sin UPSTASH_REDIS_REST_URL/TOKEN, igual aplica un límite (vía el Map)', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const fetchEspia = vi.fn();
    vi.stubGlobal('fetch', fetchEspia);
    const { rateLimit } = await import('./ratelimit');

    expect(await rateLimit('sin-creds', 1, 60_000)).toBe(true);
    expect(await rateLimit('sin-creds', 1, 60_000)).toBe(false); // el Map igual limita
    expect(fetchEspia).not.toHaveBeenCalled(); // nunca intenta Redis sin credenciales
  });

  it('en un despliegue real, avisa la degradación UNA vez (no en silencio)', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rateLimit } = await import('./ratelimit');

    await rateLimit('k1', 5, 60_000);
    await rateLimit('k2', 5, 60_000);
    await rateLimit('k3', 5, 60_000);

    const lineas = err.mock.calls.map((c) => String(c[0]));
    const avisos = lineas.filter((l) => l.includes('startup.ratelimit_backend'));
    expect(avisos.length).toBe(1); // una vez por instancia fría, no por llamada
    expect(avisos[0]).toContain('"backend":"memoria"');
    expect(avisos[0]).toContain('UPSTASH_REDIS_REST_URL');
  });

  it('en local (sin VERCEL_ENV, sin NODE_ENV=production) no mete ruido', async () => {
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { rateLimit } = await import('./ratelimit');

    await rateLimit('k', 5, 60_000);

    const todo = [...err.mock.calls, ...log.mock.calls].map((c) => String(c[0])).join('\n');
    expect(todo).not.toContain('startup.ratelimit_backend');
  });

  it('con Redis configurado y sano, el arranque avisa "redis" (no es solo el caso de alarma)', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    stubCredenciales();
    const { fn } = fetchRedisFalso();
    vi.stubGlobal('fetch', fn);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { rateLimit } = await import('./ratelimit');

    await rateLimit('k', 5, 60_000);

    const linea = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(linea).toContain('startup.ratelimit_backend');
    expect(linea).toContain('"backend":"redis"');
  });
});

describe('Redis configurado pero el intento falla — nunca rompe la petición', () => {
  it('SEG-4: red caída NIEGA por default (fail-closed), sin lanzar, y no filtra la llave al log', async () => {
    stubCredenciales();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rateLimit } = await import('./ratelimit');

    // Ni una sola llamada debe rechazar la promesa — y con Redis caído la
    // respuesta es «no», no «pasa por el Map de esta instancia».
    await expect(rateLimit('login:1.2.3.4', 100, 60_000)).resolves.toBe(false);
    const lineas = [...err.mock.calls, ...warn.mock.calls].map((c) => String(c[0])).join('\n');
    expect(lineas).toContain('ratelimit.redis_fallo');
    expect(lineas).toContain('ratelimit.redis_falla_cerrado');
    // La llave entera lleva la IP (reincidente 22): al log solo va la categoría.
    expect(lineas).not.toContain('1.2.3.4');
    expect(lineas).toContain('"llave":"login"');
  });

  it('RATELIMIT_REDIS_FALLA_CERRADO=false: degrada al Map (fail-open acotado, el Map sigue limitando)', async () => {
    stubCredenciales();
    vi.stubEnv('RATELIMIT_REDIS_FALLA_CERRADO', 'false');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const { rateLimit } = await import('./ratelimit');

    await expect(rateLimit('avería', 1, 60_000)).resolves.toBe(true);
    // El Map local, que recibió el hit de arriba como fallback, sigue
    // imponiendo el mismo límite — no es "se apagó la protección".
    await expect(rateLimit('avería', 1, 60_000)).resolves.toBe(false);
  });

  it('por llamada: `{ fallaCerrado: false }` degrada aunque el default sea cerrado; `true` niega aunque la env diga false', async () => {
    stubCredenciales();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const { rateLimit } = await import('./ratelimit');
    await expect(rateLimit('sesion', 5, 60_000, { fallaCerrado: false })).resolves.toBe(true);
    vi.stubEnv('RATELIMIT_REDIS_FALLA_CERRADO', 'false');
    await expect(rateLimit('publica', 5, 60_000, { fallaCerrado: true })).resolves.toBe(false);
  });

  it('timeout: mismo tratamiento que red caída (niega, no lanza)', async () => {
    stubCredenciales();
    vi.stubGlobal('fetch', vi.fn(() => new Promise((_res, rej) => {
      const e = new Error('timeout'); e.name = 'TimeoutError'; rej(e);
    })));
    const { rateLimit } = await import('./ratelimit');
    await expect(rateLimit('timeout-key', 1, 60_000)).resolves.toBe(false);
  });

  it('Upstash contesta con error (comando inválido): niega, no lanza', async () => {
    stubCredenciales();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'ERR algo salió mal' }), { status: 400 },
    )));
    const { rateLimit } = await import('./ratelimit');
    await expect(rateLimit('err-key', 1, 60_000)).resolves.toBe(false);
  });

  it('deja rastro del fallo en el log (no es un silencio)', async () => {
    stubCredenciales();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rateLimit } = await import('./ratelimit');

    await rateLimit('log-key', 1, 60_000);

    const linea = err.mock.calls.map((c) => String(c[0])).join('\n');
    expect(linea).toContain('ratelimit.redis_fallo');
    expect(linea).toContain('ECONNREFUSED');
  });

  it('RATELIMIT_REDIS_FALLA_CERRADO=true sigue negando (compatibilidad con quien ya la tenía puesta)', async () => {
    stubCredenciales();
    vi.stubEnv('RATELIMIT_REDIS_FALLA_CERRADO', 'true');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const { rateLimit } = await import('./ratelimit');
    await expect(rateLimit('cerrado', 100, 60_000)).resolves.toBe(false);
  });

  it('cualquier valor que no sea el string "false" se comporta como el default (cerrado)', async () => {
    stubCredenciales();
    vi.stubEnv('RATELIMIT_REDIS_FALLA_CERRADO', 'FALSE'); // mayúsculas: no cuenta
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const { rateLimit } = await import('./ratelimit');

    await expect(rateLimit('mayus', 5, 60_000)).resolves.toBe(false);
  });
});
