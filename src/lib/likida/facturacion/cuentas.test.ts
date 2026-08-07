import { describe, it, expect } from 'vitest';
import { COMERCIOS } from './comercios';

// ═══════════════════════════════════════════════════════════════════════════
// CUÁNTOS PORTALES EXIGEN CUENTA — el dato que decide la arquitectura.
//
// El encabezado de `comercios.ts` afirmaba "42 de 60 exigen crear cuenta", y
// estaba INVERTIDO: 42/60 es 70%, que es la proporción de los que NO la exigen.
// Javier lo cazó por conocimiento de campo el 4-ago-2026 y el propio registro le
// dio la razón — nadie lo había contado contra los datos.
//
// No es trivia: si el 70% exigiera cuenta, automatizar la autofacturación sería
// administrar contraseñas en 42 portales por flota, y la ruta correcta sería
// mandarle los datos a una persona. Como es al revés, la mayoría se factura con
// lo que ya se leyó del ticket.
//
// Esta prueba existe para que la cifra del comentario no vuelva a divergir de la
// tabla que tiene debajo.
// ═══════════════════════════════════════════════════════════════════════════

describe('cuántos comercios exigen cuenta', () => {
  const conCuenta = COMERCIOS.filter((c) => c.requiereCuenta);

  it('la MAYORÍA se factura sin crear cuenta', () => {
    expect(conCuenta.length / COMERCIOS.length).toBeLessThan(0.5);
  });

  it('los que la exigen son sobre todo de peaje', () => {
    // El peaje no se factura ticket por ticket: el TAG factura mensual contra la
    // cuenta. Por eso concentra los casos con cuenta y por eso, entre lo que un
    // chofer fotografía, la proporción sin cuenta es aún mayor.
    const peaje = conCuenta.filter((c) => /peaje|autopista|iave|pase|telev|pinfra|carretera/i.test(`${c.nombre} ${c.clave}`));
    expect(peaje.length).toBeGreaterThanOrEqual(conCuenta.length / 2);
  });

  it('el encabezado AFIRMA el hecho correcto, no el invertido', async () => {
    // Se comprueba lo que el comentario AFIRMA, no que la frase vieja no
    // aparezca: la corrección la cita a propósito para dejar el rastro del
    // error. Lo que no puede volver es la afirmación en forma de viñeta.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('./comercios.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/LA MAYOR[ÍI]A NO EXIGE CUENTA/);
    expect(src).not.toMatch(/^\/\/\s+- 42 de 60 exigen/m);
  });
});
