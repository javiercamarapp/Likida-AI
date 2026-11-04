import { describe, expect, it } from 'vitest';
import {
  truncarRed, huellaDeRed, ipDeCabeceras, redDeCabeceras, uaSaneado, huellaCuenta, redactarDetalle,
} from './evento_red';

const SAL = 'sal-de-prueba-0123456789';

describe('truncarRed — la IP completa nunca se guarda', () => {
  it('IPv4 se corta a /24', () => {
    expect(truncarRed('203.0.113.77')).toBe('203.0.113.0/24');
  });
  it('IPv6 se corta a /48, también comprimida', () => {
    expect(truncarRed('2001:db8:abcd:1234::1')).toBe('2001:db8:abcd::/48');
    expect(truncarRed('2001:0db8:abcd:0012:0000:0000:0000:0001')).toBe('2001:db8:abcd::/48');
  });
  it('IPv4 mapeada en IPv6 se trata como IPv4', () => {
    expect(truncarRed('::ffff:203.0.113.77')).toBe('203.0.113.0/24');
  });
  it('basura, vacío y «desconocida» no producen red', () => {
    for (const x of ['', 'desconocida', 'no-es-ip', '999.1.1.1', '1.2.3', null, undefined]) expect(truncarRed(x as string)).toBeNull();
  });
});

describe('huellaDeRed — HMAC con sal sobre la red truncada', () => {
  it('32 hex, estable dentro de la misma /24 y distinta en otra', () => {
    const a = huellaDeRed('203.0.113.5', SAL);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(huellaDeRed('203.0.113.200', SAL)).toBe(a);
    expect(huellaDeRed('203.0.114.5', SAL)).not.toBe(a);
  });
  it('la sal cambia la huella y la huella no contiene la IP', () => {
    const a = huellaDeRed('203.0.113.5', SAL)!;
    expect(huellaDeRed('203.0.113.5', SAL + 'x')).not.toBe(a);
    expect(a).not.toContain('203');
  });
  it('SIN sal no se inventa una huella: null', () => {
    expect(huellaDeRed('203.0.113.5', '')).toBeNull();
    expect(huellaDeRed('203.0.113.5', undefined)).toBeNull();
  });
  it('lee la sal de SEGURIDAD_SAL_RED por omisión', () => {
    const antes = process.env.SEGURIDAD_SAL_RED;
    try {
      process.env.SEGURIDAD_SAL_RED = SAL;
      expect(huellaDeRed('203.0.113.5')).toBe(huellaDeRed('203.0.113.5', SAL));
      delete process.env.SEGURIDAD_SAL_RED;
      expect(huellaDeRed('203.0.113.5')).toBeNull();
    } finally {
      if (antes === undefined) delete process.env.SEGURIDAD_SAL_RED; else process.env.SEGURIDAD_SAL_RED = antes;
    }
  });
  it('una sal demasiado corta no cuenta como sal', () => {
    expect(huellaDeRed('203.0.113.5', 'abc')).toBeNull();
  });
});

describe('ipDeCabeceras / redDeCabeceras', () => {
  it('prefiere la cabecera de Vercel, luego x-real-ip, luego el primer x-forwarded-for', () => {
    expect(ipDeCabeceras(new Headers({ 'x-vercel-forwarded-for': '1.1.1.1', 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3, 4.4.4.4' }))).toBe('1.1.1.1');
    expect(ipDeCabeceras(new Headers({ 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3' }))).toBe('2.2.2.2');
    expect(ipDeCabeceras(new Headers({ 'x-forwarded-for': ' 3.3.3.3 , 4.4.4.4' }))).toBe('3.3.3.3');
    expect(ipDeCabeceras(new Headers())).toBeNull();
  });
  it('arma huella y user-agent saneado', () => {
    const r = redDeCabeceras(new Headers({ 'x-real-ip': '203.0.113.5', 'user-agent': 'curl/8.0' }), SAL);
    expect(r).toEqual({ ipHash: huellaDeRed('203.0.113.5', SAL), ua: 'curl/8.0' });
  });
  it('sin sal: ua sí, huella null', () => {
    expect(redDeCabeceras(new Headers({ 'x-real-ip': '203.0.113.5', 'user-agent': 'curl/8.0' }), '')).toEqual({ ipHash: null, ua: 'curl/8.0' });
  });
});

describe('uaSaneado', () => {
  it('quita caracteres de control y recorta a 200', () => {
    expect(uaSaneado('a\u0001b\nc')).toBe('abc');
    expect(uaSaneado('x'.repeat(500))!.length).toBe(200);
    expect(uaSaneado('   ')).toBeNull();
    expect(uaSaneado(null)).toBeNull();
  });
});

describe('huellaCuenta — el actor de un login fallido no es el correo', () => {
  it('con sal: huella estable que no contiene el correo, insensible a mayúsculas', () => {
    const a = huellaCuenta('Juan.Perez@Empresa.com', SAL);
    expect(a).toMatch(/^cuenta:[0-9a-f]{12}$/);
    expect(huellaCuenta(' juan.perez@empresa.com ', SAL)).toBe(a);
    expect(a).not.toMatch(/juan|empresa/i);
  });
  it('sin sal: solo el dominio, jamás la parte local', () => {
    expect(huellaCuenta('juan.perez@empresa.com', '')).toBe('cuenta:@empresa.com');
    expect(huellaCuenta('no-es-correo', '')).toBe('cuenta:desconocida');
  });
});

describe('redactarDetalle — PII fuera', () => {
  it('redacta correos, teléfonos y llaves sensibles, y acota tamaño', () => {
    const r = redactarDetalle({
      email: 'a@b.com', nota: 'escribe a juan@x.com o al 5512345678', token: 'abc', authorization: 'Bearer zzz',
      largo: 'y'.repeat(900), n: 3, anidado: { cookie: 'k', ok: 'bien' },
    })!;
    expect(r.email).toBe('[EMAIL]');
    expect(String(r.nota)).not.toContain('juan@x.com');
    expect(String(r.nota)).not.toContain('5512345678');
    expect(r.token).toBe('[redactado]');
    expect(r.authorization).toBe('[redactado]');
    expect((r.largo as string).length).toBeLessThanOrEqual(300);
    expect(r.n).toBe(3);
    expect(r.anidado).toEqual({ cookie: '[redactado]', ok: 'bien' });
  });
  it('conserva los UUID (identificadores internos) y redacta lo personal junto a ellos', () => {
    const id = '0b5c1c9e-6f1e-4c7a-9a55-2f4e7d1a8b30';
    const r = redactarDetalle({ viajeId: id, nota: `viaje ${id} de juan@x.com` })!;
    expect(r.viajeId).toBe(id);
    expect(r.nota).toBe(`viaje ${id} de [EMAIL]`);
  });
  it('undefined y no-objetos', () => {
    expect(redactarDetalle(undefined)).toBeUndefined();
  });
  it('no lanza con ciclos', () => {
    const a: Record<string, unknown> = {}; a.a = a;
    expect(() => redactarDetalle(a)).not.toThrow();
  });
});
