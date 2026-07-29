import { describe, it, expect } from 'vitest';
import { formaPagoSat, parseCfdiXml } from './cfdi_xml';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 6 · ALTO del rubro modelo de datos — UNA RESTRICCIÓN NUEVA QUE
// PIERDE UN COMPROBANTE FISCAL ENTERO.
//
// La migración 0025 puso `gasto_forma_pago_formato` (`^[0-9]{2}$`) para cazar
// un fallo del mapeo de OCR — camino que ya estaba blindado con zod. El
// segundo escritor de `forma_pago`, este parser, leía `@_FormaPago` del XML tal
// cual: sin zod, sin regex, sin catálogo.
//
// Un CFDI bien timbrado con `FormaPago="1"` en vez de `"01"` violaba el CHECK
// (23514). `pg_errores.ts` no sabe traducir ese código, `processor.ts` solo
// reconoce los dos índices únicos, y el resto cae en `throw e`. El comprobante
// se perdía entero, sin guardar siquiera el XML crudo que el CFF art. 30 obliga
// a conservar cinco años.
//
// Es exactamente lo que la ronda venía a cazar: una restricción nueva que
// convierte un dato malo en un error de ejecución que el código no traduce.
// ═══════════════════════════════════════════════════════════════════════════

// El CHECK tal cual está aplicado en producción.
const PASA_EL_CHECK = (v: string | undefined) => v === undefined || /^[0-9]{2}$/.test(v);

describe('formaPagoSat normaliza al catálogo del SAT o descarta', () => {
  it('el dígito suelto se rellena: "1" es "01" y no puede ser otra cosa', () => {
    // El catálogo c_FormaPago va de 01 a 99, así que no hay ambigüedad.
    expect(formaPagoSat('1')).toBe('01');
    expect(formaPagoSat('3')).toBe('03');
    expect(formaPagoSat('9')).toBe('09');
  });

  it('lo que ya viene bien no se toca', () => {
    expect(formaPagoSat('01')).toBe('01');
    expect(formaPagoSat('28')).toBe('28');
    expect(formaPagoSat('99')).toBe('99');
  });

  it('con espacios alrededor sigue siendo válido', () => {
    expect(formaPagoSat(' 03 ')).toBe('03');
  });

  const basura = ['', '  ', 'EFECTIVO', '001', '1A', 'null', '-1', '1.5', '０１'];
  for (const v of basura) {
    it(`descarta lo que no es del catálogo: ${JSON.stringify(v)}`, () => {
      expect(formaPagoSat(v)).toBeUndefined();
    });
  }

  it('ausente o nulo se queda en undefined', () => {
    expect(formaPagoSat(undefined)).toBeUndefined();
    expect(formaPagoSat(null)).toBeUndefined();
  });

  it('NINGUNA salida posible viola el CHECK de la 0025', () => {
    // La aserción que resume el hallazgo: no importa qué traiga el XML, lo que
    // sale de aquí nunca puede tirar el insert.
    const entradas = ['1', '01', '99', '', 'EFECTIVO', '001', '1A', '  ', '-1', '1.5', '０１', 'undefined'];
    for (const v of entradas) {
      expect(PASA_EL_CHECK(formaPagoSat(v)), `"${v}" produjo un valor que viola el CHECK`).toBe(true);
    }
  });
});

describe('el CFDI con FormaPago de un dígito ya no se pierde', () => {
  const cfdi = (formaPago: string) => `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0"
  Fecha="2026-05-01T10:00:00" FormaPago="${formaPago}" SubTotal="1000.00" Total="1160.00"
  TipoDeComprobante="I">
  <cfdi:Emisor Rfc="PEM850101AAA" Nombre="Gasolinera Independiente"/>
  <cfdi:Receptor Rfc="MAT9012159X6"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="15101514" ClaveUnidad="LTR" Cantidad="50" Importe="1000.00"/>
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
      UUID="A1B2C3D4-E5F6-4A5B-8C9D-0E1F2A3B4C5D"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

  it('se parsea igual y conserva UUID, total y RFC', () => {
    const x = parseCfdiXml(cfdi('1'));
    expect(x).not.toBeNull();
    expect(x!.uuid).toBe('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d');
    expect(x!.total).toBe(1160);
    expect(x!.rfcEmisor).toBe('PEM850101AAA');
  });

  it('y su forma de pago llega normalizada, no cruda', () => {
    expect(parseCfdiXml(cfdi('1'))!.formaPago).toBe('01');
    expect(PASA_EL_CHECK(parseCfdiXml(cfdi('1'))!.formaPago)).toBe(true);
  });

  it('un valor irrecuperable se descarta sin llevarse el comprobante', () => {
    const x = parseCfdiXml(cfdi('EFECTIVO'))!;
    expect(x.formaPago).toBeUndefined();
    // Lo que importa: el CFDI sigue entero. Perder un dato accesorio es
    // incomparablemente mejor que perder el comprobante.
    expect(x.uuid).toBe('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d');
    expect(x.total).toBe(1160);
  });
});
