import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { accessToken, tokenMatches, hayPasscode, motivoPasscodeDebil, SESION_MAX_MS } from './passcode';

// Un passcode que cumple las tres reglas: 24 caracteres, sin palabra
// predecible, 24 caracteres distintos.
const FUERTE = 'x7Kq2Mv9Rb4Tz8Wn3Ld6Hs5Y';

const env = { ...process.env };
beforeEach(() => {
  process.env.DASHBOARD_PASSCODE = FUERTE;
  process.env.DASHBOARD_SECRET = 'secreto-de-prueba';
});
afterEach(() => {
  process.env = { ...env };
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('passcode (HMAC)', () => {
  it('el token NO es reversible (no contiene el passcode ni su base64)', async () => {
    const t = await accessToken(FUERTE);
    expect(t).not.toContain(FUERTE);
    expect(t).not.toContain(Buffer.from(FUERTE).toString('base64'));
    expect(t).toMatch(/^2\.[0-9a-z]+\.[0-9a-f]{32}\.[0-9a-f]{64}$/);
  });

  it('tokenMatches acepta el token correcto y rechaza el resto', async () => {
    const t = await accessToken(FUERTE);
    expect(await tokenMatches(t)).toBe(true);
    expect(await tokenMatches('deadbeef')).toBe(false);
    expect(await tokenMatches(undefined)).toBe(false);
    expect(await tokenMatches(await accessToken('otro-passcode-distinto-x9'))).toBe(false);
  });

  it('hayPasscode distingue dev de producción-con-candado', () => {
    expect(hayPasscode()).toBe(true);
    delete process.env.DASHBOARD_PASSCODE;
    expect(hayPasscode()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LA COOKIE ERA UNA LLAVE MAESTRA ETERNA.
//
// `accessToken` era `HMAC("likida-access:" + passcode)`: el MISMO valor para
// todos los usuarios, desde cualquier IP, para siempre. El `maxAge: 60*60*8` de
// `/acceso` es una pista para el navegador, no una expiración de servidor —
// `tokenMatches` aceptaba un valor copiado de las devtools hace un año.
//
// Estos casos fijan las tres propiedades nuevas: cada entrada es una sesión
// distinta, la sesión caduca en el servidor, y el formato viejo ya no entra.
// ═══════════════════════════════════════════════════════════════════════════
describe('la sesión es una sesión, no una llave maestra', () => {
  it('dos entradas con el MISMO passcode dan cookies distintas', async () => {
    const a = await accessToken(FUERTE);
    const b = await accessToken(FUERTE);
    expect(a).not.toBe(b);
    // …y las dos valen: no es que una invalide a la otra, es que una filtrada
    // no delata a la otra.
    expect(await tokenMatches(a)).toBe(true);
    expect(await tokenMatches(b)).toBe(true);
  });

  it('a las 8 horas la cookie deja de entrar, la conserve o no el navegador', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T10:00:00Z'));
    const t = await accessToken(FUERTE);

    vi.setSystemTime(new Date('2026-08-06T10:00:00Z').getTime() + SESION_MAX_MS - 60_000);
    expect(await tokenMatches(t)).toBe(true);

    vi.setSystemTime(new Date('2026-08-06T10:00:00Z').getTime() + SESION_MAX_MS + 60_000);
    expect(await tokenMatches(t)).toBe(false);
  });

  it('una cookie con fecha del futuro tampoco entra', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T10:00:00Z'));
    const t = await accessToken(FUERTE);
    // Más allá de la tolerancia de reloj entre instancias (5 min).
    vi.setSystemTime(new Date('2026-08-06T09:50:00Z'));
    expect(await tokenMatches(t)).toBe(false);
  });

  it('el formato viejo —64 hex determinista— ya no vale', async () => {
    // Es exactamente lo que había en la cookie de producción hasta la
    // auditoría 5: HMAC-SHA256 crudo, sin hora ni nonce. Reconstruirlo con el
    // secreto correcto no basta.
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode('secreto-de-prueba'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`likida-access:${FUERTE}`));
    const viejo = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');

    expect(viejo).toHaveLength(64);
    expect(await tokenMatches(viejo)).toBe(false);
  });

  it('no se puede alargar una sesión moviéndole la hora: la firma la cubre', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T10:00:00Z'));
    const t = await accessToken(FUERTE);
    const [v, , nonce, hmac] = t.split('.');

    // Mañana, con la misma firma y una hora de emisión recién puesta.
    vi.setSystemTime(new Date('2026-08-07T10:00:00Z'));
    const falsificado = `${v}.${Date.now().toString(36)}.${nonce}.${hmac}`;
    expect(await tokenMatches(falsificado)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL PASSCODE ERA ADIVINABLE, Y EL RATE-LIMIT NO LO TAPA.
//
// `DASHBOARD_PASSCODE=likida-demo-2026` es `<marca>-demo-<año>`. El límite de
// 10 intentos / 5 min vive en un Map en memoria POR INSTANCIA (ratelimit.ts:7),
// así que el techo real es 10 × instancias, no 10. La única defensa que no
// depende de estado compartido es que el valor no esté en ninguna lista.
// ═══════════════════════════════════════════════════════════════════════════
describe('fuerza del passcode', () => {
  it('el passcode que hoy está en producción NO pasa', () => {
    expect(motivoPasscodeDebil('likida-demo-2026')).not.toBeNull();
  });

  it('los candidatos obvios tampoco', () => {
    for (const p of [
      'likida', 'likida2026', 'demo', 'likida-demo', 'Likida.Demo.2026',
      'LIKIDADEMO2026', 'cuadra-panel-acceso-2026', 'passwordpasswordpassword',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'qwertyqwertyqwertyqwerty',
    ]) {
      expect(motivoPasscodeDebil(p), p).not.toBeNull();
    }
  });

  it('un valor aleatorio de 24 sí pasa', () => {
    expect(motivoPasscodeDebil(FUERTE)).toBeNull();
  });

  it('un passcode igual al secreto de servidor no pasa', () => {
    process.env.DASHBOARD_SECRET = FUERTE;
    expect(motivoPasscodeDebil(FUERTE)).not.toBeNull();
  });

  it('en producción, un passcode adivinable falla RUIDOSO en las dos capas', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DASHBOARD_PASSCODE', 'likida-demo-2026');
    vi.stubEnv('DASHBOARD_SECRET', 'un-secreto-de-servidor-largo');
    await expect(accessToken('likida-demo-2026')).rejects.toThrow(/adivinable/);
    await expect(tokenMatches('lo-que-sea')).rejects.toThrow(/adivinable/);
    expect(() => hayPasscode()).toThrow(/adivinable/);
  });

  it('en desarrollo no estorba: el passcode de siempre sigue sirviendo', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DASHBOARD_PASSCODE', 'likida-demo-2026');
    vi.stubEnv('DASHBOARD_SECRET', 'un-secreto-de-servidor-largo');
    const t = await accessToken('likida-demo-2026');
    expect(await tokenMatches(t)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SIN DASHBOARD_SECRET, EL CANDADO SE ABRE SOLO.
//
// `secret()` caía a `likida:${DASHBOARD_PASSCODE}` cuando faltaba
// DASHBOARD_SECRET. O sea: la cookie es HMAC(passcode) con una clave DERIVADA
// del propio passcode. Quien capture UNA cookie puede probar candidatos offline
// —sin tocar /acceso y sin su rate-limit— hasta dar con el passcode, y entrar
// por el formulario normal indefinidamente.
//
// En producción se falla RUIDOSO. Un candado que parece cerrado y no lo está es
// peor que uno que avisa que no está puesto.
// ═══════════════════════════════════════════════════════════════════════════
describe('secreto del HMAC', () => {
  it('en producción, sin DASHBOARD_SECRET, falla ruidoso', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.DASHBOARD_SECRET;
    vi.stubEnv('DASHBOARD_PASSCODE', FUERTE);
    await expect(accessToken(FUERTE)).rejects.toThrow(/DASHBOARD_SECRET/);
  });

  it('en producción CON el secreto, funciona normal', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DASHBOARD_SECRET', 'un-secreto-de-servidor-largo');
    vi.stubEnv('DASHBOARD_PASSCODE', FUERTE);
    const t = await accessToken(FUERTE);
    expect(await tokenMatches(t)).toBe(true);
  });

  it('en desarrollo sigue funcionando sin secreto: no estorba el día a día', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    delete process.env.DASHBOARD_SECRET;
    vi.stubEnv('DASHBOARD_PASSCODE', 'dev');
    await expect(accessToken('dev')).resolves.toMatch(/^2\./);
  });

  it('rotar el secreto revoca las sesiones vivas SIN cambiar el passcode', async () => {
    // Es la palanca que faltaba: después del demo, quien vio el código en la
    // sala se queda fuera y quien sí debe entrar no tiene que aprenderse otro.
    const t = await accessToken(FUERTE);
    expect(await tokenMatches(t)).toBe(true);
    process.env.DASHBOARD_SECRET = 'secreto-rotado-despues-del-demo';
    expect(await tokenMatches(t)).toBe(false);
    // Y el passcode de siempre sigue emitiendo sesiones nuevas.
    expect(await tokenMatches(await accessToken(FUERTE))).toBe(true);
  });
});
