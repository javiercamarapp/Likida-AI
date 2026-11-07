import { describe, it, expect, afterEach, vi } from 'vitest';
import { rateLimit, bodyExcede, reiniciarLimites } from './ratelimit';

afterEach(() => { reiniciarLimites(); vi.useRealTimers(); });

// Sin UPSTASH_REDIS_REST_URL/TOKEN en este entorno de prueba, `rateLimit` cae
// SIEMPRE al Map local (`limiteLocal`) — así que estas pruebas siguen siendo
// las del backend de respaldo, ahora detrás de un `await` porque la firma
// pública es async (ver la cabecera de ratelimit.ts: se migró para poder
// hablarle a Redis sin que un `if` síncrono se tragara la Promise). Las
// pruebas del backend de Redis, su degradación y su fallo viven en
// `ratelimit_redis.test.ts` — necesitan `vi.resetModules()` por caso para
// variar credenciales, y mezclarlas aquí habría obligado a todo este archivo
// a pagar ese mismo costo por algo que no usa.
describe('rateLimit', () => {
  it('permite hasta el límite y luego bloquea', async () => {
    const k = 'unit-key-A';
    for (let i = 0; i < 3; i++) expect(await rateLimit(k, 3, 60_000)).toBe(true);
    expect(await rateLimit(k, 3, 60_000)).toBe(false); // 4to → bloqueado
  });
  it('llaves distintas no interfieren', async () => {
    expect(await rateLimit('unit-key-B', 1, 60_000)).toBe(true);
    expect(await rateLimit('unit-key-C', 1, 60_000)).toBe(true);
    expect(await rateLimit('unit-key-B', 1, 60_000)).toBe(false);
  });
  it('la ventana se desliza: pasado el minuto vuelve a permitir', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    expect(await rateLimit('unit-key-D', 1, 60_000)).toBe(true);
    expect(await rateLimit('unit-key-D', 1, 60_000)).toBe(false);
    vi.setSystemTime(60_001);
    expect(await rateLimit('unit-key-D', 1, 60_000)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL BACKSTOP DE MEMORIA BORRABA BLOQUEOS VIVOS.
//
// La poda recorría el Map y borraba «el primer cuarto», y un Map conserva el
// orden de INSERCIÓN (un `set` sobre una llave existente no la mueve al final).
// O sea: borraba las llaves que se vieron primero, vivas o muertas. Quien
// estuviera bloqueado desde el principio recuperaba sus intentos por el simple
// hecho de que llegara tráfico nuevo.
// ═══════════════════════════════════════════════════════════════════════════
describe('poda del backstop de memoria', () => {
  it('un bloqueo vivo sobrevive a la avalancha de llaves que ya caducaron', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    // La víctima: primera llave insertada, bloqueada, con ventana larga.
    expect(await rateLimit('acceso:1.2.3.4', 1, 60_000)).toBe(true);
    expect(await rateLimit('acceso:1.2.3.4', 1, 60_000)).toBe(false);

    // 5 200 llaves de ventana corta: pasan de MAX_KEYS y disparan la poda.
    vi.setSystemTime(5_000);
    for (let i = 0; i < 5_200; i++) await rateLimit(`ruido:${i}`, 1, 1_000);

    // Con la poda por orden de alta, la víctima era la PRIMERA en caer y esto
    // devolvía true. Con la poda por caducidad, sigue bloqueada.
    expect(await rateLimit('acceso:1.2.3.4', 1, 60_000)).toBe(false);
  });
});

describe('bodyExcede', () => {
  it('detecta cuerpo grande por content-length', () => {
    const big = new Request('http://x', { method: 'POST', headers: { 'content-length': '999999' } });
    const small = new Request('http://x', { method: 'POST', headers: { 'content-length': '100' } });
    expect(bodyExcede(big, 1000)).toBe(true);
    expect(bodyExcede(small, 1000)).toBe(false);
  });
});

// F1B (adversarial): inundar 6000 llaves de un solo golpe desalojaba la llave AGOTADA
// (la poda ordenaba por caducidad) y reabria su cupo.
describe('rateLimit: una inundacion de llaves no reabre una llave agotada', () => {
  it('conserva el bloqueo de una llave con intentos acumulados', async () => {
    const k = 'login:email:203.0.113.5';
    for (let i = 0; i < 10; i++) expect(await rateLimit(k, 10, 300_000)).toBe(true);
    expect(await rateLimit(k, 10, 300_000)).toBe(false);
    for (let i = 0; i < 6000; i++) await rateLimit(`relleno:${i}`, 10, 300_000);
    expect(await rateLimit(k, 10, 300_000)).toBe(false);
  });
});

// CT-SEG-11 (F2): un límite que BLOQUEA deja constancia (solo la categoría, con freno por categoría), y uno que deja pasar no.
describe('rateLimit registra el bloqueo en evento_seguridad', () => {
  it('bloquear llama al registro con la CATEGORÍA (nunca la llave completa) y una sola vez por minuto y categoría', async () => {
    const registrar = vi.fn(async (_categoria: string) => {});
    vi.resetModules();
    vi.doMock('@/lib/seguridad/registro_acceso', () => ({ registrarRateLimit: registrar }));
    const { rateLimit: rl, reiniciarLimites: reiniciar } = await import('./ratelimit');
    reiniciar();
    expect(await rl('lead:203.0.113.7', 1, 60_000)).toBe(true);
    expect(registrar).not.toHaveBeenCalled(); // pasar no deja evento
    expect(await rl('lead:203.0.113.7', 1, 60_000)).toBe(false);
    expect(await rl('lead:203.0.113.7', 1, 60_000)).toBe(false);
    expect(await rl('lead:198.51.100.2', 1, 60_000)).toBe(true);
    expect(await rl('lead:198.51.100.2', 1, 60_000)).toBe(false);
    // Espera por CONDICIÓN (el registro es un import dinámico en segundo plano: bajo carga tarda más de 1 s, el default de waitFor).
    await vi.waitFor(() => expect(registrar).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(registrar).toHaveBeenCalledWith('lead'); // la IP no sale de aquí
    vi.doUnmock('@/lib/seguridad/registro_acceso');
  });

  it('el límite de /login no se duplica aquí (deja su propio login_fallido)', async () => {
    const registrar = vi.fn(async (_categoria: string) => {});
    vi.resetModules();
    vi.doMock('@/lib/seguridad/registro_acceso', () => ({ registrarRateLimit: registrar }));
    const { rateLimit: rl, reiniciarLimites: reiniciar } = await import('./ratelimit');
    reiniciar();
    expect(await rl('login:email:1.2.3.4', 1, 60_000)).toBe(true);
    expect(await rl('login:email:1.2.3.4', 1, 60_000)).toBe(false);
    // Antes: setTimeout fijo de 20 ms y un «no se llamó» que pasaba en vacío si el import tardaba más. Ahora un bloqueo CONTROL
    // (categoría «lead») prueba que el registro en segundo plano ya corrió; solo entonces se afirma que «login» no se registró.
    expect(await rl('lead:control', 1, 60_000)).toBe(true);
    expect(await rl('lead:control', 1, 60_000)).toBe(false);
    await vi.waitFor(() => expect(registrar).toHaveBeenCalledWith('lead'), { timeout: 10_000 });
    expect(registrar).not.toHaveBeenCalledWith('login');
    expect(registrar).toHaveBeenCalledTimes(1);
    vi.doUnmock('@/lib/seguridad/registro_acceso');
  });

  it('un registro que falla jamás cambia la decisión del límite', async () => {
    vi.resetModules();
    const intentos = vi.fn(async (_categoria: string) => { throw new Error('base caída'); });
    vi.doMock('@/lib/seguridad/registro_acceso', () => ({ registrarRateLimit: intentos }));
    const { rateLimit: rl, reiniciarLimites: reiniciar } = await import('./ratelimit');
    reiniciar();
    expect(await rl('mcp:x', 1, 60_000)).toBe(true);
    expect(await rl('mcp:x', 1, 60_000)).toBe(false);
    // Espera por condición (no 20 ms fijos): el intento de registro, que lanza, ya ocurrió y no cambió la decisión.
    await vi.waitFor(() => expect(intentos).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(await rl('mcp:x', 1, 60_000)).toBe(false);
    vi.doUnmock('@/lib/seguridad/registro_acceso');
  });
});
