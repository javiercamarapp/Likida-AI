// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 48 · A48-SEG-01 — EL `pass` CUYO DOMINIO NO SE SABE LEER PASABA
// COMO ALINEADO.
//
// `metodosDe` solo reconocía `smtp.mailfrom`, `header.d`, `header.i` y
// `header.from`. Varios MTA entregan el dominio del sobre en `envelope-from=`
// (la misma clave que usa `Received-SPF`), y entonces el método quedaba con
// `dominio: null` — y `alineado(null)` devuelve `true` a propósito, «sin dominio
// declarado no hay con qué comparar».
//
// El resultado no era un hueco teórico: con la MISMA suplantación, un resultado
// con formato Google (que trae `smtp.mailfrom=`) se rechazaba y uno con el
// dominio en `envelope-from=` se daba por VERIFICADO. La política de alineación
// del módulo dependía de cómo escribiera la clave el proveedor.
//
// Esto NO cambia la política declarada en `alineado()` —un `pass` sin dominio
// legible se sigue aceptando—: cierra el caso en que el dominio SÍ venía y el
// parser no lo leía.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { autenticacionDeRemitente } from './autenticacion_entrante';

const cab = (valor: string) => [{ name: 'Authentication-Results', value: valor }];

describe('A48-SEG-01 · el dominio del sobre se lee también en `envelope-from=`', () => {
  // CONTROL: la misma suplantación con la clave que el módulo ya leía.
  it('con `smtp.mailfrom` de otro dominio se rechaza (comportamiento de referencia)', () => {
    expect(autenticacionDeRemitente(
      cab('mx.google.com; spf=pass smtp.mailfrom=rebote@atacante.test; dkim=pass header.i=@atacante.test'),
      'proveedor-peaje.test',
    )).toBe('rechazado');
  });

  // EL HALLAZGO: misma suplantación, el dominio en `envelope-from=`.
  it('con `envelope-from` de otro dominio se rechaza igual', () => {
    expect(autenticacionDeRemitente(
      cab('amazonses.com; spf=pass (amazonses.com: domain of rebote@atacante.test) envelope-from=rebote@atacante.test; dkim=pass header.i=@atacante.test'),
      'proveedor-peaje.test',
    )).toBe('rechazado');
  });

  it('solo SPF, con `envelope-from` de otro dominio: se rechaza', () => {
    expect(autenticacionDeRemitente(
      cab('amazonses.com; spf=pass envelope-from=rebote@atacante.test'),
      'proveedor-peaje.test',
    )).toBe('rechazado');
  });

  // Y lo que NO se puede romper: el remitente legítimo sigue entrando. El
  // dominio del sobre de un proveedor real es un subdominio del suyo.
  it('el proveedor legítimo con su subdominio de rebotes sigue verificado', () => {
    expect(autenticacionDeRemitente(
      cab('amazonses.com; spf=pass envelope-from=bounce@mail.proveedor-peaje.test'),
      'proveedor-peaje.test',
    )).toBe('verificado');
  });

  it('un `pass` sin dominio legible se sigue aceptando (política declarada, sin cambio)', () => {
    expect(autenticacionDeRemitente(cab('mx; spf=pass'), 'proveedor-peaje.test')).toBe('verificado');
  });
});
