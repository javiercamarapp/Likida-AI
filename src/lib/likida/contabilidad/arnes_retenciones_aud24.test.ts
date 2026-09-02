// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · PRU-A4 (ALTO, reincidente 23) — el arnés del export contable,
// de la retención del XML al abono de la póliza.
//
// M15: en `intake/cfdi_xml.ts` cambiar el `'002'` de las RETENCIONES por
// `'001'` —contar el IVA retenido como ISR retenido— pasaba los 35 archivos de
// `intake/` y la suite completa EN VERDE, con `cfdi_xml.ts` al 93.33%. Ninguna
// prueba pedía un `<cfdi:Retenciones>`.
//
// Por qué vive aquí y no junto a `cfdi_xml.ts`: la cifra que rompe no es el
// parser, es el ABONO a «retenciones por pagar» que el contador de Innovativos
// importa a su ERP. Un flete subcontratado a un permisionario persona física
// retiene 4% de IVA (LIVA 1-A) — el caso NORMAL de esta flota— y el archivo
// tiene que decir cuánto se le debe al SAT por ese concepto, no cuánto de ISR.
// Cruzar los dos impuestos manda la declaración mensual con dos renglones
// falsos que se compensan entre sí: el total cuadra y NADA enrojece.
//
// Las dos puntas se prueban juntas a propósito: el parser solo y la póliza
// sola ya estaban «cubiertos» por líneas, y la mutación sobrevivió igual.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { parseCfdiXml } from '../intake/cfdi_xml';
import { polizaDeLiquidacion, type CatalogoContable, type LiquidacionParaPoliza } from './poliza';

const CATALOGO: CatalogoContable = {
  gastos: { flete: '5030-001' },
  ivaAcreditable: '1180-001',
  ivaNoAcreditable: '1180-002',
  retencionesPorPagar: '2015-001',
  anticipoOperador: '1190-001',
  porCobrarOperador: '1190-002',
  porPagarOperador: '2010-001',
};

/**
 * Un CFDI de flete subcontratado: base 10,000, IVA trasladado 1,600, y el
 * permisionario persona física con las DOS retenciones que la ley pide —
 * 4% de IVA (LIVA 1-A / RLIVA 3) y 1.25% de ISR. Total = 10,000 + 1,600 − 400
 * − 125 = 11,075.
 */
const XML_FLETE = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0"
  TipoDeComprobante="I" Fecha="2026-08-20T10:00:00" FormaPago="03" MetodoPago="PUE"
  SubTotal="10000.00" Total="11075.00" Moneda="MXN">
  <cfdi:Emisor Rfc="XAX010101AB1" Nombre="Permisionario SA"/>
  <cfdi:Receptor Rfc="IIN010101AAA"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="78101800" Cantidad="1" Descripcion="Flete" ValorUnitario="10000.00" Importe="10000.00"/>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="1600.00" TotalImpuestosRetenidos="525.00">
    <cfdi:Retenciones>
      <cfdi:Retencion Impuesto="002" Importe="400.00"/>
      <cfdi:Retencion Impuesto="001" Importe="125.00"/>
    </cfdi:Retenciones>
    <cfdi:Traslados>
      <cfdi:Traslado Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="1600.00"/>
    </cfdi:Traslados>
  </cfdi:Impuestos>
</cfdi:Comprobante>`;

describe('PRU-A4: 002 es IVA retenido y 001 es ISR retenido, y no al revés', () => {
  it('el parser separa los dos impuestos del nodo Retenciones', () => {
    const x = parseCfdiXml(XML_FLETE);
    expect(x).not.toBeNull();
    // La aserción que mata M15. Se afirman los DOS: con un solo `expect` sobre
    // la suma, cruzarlos seguiría dando 525.
    expect(x!.ivaRetenido).toBeCloseTo(400, 2);
    expect(x!.isrRetenido).toBeCloseTo(125, 2);
    // Y que no se confundan con el TRASLADO, que va del otro lado del asiento.
    expect(x!.ivaTraslado).toBeCloseTo(1600, 2);
  });

  it('sin nodo Retenciones no se inventa una retención de cero ni de nada', () => {
    const sin = parseCfdiXml(XML_FLETE.replace(/<cfdi:Retenciones>[\s\S]*?<\/cfdi:Retenciones>/, ''));
    expect(sin).not.toBeNull();
    expect(sin!.ivaRetenido ?? 0).toBe(0);
    expect(sin!.isrRetenido ?? 0).toBe(0);
  });

  it('la Σ de las dos retenciones sale como ABONO a «retenciones por pagar»', () => {
    const x = parseCfdiXml(XML_FLETE)!;
    const retenciones = (x.ivaRetenido ?? 0) + (x.isrRetenido ?? 0);

    // Anticipo 12,000; el flete costó 11,075 (10,000 + 1,600 − 525) y el
    // operador devuelve 925.
    const liq: LiquidacionParaPoliza = {
      folioViaje: 'VJ-2026-A4',
      operador: 'Juan Pérez',
      fecha: '2026-08-20',
      anticipo: 12_000,
      porConcepto: [{ concepto: 'flete', subtotal: x.subTotal! }],
      ivaAcreditable: x.ivaTraslado!,
      retenciones,
      diferencia: 12_000 - 11_075,
    };

    const r = polizaDeLiquidacion(liq, CATALOGO);
    expect(r.ok, r.ok ? '' : r.falta.join(' · ')).toBe(true);
    if (!r.ok) return;

    const abono = r.poliza.movimientos.find((m) => m.cuenta === '2015-001');
    expect(abono).toBeDefined();
    expect(abono!.abono).toBeCloseTo(525, 2);
    expect(abono!.cargo).toBe(0);

    // Y el asiento cuadra: si la retención se contara del lado del cargo, o se
    // omitiera, el archivo llegaría descuadrado al ERP del cliente.
    // El total NO es el anticipo: la retención no salió del anticipo (el
    // proveedor cobró 11,075), se le debe al SAT — así que suma de los dos
    // lados. 10,000 flete + 1,600 IVA + 925 por cobrar = 12,000 + 525.
    const cargos = r.poliza.movimientos.reduce((s, m) => s + m.cargo, 0);
    const abonos = r.poliza.movimientos.reduce((s, m) => s + m.abono, 0);
    expect(cargos).toBeCloseTo(abonos, 2);
    expect(cargos).toBeCloseTo(12_525, 2);
  });
});
