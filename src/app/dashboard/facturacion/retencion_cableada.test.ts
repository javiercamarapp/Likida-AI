import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 32, CONTINUACIÓN 13 · FIS-32C13-C1 (CRÍTICO).
//
// `carta_porte_cfdi.ts:199-201` TIMBRA la retención del 4 % de IVA cuando el
// receptor es persona moral (RFC de 12 caracteres) y descuenta esa retención
// del Total del CFDI. `factura_emitida.retencion_iva` existe desde la 0352.
// `validarFactura` (`facturacion_escritura.ts:158`) ya la sabe leer.
//
// Lo que NO existía era el cable: el formulario de «factura emitida» sólo
// tenía Subtotal e IVA —y su texto de ayuda afirmaba «el total lo calculamos
// nosotros: subtotal + IVA, sin oportunidad de descuadre»— y la server action
// llamaba a `validarFactura` SIN pasar `retencion`, así que el único escritor
// de la tabla guardaba siempre `retencion = 0`.
//
// MEDIDO: flete de $100,000.00 a un cliente persona moral. Likida timbra
// SubTotal 100,000.00 + IVA 16,000.00 − Retención 4,000.00 = **Total
// 112,000.00**. El contralor registra la factura siguiendo la ayuda al pie de
// la letra y Likida guarda **116,000.00**. El cliente paga los 112,000.00 que
// dice el CFDI y `factura_saldo` deja **$4,000.00 de saldo eterno**: el portal
// `/pago/<token>` le muestra al CLIENTE DE LA FLOTA un total que no es el de su
// CFDI, y el agente de cobranza le reclama por WhatsApp un dinero que retuvo
// legalmente para enterarlo al SAT.
//
// POR QUÉ ESTA PRUEBA Y NO UNA DE `validarFactura`: la función pura siempre
// estuvo bien. El defecto vivía ENTRE tres archivos, que es justo donde no
// había prueba. Esto compara el CONTRATO —las llaves de `FacturaCruda`—
// contra los dos extremos del cable, leyendo el fuente. Una llave nueva que
// alguien agregue a `FacturaCruda` y no cablee pone la suite en rojo sin que
// nadie tenga que acordarse de venir aquí.
// ═══════════════════════════════════════════════════════════════════════════

const ESCRITURA = readFileSync('src/lib/likida/facturacion_escritura.ts', 'utf8');
const PAGINA = readFileSync('src/app/dashboard/facturacion/page.tsx', 'utf8');
const FORMA = readFileSync('src/app/dashboard/facturacion/forma.tsx', 'utf8');

/** Las llaves declaradas en `interface FacturaCruda`, con su opcionalidad. */
function llavesDeFacturaCruda(): Array<{ nombre: string; opcional: boolean }> {
  const i = ESCRITURA.indexOf('export interface FacturaCruda {');
  expect(i, 'no se encontró `export interface FacturaCruda`').toBeGreaterThan(-1);
  const cuerpo = ESCRITURA.slice(i, ESCRITURA.indexOf('\n}', i));
  return [...cuerpo.matchAll(/^\s{2}(\w+)(\?)?:\s/gm)].map((m) => ({ nombre: m[1], opcional: m[2] === '?' }));
}

/** El bloque literal del `validarFactura({ … })` de la server action. */
function bloqueDeLaAccion(): string {
  const i = PAGINA.indexOf('validarFactura({');
  expect(i, 'la página ya no llama a `validarFactura({`').toBeGreaterThan(-1);
  return PAGINA.slice(i, PAGINA.indexOf('});', i));
}

describe('FIS-32C13-C1 · el contrato de `FacturaCruda` está cableado de punta a punta', () => {
  it('declara las llaves que esta prueba da por sentadas (si no, la prueba se volvió ciega)', () => {
    const llaves = llavesDeFacturaCruda().map((l) => l.nombre);
    // Si alguien renombra `retencion`, esta prueba tiene que fallar aquí y no
    // pasar en silencio por no encontrar nada que comparar.
    expect(llaves).toContain('retencion');
    expect(llaves).toContain('subtotal');
    expect(llaves).toContain('iva');
    expect(llaves.length).toBeGreaterThanOrEqual(8);
  });

  it('la server action LEE del FormData cada llave de `FacturaCruda`', () => {
    const bloque = bloqueDeLaAccion();
    const sinCablear = llavesDeFacturaCruda()
      .map((l) => l.nombre)
      .filter((k) => !new RegExp(`\\b${k}\\s*:`).test(bloque));
    expect(sinCablear, `llaves de FacturaCruda que la server action nunca pasa: ${sinCablear.join(', ')}`).toEqual([]);
  });

  it('el formulario OFRECE un campo por cada llave escalar que la action lee', () => {
    const escalares = llavesDeFacturaCruda().filter((l) => l.nombre !== 'viajeIds').map((l) => l.nombre);
    const sinCampo = escalares.filter((k) => !new RegExp(`name="${k}"`).test(FORMA));
    expect(sinCampo, `llaves sin campo en el formulario: ${sinCampo.join(', ')}`).toEqual([]);
  });

  it('la ayuda del formulario NO afirma que el total es subtotal + IVA sin más', () => {
    // El texto viejo decía literal «subtotal + IVA, sin oportunidad de
    // descuadre», que es falso en cuanto hay retención — y era la frase que
    // llevaba al contralor a teclear el total equivocado con confianza.
    expect(FORMA).not.toMatch(/subtotal \+ IVA, sin\s+oportunidad de descuadre/);
  });
});
