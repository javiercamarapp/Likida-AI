// ═══════════════════════════════════════════════════════════════════════════
// AUD24 · PRU-11 (BAJO) — `autenticar` (sw.ts:48-73) tiene que tratar un HTTP
// no-2xx o un token nulo como clase 'auth' y NO llamar al endpoint de
// timbrado. Las 7 pruebas de `sw.test.ts` ejercitan esta rama solo a través
// del reintento con TOKEN CACHEADO (`401 con token cacheado…`): la mutación
// M19 (`if (!res.ok || token === null)` → `if (false)`) las pasa igual,
// porque esa cobertura de ramas (59.01%) nunca ejercita la PRIMERA
// autenticación — sin caché — con un HTTP de error real.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { crearProveedorSw, _limpiarTokenSw } from './sw';

const CFG = { urlBase: 'https://pac.prueba', usuario: 'demo', password: 'x' };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  _limpiarTokenSw();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('PRU-11: la autenticación (sin token en caché) trata un no-2xx como auth y NO timbra', () => {
  it('401 con {message} en la PRIMERA autenticación: clase auth, el mensaje del PAC, y NUNCA se llama a /issue', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Usuario o contraseña incorrectos.' }), { status: 401 }),
    );
    const r = await crearProveedorSw(CFG).timbrar('<cfdi/>');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.clase).toBe('auth');
    expect(r.mensaje).toBe('Usuario o contraseña incorrectos.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v2/security/authenticate');
  });

  it('200 sin data.token: clase auth (el HTTP fue "exitoso" pero no trajo credencial usable)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'success', data: {} }), { status: 200 }),
    );
    const r = await crearProveedorSw(CFG).timbrar('<cfdi/>');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.clase).toBe('auth');
    expect(r.mensaje).toContain('El PAC no entregó token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
