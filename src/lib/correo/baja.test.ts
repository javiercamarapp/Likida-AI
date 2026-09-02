import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { bajaSecretoConfigurado, firmarBaja, verificarBaja, urlBaja } from './baja';

// ═══════════════════════════════════════════════════════════════════════════
// LA LIGA DE BAJA DE UN CLIC (0266) — el HMAC que `cola.ts` exige antes de
// mandar cualquier campaña. Lo que se fija:
//
//  · sin secreto no hay token (nunca uno que PAREZCA válido);
//  · el mismo correo siempre firma igual (la liga no caduca);
//  · un token de otro correo, o tocado un carácter, no verifica;
//  · mayúsculas/espacios no cambian la identidad del correo firmado.
// ═══════════════════════════════════════════════════════════════════════════

const envAntes = process.env.LIKIDA_BAJA_SECRET;
beforeEach(() => { process.env.LIKIDA_BAJA_SECRET = 'secreto-de-prueba-suficientemente-largo'; });
afterEach(() => {
  if (envAntes === undefined) delete process.env.LIKIDA_BAJA_SECRET;
  else process.env.LIKIDA_BAJA_SECRET = envAntes;
});

describe('sin secreto configurado, no hay liga — nunca una que parezca válida', () => {
  it('bajaSecretoConfigurado dice la verdad', () => {
    delete process.env.LIKIDA_BAJA_SECRET;
    expect(bajaSecretoConfigurado()).toBe(false);
    process.env.LIKIDA_BAJA_SECRET = 'x';
    expect(bajaSecretoConfigurado()).toBe(true);
  });

  it('firmarBaja y urlBaja devuelven null, jamás un token falso', () => {
    delete process.env.LIKIDA_BAJA_SECRET;
    expect(firmarBaja('a@b.mx')).toBeNull();
    expect(urlBaja('a@b.mx')).toBeNull();
  });

  it('un secreto vacío o solo espacios cuenta como no configurado', () => {
    process.env.LIKIDA_BAJA_SECRET = '   ';
    expect(bajaSecretoConfigurado()).toBe(false);
    expect(firmarBaja('a@b.mx')).toBeNull();
  });

  it('verificarBaja sin secreto siempre es false, aunque el token "cuadre" con el vacío', () => {
    delete process.env.LIKIDA_BAJA_SECRET;
    expect(verificarBaja('a@b.mx', '')).toBe(false);
    expect(verificarBaja('a@b.mx', 'cualquier-cosa')).toBe(false);
  });
});

describe('firmar y verificar — el contrato del token', () => {
  it('el mismo correo firma SIEMPRE igual — la liga no puede caducar', () => {
    expect(firmarBaja('prospecto@flota.mx')).toBe(firmarBaja('prospecto@flota.mx'));
  });

  it('mayúsculas y espacios no cambian la identidad firmada', () => {
    const token = firmarBaja('Prospecto@Flota.MX');
    expect(verificarBaja('  prospecto@flota.mx  ', token!)).toBe(true);
  });

  it('un token de OTRO correo no verifica', () => {
    const token = firmarBaja('uno@x.mx');
    expect(verificarBaja('otro@x.mx', token!)).toBe(false);
  });

  it('un carácter tocado en el token invalida la firma', () => {
    const token = firmarBaja('prospecto@flota.mx')!;
    const alterado = token.slice(0, -1) + (token.at(-1) === 'a' ? 'b' : 'a');
    expect(verificarBaja('prospecto@flota.mx', alterado)).toBe(false);
  });

  it('un token de otro largo no truena — false, no una excepción', () => {
    expect(() => verificarBaja('prospecto@flota.mx', 'corto')).not.toThrow();
    expect(verificarBaja('prospecto@flota.mx', 'corto')).toBe(false);
  });

  it('un secreto DISTINTO invalida todos los tokens previos (rotación honesta)', () => {
    const token = firmarBaja('prospecto@flota.mx')!;
    process.env.LIKIDA_BAJA_SECRET = 'otro-secreto-completamente-distinto';
    expect(verificarBaja('prospecto@flota.mx', token)).toBe(false);
  });
});

describe('urlBaja — la liga completa, lista para el correo y para List-Unsubscribe', () => {
  it('trae el correo y el token como query params verificables', () => {
    const url = urlBaja('Prospecto@Flota.MX')!;
    const u = new URL(url);
    expect(u.pathname).toBe('/api/correo/baja');
    expect(u.searchParams.get('e')).toBe('prospecto@flota.mx');
    expect(verificarBaja(u.searchParams.get('e')!, u.searchParams.get('t')!)).toBe(true);
  });
});
