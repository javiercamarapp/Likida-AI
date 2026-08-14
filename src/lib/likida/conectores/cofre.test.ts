import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cifrar, descifrar, pistasDe, cofreConfigurado } from './cofre';
import type { CampoCredencial } from './tipos';

const LLAVE = 'una-llave-de-pruebas-suficientemente-larga-1234';
const original = process.env.LIKIDA_COFRE_LLAVE;
beforeEach(() => { process.env.LIKIDA_COFRE_LLAVE = LLAVE; });
afterEach(() => {
  if (original === undefined) delete process.env.LIKIDA_COFRE_LLAVE;
  else process.env.LIKIDA_COFRE_LLAVE = original;
});

const campo = (clave: string, forma: CampoCredencial['forma']): CampoCredencial => ({
  clave, rotulo: clave, forma, requerida: true, ayuda: 'x',
});

describe('el cofre oculta y devuelve', () => {
  it('lo que entra es lo que sale', () => {
    const v = { host: 'sap.cliente.mx', usuario: 'likida', password: 'S3cr3t0-largo-de-verdad' };
    expect(descifrar(cifrar(v))).toEqual(v);
  });

  it('lo guardado NO contiene el secreto en claro', () => {
    const g = cifrar({ password: 'S3cr3t0-largo-de-verdad', host: 'sap.cliente.mx' });
    expect(g).not.toContain('S3cr3t0');
    expect(g).not.toContain('sap.cliente.mx');
  });

  it('NO empieza con "{" — el CHECK de la mig. 0094 lo rechazaría', () => {
    // Es el candado que impide guardar un JSON en claro por descuido.
    expect(cifrar({ a: 'b' })).not.toMatch(/^\s*\{/);
    expect(cifrar({ a: 'b' })).toMatch(/^v1\./);
  });

  it('el IV es NUEVO en cada guardado: dos cifrados del mismo valor difieren', () => {
    // Reusar el IV con la misma llave rompe GCM por completo: deja recuperar el
    // texto plano de dos mensajes.
    const a = cifrar({ x: 'igual' });
    const b = cifrar({ x: 'igual' });
    expect(a).not.toBe(b);
    expect(descifrar(a)).toEqual(descifrar(b));
  });

  it('aguanta acentos y eñes', () => {
    const v = { usuario: 'josé.muñoz', nota: 'contraseña con ñ y é' };
    expect(descifrar(cifrar(v))).toEqual(v);
  });
});

describe('GCM detecta alteraciones — por eso no es CBC', () => {
  it('un bit cambiado en el cifrado LANZA en vez de devolver basura', () => {
    // Con CBC, un atacante con escritura en la tabla voltea bits y el
    // descifrado devuelve basura SIN AVISAR — y esa basura terminaría
    // intentando autenticarse contra el SAP del cliente.
    const g = cifrar({ password: 'original-largo' });
    const partes = g.split('.');
    const buf = Buffer.from(partes[3], 'base64url');
    buf[0] = buf[0] ^ 0xff;
    partes[3] = buf.toString('base64url');
    expect(() => descifrar(partes.join('.'))).toThrow();
  });

  it('un tag de autenticación alterado también LANZA', () => {
    const g = cifrar({ password: 'original-largo' });
    const partes = g.split('.');
    const buf = Buffer.from(partes[2], 'base64url');
    buf[0] = buf[0] ^ 0xff;
    partes[2] = buf.toString('base64url');
    expect(() => descifrar(partes.join('.'))).toThrow();
  });

  it('con OTRA llave no se puede abrir', () => {
    const g = cifrar({ password: 'original-largo' });
    process.env.LIKIDA_COFRE_LLAVE = 'otra-llave-completamente-distinta-y-larga';
    expect(() => descifrar(g)).toThrow();
  });

  it('un formato desconocido se rechaza en vez de intentar adivinar', () => {
    expect(() => descifrar('basura')).toThrow(/formato del cofre/);
    expect(() => descifrar('v9.a.b.c')).toThrow(/formato del cofre/);
  });
});

describe('sin llave NO se guarda en claro — se falla', () => {
  it('cifrar LANZA si falta la variable', () => {
    // El modo de falla aceptable es "no se puede guardar la credencial", no
    // "se guardó donde cualquiera puede leerla".
    delete process.env.LIKIDA_COFRE_LLAVE;
    expect(() => cifrar({ a: 'b' })).toThrow(/LIKIDA_COFRE_LLAVE/);
  });

  it('una llave demasiado corta también se rechaza', () => {
    process.env.LIKIDA_COFRE_LLAVE = 'corta';
    expect(() => cifrar({ a: 'b' })).toThrow(/32 caracteres/);
  });

  it('cofreConfigurado dice la verdad, para que la pantalla no ofrezca un formulario que truena', () => {
    expect(cofreConfigurado()).toBe(true);
    delete process.env.LIKIDA_COFRE_LLAVE;
    expect(cofreConfigurado()).toBe(false);
  });
});

describe('las pistas reconocen sin permitir usar', () => {
  const campos = [campo('host', 'texto'), campo('usuario', 'texto'), campo('password', 'secreto')];

  it('los NO secretos van en claro: sin ellos nadie reconoce cuál credencial es', () => {
    const p = pistasDe(campos, { host: 'sap.cliente.mx', usuario: 'likida', password: 'S3cr3t0-largo' });
    expect(p.host).toBe('sap.cliente.mx');
    expect(p.usuario).toBe('likida');
  });

  it('de un secreto solo salen los últimos 4, marcados como recorte', () => {
    const p = pistasDe(campos, { password: 'S3cr3t0-largo-abcd' });
    expect(p.password).toBe('…abcd');
    expect(p.password).not.toContain('S3cr3t0');
  });

  it('un secreto CORTO se tapa entero: enseñar 4 de 6 sería regalar dos tercios', () => {
    expect(pistasDe(campos, { password: 'abc123' }).password).toBe('…');
  });

  it('un campo vacío o ausente no genera pista', () => {
    const p = pistasDe(campos, { host: '', usuario: 'likida' });
    expect(p.host).toBeUndefined();
    expect(p.password).toBeUndefined();
    expect(p.usuario).toBe('likida');
  });
});
