import { describe, it, expect } from 'vitest';
import { parseCfdiXml, esClaveCombustible } from './cfdi_xml';

const base = (conceptoInner: string) => `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" TipoDeComprobante="I" Fecha="2026-04-25T10:00:00" Total="1160.00">
  <cfdi:Emisor Rfc="est010101aaa"/>
  <cfdi:Receptor Rfc="tin950101abc"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="15101505" ClaveUnidad="LTR" Cantidad="40" Descripcion="Diesel">${conceptoInner}</cfdi:Concepto>
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

const CON_COMPLEMENTO = base(`
  <cfdi:ComplementoConcepto>
    <hidrocarburosPetroliferos:HidrocarburosPetroliferos xmlns:hidrocarburosPetroliferos="http://www.sat.gob.mx/hidrocarburos10" Version="1.0" TipoHidrocarburo="D06"/>
  </cfdi:ComplementoConcepto>`);

const SIN_COMPLEMENTO = base('');

describe('parseCfdiXml', () => {
  it('extrae encabezado, UUID, RFCs, tipo y concepto de combustible', () => {
    const r = parseCfdiXml(SIN_COMPLEMENTO)!;
    expect(r).not.toBeNull();
    expect(r.tipoComprobante).toBe('I');
    expect(r.uuid).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(r.rfcEmisor).toBe('EST010101AAA');
    expect(r.rfcReceptor).toBe('TIN950101ABC');
    expect(r.total).toBe(1160);
    expect(r.claveProdServ).toBe('15101505');
    expect(r.claveUnidad).toBe('LTR');
    expect(r.fecha).toBe('2026-04-25T10:00:00');
  });

  it('detecta AUSENCIA del complemento de hidrocarburos', () => {
    const r = parseCfdiXml(SIN_COMPLEMENTO)!;
    expect(r.complementoHidrocarburos).toBe(false);
  });

  it('detecta PRESENCIA del complemento de hidrocarburos', () => {
    const r = parseCfdiXml(CON_COMPLEMENTO)!;
    expect(r.complementoHidrocarburos).toBe(true);
  });

  it('preserva las claves con ceros (no las castea a número)', () => {
    const r = parseCfdiXml(SIN_COMPLEMENTO)!;
    expect(typeof r.claveProdServ).toBe('string');
    expect(r.claveProdServ).toBe('15101505');
  });

  it('demo-safe: XML basura → null, no lanza', () => {
    expect(parseCfdiXml('esto no es xml <<<')).toBeNull();
    expect(parseCfdiXml('')).toBeNull();
  });

  it('esClaveCombustible respeta el catálogo de config', () => {
    expect(esClaveCombustible('15101505', ['15101505', '15101514', '15101515'])).toBe(true);
    expect(esClaveCombustible('99999999', ['15101505'])).toBe(false);
    expect(esClaveCombustible(undefined, ['15101505'])).toBe(false);
  });
});
