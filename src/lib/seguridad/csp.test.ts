import { describe, it, expect } from 'vitest';
import { construirCsp, nonceActivo, nuevoNonce, HASH_SCRIPT_TEMA } from './csp';

describe('construirCsp', () => {
  it('sin nonce es la política pública de siempre (unsafe-inline), con las 11 directivas', () => {
    const csp = construirCsp(null, false);
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp.split('; ')).toHaveLength(12);
    expect(csp).not.toContain('strict-dynamic');
  });

  it('con nonce: nonce + hash del tema + strict-dynamic y NINGÚN unsafe-inline en script-src', () => {
    const csp = construirCsp('AAAAAAAAAAAAAAAAAAAAAA==', false);
    const src = csp.split('; ').find((d) => d.startsWith('script-src'));
    expect(src).toBe(`script-src 'self' 'nonce-AAAAAAAAAAAAAAAAAAAAAA==' ${HASH_SCRIPT_TEMA} 'strict-dynamic'`);
    // style-src conserva unsafe-inline a propósito (atributos style={{…}}); no es script-src.
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it('unsafe-eval solo con dev=true', () => {
    expect(construirCsp('x', true)).toContain("'unsafe-eval'");
    expect(construirCsp('x', false)).not.toContain('unsafe-eval');
    expect(construirCsp(null, true)).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
  });
});

describe('nuevoNonce', () => {
  it('es base64 válido de 16 bytes y distinto cada vez', () => {
    const a = nuevoNonce();
    const b = nuevoNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(Buffer.from(a, 'base64')).toHaveLength(16);
    expect(a).not.toBe(b);
  });

  it('cabe en lo que Next acepta como nonce (get-script-nonce-from-header)', () => {
    expect(`'nonce-${nuevoNonce()}'`).toMatch(/^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/);
  });
});

describe('nonceActivo', () => {
  it('solo LIKIDA_CSP_NONCE=0 lo apaga', () => {
    expect(nonceActivo({})).toBe(true);
    expect(nonceActivo({ LIKIDA_CSP_NONCE: '1' })).toBe(true);
    expect(nonceActivo({ LIKIDA_CSP_NONCE: '' })).toBe(true);
    expect(nonceActivo({ LIKIDA_CSP_NONCE: '0' })).toBe(false);
  });
});
