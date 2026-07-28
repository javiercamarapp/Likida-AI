import { describe, it, expect } from 'vitest';
import { identificarComercio } from './identificar';
import { COMERCIOS, comercio } from './comercios';

// De qué comercio es el ticket. Es el primer paso de todo: sin comercio no se
// sabe qué campos pedirle al OCR ni a qué portal ir.
//
// Regla dura: si no hay una respuesta ÚNICA no se adivina. Mandar un ticket al
// portal equivocado no falla de forma visible — falla pidiéndole a la oficina
// datos que ese ticket no tiene, y nadie entiende por qué.
describe('identificarComercio', () => {
  it('la liga del QR manda: es el dato que no pasó por OCR', () => {
    const c = identificarComercio({ urlFacturacion: 'https://facturacion.oxxogas.com/#/inicio' });
    expect(c?.clave).toBe('oxxo_gas');
  });

  it('reconoce por RFC del emisor', () => {
    // El RFC lo valida el dígito verificador (cfdi.ts), así que cuando pasa esa
    // prueba es una llave sólida.
    const c = identificarComercio({ rfcEmisor: 'CPU970326PZ4' });
    expect(c?.clave).toBe('capufe');
  });

  it('reconoce por el texto impreso cuando no hay liga ni RFC', () => {
    const c = identificarComercio({ textoTicket: 'CAMINOS Y PUENTES FEDERALES  CASETA 042  CUOTA $310.00' });
    expect(c?.clave).toBe('capufe');
  });

  it('la liga gana sobre un texto que apunta a otro lado', () => {
    // Un ticket de gasolinera puede traer impresa publicidad de otra marca. La
    // liga del QR viene del emisor y no se lee con visión: gana siempre.
    const c = identificarComercio({
      urlFacturacion: 'https://facturacion.oxxogas.com/',
      textoTicket: 'GRACIAS POR SU COMPRA EN CAPUFE',
    });
    expect(c?.clave).toBe('oxxo_gas');
  });

  it('si nada casa devuelve null en vez de inventar', () => {
    expect(identificarComercio({ textoTicket: 'ABARROTES DOÑA MARY' })).toBeNull();
  });

  it('sin ninguna señal devuelve null', () => {
    expect(identificarComercio({})).toBeNull();
  });
});

describe('registro de comercios', () => {
  it('toda clave es única', () => {
    const claves = COMERCIOS.map((c) => c.clave);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('todo comercio declara al menos una forma de reconocerse', () => {
    for (const c of COMERCIOS) {
      const señales = (c.reconocer.dominios?.length ?? 0) + (c.reconocer.rfc?.length ?? 0) + (c.reconocer.texto?.length ?? 0);
      expect(señales, `${c.clave} no se puede reconocer`).toBeGreaterThan(0);
    }
  });

  // El invariante se mantiene, pero "todavía no lo sé" pasa a ser una declaración
  // explícita en vez de un array vacío indistinguible de un descuido. Un comercio
  // con `camposPendientes` avisa a qué portal ir y NO enumera campos: las
  // etiquetas se le enseñan a un contralor y de memoria saldrían inventadas.
  it('todo comercio declara sus campos, o declara que están pendientes', () => {
    for (const c of COMERCIOS) {
      const declara = c.campos.length > 0;
      expect(declara !== !!c.camposPendientes, `${c.clave}: campos y camposPendientes se contradicen`).toBe(true);
    }
  });

  it('ningún comercio se anuncia sin portal a dónde mandar al operador', () => {
    for (const c of COMERCIOS) {
      expect(c.portal, `${c.clave} no tiene portal`).toMatch(/^https?:\/\//);
    }
  });

  it('CAPUFE y Enerser no exigen cuenta: son el arranque sin custodiar contraseñas', () => {
    expect(comercio('capufe')?.requiereCuenta).toBe(false);
    expect(comercio('enerser')?.requiereCuenta).toBe(false);
  });

  it('G500 pide Folio Y Web ID — los dos, no uno', () => {
    // Es el caso que rompe un extractor genérico: dos identificadores distintos
    // del mismo ticket, y el portal no acepta uno solo.
    const claves = comercio('g500')!.campos.filter((x) => x.requerido).map((x) => x.clave);
    expect(claves).toContain('folio');
    expect(claves).toContain('webId');
  });

  it('el ITU de Office Depot trae su restricción de largo', () => {
    // Verificado en el HTML del portal: maxlength="30" uppercase.
    const itu = comercio('office_depot')!.campos.find((x) => x.clave === 'numeroTicket');
    expect(itu?.restriccion?.largoMax).toBe(30);
    expect(itu?.restriccion?.mayusculas).toBe(true);
  });
});
