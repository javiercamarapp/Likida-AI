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

// Nodo raíz REAL del estándar CC_HYP_10: HidroYPetro (ns hidrocarburospetroliferos).
const CON_COMPLEMENTO = base(`
  <cfdi:ComplementoConcepto>
    <hidrocarburospetroliferos:HidroYPetro xmlns:hidrocarburospetroliferos="http://www.sat.gob.mx/hidrocarburospetroliferos" Version="1.0" TipoPermiso="PER15" NumeroPermiso="H/36212/EXP/ES/2015" ClaveHYP="PR03" SubProductoHYP="SP18"/>
  </cfdi:ComplementoConcepto>`);

// Nombre alterno (fuente secundaria previa) — la detección debe ser tolerante.
const CON_COMPLEMENTO_ALT = base(`
  <cfdi:ComplementoConcepto>
    <hidrocarburosPetroliferos:HidrocarburosPetroliferos xmlns:hidrocarburosPetroliferos="http://www.sat.gob.mx/hidrocarburos10" Version="1.0"/>
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

  it('detecta PRESENCIA del complemento (nodo real HidroYPetro)', () => {
    const r = parseCfdiXml(CON_COMPLEMENTO)!;
    expect(r.complementoHidrocarburos).toBe(true);
  });

  it('detección tolerante al nombre alterno del nodo', () => {
    const r = parseCfdiXml(CON_COMPLEMENTO_ALT)!;
    expect(r.complementoHidrocarburos).toBe(true);
  });

  it('marca esquemaAlterno=false en un CFDI normal', () => {
    expect(parseCfdiXml(SIN_COMPLEMENTO)!.esquemaAlterno).toBe(false);
  });

  it('detecta esquema alterno: Carta Porte', () => {
    const conCartaPorte = SIN_COMPLEMENTO.replace(
      '</cfdi:Complemento>',
      '<cartaporte31:CartaPorte xmlns:cartaporte31="http://www.sat.gob.mx/CartaPorte31" Version="3.1"/></cfdi:Complemento>',
    );
    expect(parseCfdiXml(conCartaPorte)!.esquemaAlterno).toBe(true);
  });

  it('detecta esquema alterno: Estado de Cuenta de Combustibles (monedero ECC)', () => {
    const conEcc = SIN_COMPLEMENTO.replace(
      '</cfdi:Complemento>',
      '<ecc12:EstadoDeCuentaCombustible xmlns:ecc12="http://www.sat.gob.mx/ecc12" Version="1.2"/></cfdi:Complemento>',
    );
    expect(parseCfdiXml(conEcc)!.esquemaAlterno).toBe(true);
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
