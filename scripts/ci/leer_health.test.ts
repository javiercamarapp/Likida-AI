import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { leerHealth } from './compuerta-deploy.mjs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 25 · ALTO REINCIDENTE — `/api/health` responde 429 (rateLimit sin
// Redis) ANTES de calcular `migracion`. Con la versión vieja, `leerHealth`
// hacía `await r.json()` sin mirar `r.status`, así que ese cuerpo (sin
// `migracion`) colaba por la puerta de escape de `decidir()` pensada para el
// arranque y la compuerta CONSTRUÍA con la base atrás del código. Rojo
// comprobado: con la versión vieja (`return await r.json()` sin comprobar
// status), la primera prueba de abajo habría devuelto el cuerpo 429 en vez
// de `null`.
// ═══════════════════════════════════════════════════════════════════════════

const resp = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('leerHealth: 429 no es un health leído — falla cerrado, no permisivo', () => {
  it('429 persistente en los 3 intentos: null, nunca el cuerpo sin migracion', async () => {
    const fetchSpy = vi.fn(async () => resp(429, { ok: false, status: 'fail', error: 'demasiadas peticiones' }));
    vi.stubGlobal('fetch', fetchSpy);
    const promesa = leerHealth('https://x/api/health', 3);
    await vi.runAllTimersAsync();
    expect(await promesa).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('429 una vez y luego 200: reintenta y SÍ lee el health real (Upstash "parpadea", no está caído)', async () => {
    let llamada = 0;
    const fetchSpy = vi.fn(async () => {
      llamada++;
      if (llamada === 1) return resp(429, { ok: false, status: 'fail', error: 'demasiadas peticiones' });
      return resp(200, { ok: true, status: 'ok', migracion: { base: '0303', codigo: '0303', atras: 0 } });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const promesa = leerHealth('https://x/api/health', 3);
    await vi.runAllTimersAsync();
    const health = await promesa;
    expect(health).toMatchObject({ migracion: { base: '0303' } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('200 de entrada: se lee sin reintentar', async () => {
    const fetchSpy = vi.fn(async () => resp(200, { ok: true, status: 'ok', migracion: { base: '0303' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const health = await leerHealth('https://x/api/health', 3);
    expect(health).toMatchObject({ migracion: { base: '0303' } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('503 (degraded, con migracion en el cuerpo) SÍ se lee — es el caso real de una base atrás', async () => {
    const fetchSpy = vi.fn(async () => resp(503, { ok: false, status: 'degraded', migracion: { base: '0299', codigo: '0303', atras: 4 } }));
    vi.stubGlobal('fetch', fetchSpy);
    const health = await leerHealth('https://x/api/health', 3);
    expect(health).toMatchObject({ migracion: { base: '0299', atras: 4 } });
  });

  it('otro código de error (500, 401, …) tampoco se lee: null sin reintentar', async () => {
    const fetchSpy = vi.fn(async () => resp(500, { ok: false }));
    vi.stubGlobal('fetch', fetchSpy);
    const health = await leerHealth('https://x/api/health', 3);
    expect(health).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('fetch que lanza (red caída): reintenta y termina en null', async () => {
    const fetchSpy = vi.fn(async () => { throw new Error('network fail'); });
    vi.stubGlobal('fetch', fetchSpy);
    const promesa = leerHealth('https://x/api/health', 2);
    await vi.runAllTimersAsync();
    expect(await promesa).toBeNull();
  });
});
