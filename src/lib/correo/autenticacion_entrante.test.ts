import { describe, expect, it } from 'vitest';
import { autenticacionDeRemitente } from './autenticacion_entrante';

const ar = (v: string) => [{ name: 'Authentication-Results', value: v }];

describe('autenticacionDeRemitente', () => {
  it('sin cabeceras o sin Authentication-Results: sin_informacion', () => {
    expect(autenticacionDeRemitente(undefined, 'b.test')).toBe('sin_informacion');
    expect(autenticacionDeRemitente([], 'b.test')).toBe('sin_informacion');
    expect(autenticacionDeRemitente({ Subject: 'x' }, 'b.test')).toBe('sin_informacion');
  });
  it('SPF o DKIM pasado y alineado: verificado', () => {
    expect(autenticacionDeRemitente(ar('mx.x.com; spf=pass smtp.mailfrom=b.test; dkim=fail header.d=otro.com'), 'b.test')).toBe('verificado');
    expect(autenticacionDeRemitente(ar('mx.x.com; spf=fail smtp.mailfrom=b.test; dkim=pass header.d=b.test'), 'b.test')).toBe('verificado');
    expect(autenticacionDeRemitente({ 'authentication-results': 'mx; dkim=pass header.d=b.test' }, 'b.test')).toBe('verificado');
  });
  it('fail en ambos, softfail o none: rechazado (falla cerrado)', () => {
    expect(autenticacionDeRemitente(ar('mx; spf=fail smtp.mailfrom=b.test; dkim=fail header.d=b.test'), 'b.test')).toBe('rechazado');
    expect(autenticacionDeRemitente(ar('mx; spf=softfail smtp.mailfrom=b.test; dkim=none'), 'b.test')).toBe('rechazado');
  });
  it('pasó, pero para otro dominio (no alineado con el From): rechazado', () => {
    expect(autenticacionDeRemitente(ar('mx; spf=pass smtp.mailfrom=atacante.com; dkim=pass header.d=atacante.com'), 'b.test')).toBe('rechazado');
  });
  it('cabecera ARC o ajena no cuenta', () => {
    expect(autenticacionDeRemitente([{ name: 'ARC-Authentication-Results', value: 'i=1; mx; spf=pass' }], 'b.test')).toBe('sin_informacion');
  });
});
