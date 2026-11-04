import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { firmarCorreoCookie, leerCorreoCookie } from './cookie_correo_firmada';

const ENV = { ...process.env };
beforeEach(() => {
  delete process.env.CORREO_ENLACE_SECRET;
  delete process.env.SUPABASE_AUTH_HOOK_SECRET;
  process.env.CRON_SECRET = 'secreto-de-prueba-largo';
});
afterEach(() => { process.env = { ...ENV }; });

describe('cookie likida_correo_enlace firmada (CT-SEG-14)', () => {
  it('ida y vuelta: el correo emitido por el servidor se lee igual', () => {
    const v = firmarCorreoCookie('ana@empresa.mx', 3600)!;
    expect(leerCorreoCookie(v)).toBe('ana@empresa.mx');
  });
  it('el correo en claro que fija un atacante a mano NO vale', () => {
    expect(leerCorreoCookie('victima@x.com')).toBe('');
    expect(leerCorreoCookie(encodeURIComponent('victima@x.com'))).toBe('');
  });
  it('cambiar el correo conservando la firma NO vale', () => {
    const v = firmarCorreoCookie('ana@empresa.mx', 3600)!.split('.');
    v[1] = encodeURIComponent('victima@x.com').replace(/\./g, '%2E');
    expect(leerCorreoCookie(v.join('.'))).toBe('');
  });
  it('extender el vencimiento NO vale', () => {
    const v = firmarCorreoCookie('ana@empresa.mx', 10)!.split('.');
    v[2] = String(Number(v[2]) + 99999);
    expect(leerCorreoCookie(v.join('.'))).toBe('');
  });
  it('una cookie vencida NO vale', () => {
    const v = firmarCorreoCookie('ana@empresa.mx', 60, 1_000_000)!;
    expect(leerCorreoCookie(v, 1_000_000 + 61_000)).toBe('');
    expect(leerCorreoCookie(v, 1_000_000 + 30_000)).toBe('ana@empresa.mx');
  });
  it('firmada con otro secreto NO vale', () => {
    const v = firmarCorreoCookie('ana@empresa.mx', 3600)!;
    process.env.CRON_SECRET = 'otro-secreto-distinto';
    expect(leerCorreoCookie(v)).toBe('');
  });
  it('sin ningun secreto no se emite ni se acepta (falla cerrado)', () => {
    delete process.env.CRON_SECRET;
    expect(firmarCorreoCookie('ana@empresa.mx', 3600)).toBeNull();
    expect(leerCorreoCookie('v1.a.1.b')).toBe('');
  });
  it('basura no lanza', () => {
    for (const x of ['', 'v1', 'v1....', 'v1.%%%.9999999999999.zz', undefined]) {
      expect(() => leerCorreoCookie(x)).not.toThrow();
    }
  });
});
