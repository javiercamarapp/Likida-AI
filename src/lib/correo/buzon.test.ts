import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generarToken, esTokenValido, direccionDe, tokenDeDireccion, tokenDeDestinatarios, dominioBuzon,
} from './buzon';

const original = process.env.RESEND_EMAIL_DOMAIN;
beforeEach(() => { process.env.RESEND_EMAIL_DOMAIN = 'mail.likida.ai'; });
afterEach(() => {
  if (original === undefined) delete process.env.RESEND_EMAIL_DOMAIN;
  else process.env.RESEND_EMAIL_DOMAIN = original;
});

const T = 'abcdefghjkmnpqrstvwxyz23';

describe('generarToken — la única credencial que separa a una flota de otra', () => {
  it('mide 24 y usa solo el alfabeto sin ambigüedades', () => {
    for (let i = 0; i < 50; i++) {
      const t = generarToken();
      expect(t).toHaveLength(24);
      expect(t).toMatch(/^[a-hjkmnp-tv-z2-9]{24}$/);
    }
  });

  it('NO usa caracteres que se transcriben mal al dictarlos', () => {
    // Un `0` que alguien escribe como `O` no rebota con error: el correo
    // simplemente nunca llega y nadie sabe por qué.
    const muestra = Array.from({ length: 200 }, () => generarToken()).join('');
    for (const malo of ['i', 'l', 'o', 'u', '0', '1']) {
      expect(muestra, `apareció "${malo}"`).not.toContain(malo);
    }
  });

  it('200 tokens seguidos son 200 distintos', () => {
    const s = new Set(Array.from({ length: 200 }, () => generarToken()));
    expect(s.size).toBe(200);
  });

  it('la distribución no se carga a los primeros caracteres del alfabeto', () => {
    // Tomar `byte % 30` sobre 256 valores haría que los primeros 16 salgan más
    // seguido. El rechazo por módulo lo evita.
    const cuenta = new Map<string, number>();
    const muestra = Array.from({ length: 400 }, () => generarToken()).join('');
    for (const c of muestra) cuenta.set(c, (cuenta.get(c) ?? 0) + 1);
    const valores = [...cuenta.values()];
    const prom = muestra.length / 30;
    // Ningún caracter debe salir más del doble del promedio.
    expect(Math.max(...valores)).toBeLessThan(prom * 2);
  });

  it('el que genera pasa su propia validación', () => {
    expect(esTokenValido(generarToken())).toBe(true);
  });
});

describe('esTokenValido', () => {
  it('rechaza corto, largo y con caracteres fuera del alfabeto', () => {
    expect(esTokenValido('abc')).toBe(false);
    expect(esTokenValido(T + 'x')).toBe(false);
    expect(esTokenValido('abcdefgh0jkmnpqrstvwxyz2')).toBe(false);
    expect(esTokenValido(T)).toBe(true);
  });
});

describe('direccionDe', () => {
  it('arma la dirección con el prefijo reconocible', () => {
    expect(direccionDe(T)).toBe(`f-${T}@mail.likida.ai`);
  });

  it('sin canal configurado NO inventa una dirección', () => {
    delete process.env.RESEND_EMAIL_DOMAIN;
    expect(direccionDe(T)).toBeNull();
    expect(dominioBuzon()).toBeNull();
  });

  it('un token inválido no produce dirección', () => {
    expect(direccionDe('corto')).toBeNull();
  });
});

describe('tokenDeDireccion — tolerante con la gente, estricto con el dominio', () => {
  it('lee la dirección tal cual', () => {
    expect(tokenDeDireccion(`f-${T}@mail.likida.ai`)).toBe(T);
  });

  it('aguanta MAYÚSCULAS: el correo no distingue caso y los clientes capitalizan', () => {
    expect(tokenDeDireccion(`F-${T.toUpperCase()}@MAIL.LIKIDA.AI`)).toBe(T);
  });

  it('aguanta el formato "Nombre <correo>" que llega en el `to` real', () => {
    expect(tokenDeDireccion(`Facturas Likida <f-${T}@mail.likida.ai>`)).toBe(T);
  });

  it('aguanta espacios de sobra', () => {
    expect(tokenDeDireccion(`  f-${T}@mail.likida.ai  `)).toBe(T);
  });

  it('descarta el sufijo +algo que agregan los servidores', () => {
    expect(tokenDeDireccion(`f-${T}+reenvio@mail.likida.ai`)).toBe(T);
  });

  it('OTRO DOMINIO no es nuestro, aunque traiga un token con forma buena', () => {
    // Es la línea que decide a qué flota entra un gasto: aquí no se rescata
    // nada.
    expect(tokenDeDireccion(`f-${T}@otro-dominio.com`)).toBeNull();
    expect(tokenDeDireccion(`f-${T}@mail.likida.ai.evil.com`)).toBeNull();
  });

  it('sin el prefijo, no es un buzón', () => {
    expect(tokenDeDireccion(`${T}@mail.likida.ai`)).toBeNull();
    expect(tokenDeDireccion('avisos@mail.likida.ai')).toBeNull();
  });

  it('basura no truena, devuelve null', () => {
    expect(tokenDeDireccion('')).toBeNull();
    expect(tokenDeDireccion('sin-arroba')).toBeNull();
  });
});

describe('tokenDeDestinatarios — un correo reenviado trae varias direcciones', () => {
  it('encuentra el buzón entre las demás', () => {
    expect(tokenDeDestinatarios([
      'contador@flota.com', `f-${T}@mail.likida.ai`, 'taller@proveedor.mx',
    ])).toBe(T);
  });

  it('el mismo buzón repetido (to y cc) sigue siendo uno', () => {
    expect(tokenDeDestinatarios([`f-${T}@mail.likida.ai`, `F-${T}@mail.likida.ai`])).toBe(T);
  });

  it('DOS buzones distintos → null: no se adivina a cuál flota iba', () => {
    const otro = 'zyxwvtsrqpnmkjhgfedcba32';
    expect(tokenDeDestinatarios([`f-${T}@mail.likida.ai`, `f-${otro}@mail.likida.ai`])).toBeNull();
  });

  it('sin ningún buzón → null', () => {
    expect(tokenDeDestinatarios(['a@b.com', 'c@d.com'])).toBeNull();
    expect(tokenDeDestinatarios([])).toBeNull();
  });
});
