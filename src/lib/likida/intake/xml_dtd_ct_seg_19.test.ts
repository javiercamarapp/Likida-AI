import { describe, it, expect } from 'vitest';
import { parseCfdiXml, leerPagosRep, xmlDeclaraDtd } from './cfdi_xml';
import { parseRepXml } from './rep';

// CT-SEG-19 · Un CFDI/REP nunca lleva DTD: se rechaza antes de parsear (XXE y «billion laughs»).
const DTD_ENTIDAD = '<!DOCTYPE c [<!ENTITY x "AAAA">]>';
const DTD_EXTERNA = '<!DOCTYPE c [<!ENTITY y SYSTEM "file:///etc/passwd">]>';
const BOMBA = '<!DOCTYPE lolz [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>';

const CFDI = (dtd = '') => `<?xml version="1.0" encoding="UTF-8"?>${dtd}
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" TipoDeComprobante="I" Fecha="2026-04-25T10:00:00" Total="1160.00">
  <cfdi:Emisor Rfc="EST010101AAA"/><cfdi:Receptor Rfc="TIN950101ABC"/>
  <cfdi:Conceptos><cfdi:Concepto ClaveProdServ="15101505" ClaveUnidad="LTR" Cantidad="40" Descripcion="Diesel"/></cfdi:Conceptos>
  <cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"/></cfdi:Complemento>
</cfdi:Comprobante>`;

const REP = (dtd = '') => `<?xml version="1.0" encoding="UTF-8"?>${dtd}
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:pago20="http://www.sat.gob.mx/Pagos20" Version="4.0" TipoDeComprobante="P" Fecha="2026-09-03T10:00:00" Total="0">
  <cfdi:Emisor Rfc="EST010101AB1"/><cfdi:Receptor Rfc="GMX0902279I1"/>
  <cfdi:Complemento>
    <pago20:Pagos Version="2.0">
      <pago20:Pago FechaPago="2026-09-02T12:00:00" FormaDePagoP="03" MonedaP="MXN" Monto="11600.00">
        <pago20:DoctoRelacionado IdDocumento="11111111-2222-3333-4444-555566660001" NumParcialidad="1" ImpSaldoAnt="11600.00" ImpPagado="11600.00" ImpSaldoInsoluto="0"/>
      </pago20:Pago>
    </pago20:Pagos>
    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="AAAAAAAA-BBBB-CCCC-DDDD-EEEEFFFF0001"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

describe('CT-SEG-19 · guarda DTD/entidades', () => {
  it('controles: el CFDI y el REP sin DTD se leen normal', () => {
    expect(parseCfdiXml(CFDI())).not.toBeNull();
    expect(parseRepXml(REP())).not.toBeNull();
    expect(leerPagosRep(REP())).toHaveLength(1);
  });

  it('parseCfdiXml rechaza cualquier DTD o entidad (interna, externa o de expansion)', () => {
    for (const dtd of [DTD_ENTIDAD, DTD_EXTERNA, BOMBA]) expect(parseCfdiXml(CFDI(dtd))).toBeNull();
  });

  it('leerPagosRep devuelve [] con DTD aunque el resto sea un REP valido', () => {
    for (const dtd of [DTD_ENTIDAD, DTD_EXTERNA, BOMBA]) expect(leerPagosRep(REP(dtd))).toEqual([]);
  });

  it('parseRepXml rechaza el REP con DTD', () => {
    for (const dtd of [DTD_ENTIDAD, DTD_EXTERNA, BOMBA]) expect(parseRepXml(REP(dtd))).toBeNull();
  });

  it('xmlDeclaraDtd ve variantes con espacios y mayusculas y no se confunde con un CFDI normal', () => {
    expect(xmlDeclaraDtd('<!  DocType x>')).toBe(true);
    expect(xmlDeclaraDtd('<!ENTITY a "b">')).toBe(true);
    expect(xmlDeclaraDtd(CFDI())).toBe(false);
  });
});
