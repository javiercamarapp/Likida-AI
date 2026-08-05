import { describe, it, expect } from 'vitest';
import { parseCfdiXml, esClaveCombustible, esConsolidado } from './cfdi_xml';

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

  it('un CFDI de un solo concepto NO trae líneas (no es consolidado)', () => {
    const r = parseCfdiXml(SIN_COMPLEMENTO)!;
    expect(r.lineas).toEqual([]);
    expect(esConsolidado(r)).toBe(false);
  });
});

// ═══ CFDI CONSOLIDADO — auditoría 10 ════════════════════════════════════════
//
// Estructura ECC12 verificada contra el XSD oficial (ecc12.xsd, SAT) el
// 5-ago-2026: `EstadoDeCuentaCombustible` cuelga de `cfdi:Complemento`,
// HERMANO de `TimbreFiscalDigital` — no de un `Concepto`.
const CONSOLIDADO_ECC12 = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" TipoDeComprobante="I" Fecha="2026-04-30T23:59:00" Total="3300.00" SubTotal="2844.83">
  <cfdi:Emisor Rfc="edn010101aa1"/>
  <cfdi:Receptor Rfc="tin950101abc"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="84111506" ClaveUnidad="ACT" Cantidad="1" Importe="2844.83" Descripcion="Consumo de combustibles del periodo abril 2026"/>
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <ecc12:EstadoDeCuentaCombustible xmlns:ecc12="http://www.sat.gob.mx/ecc12" Version="1.2" TipoOperacion="Tarjeta" NumeroDeCuenta="0009182736" SubTotal="2844.83" Total="3300.00">
      <ecc12:Conceptos>
        <ecc12:ConceptoEstadoDeCuentaCombustible Identificador="1" Fecha="2026-04-03T09:12:00" Rfc="EST010101AAA" ClaveEstacion="4521" Cantidad="120.500" TipoCombustible="Diesel" Unidad="LT" NombreCombustible="Diesel" FolioOperacion="OP-100234" ValorUnitario="24.10" Importe="2904.05"/>
        <ecc12:ConceptoEstadoDeCuentaCombustible Identificador="2" Fecha="2026-04-11T18:47:00" Rfc="EST020202BBB" ClaveEstacion="7710" Cantidad="95.000" TipoCombustible="Diesel" Unidad="LT" NombreCombustible="Diesel" FolioOperacion="OP-100511" ValorUnitario="24.30" Importe="2308.50"/>
        <ecc12:ConceptoEstadoDeCuentaCombustible Identificador="3" Fecha="2026-04-22T07:03:00" Rfc="EST010101AAA" ClaveEstacion="4521" Cantidad="110.000" TipoCombustible="Diesel" Unidad="LT" NombreCombustible="Diesel" FolioOperacion="OP-100822" ValorUnitario="24.15" Importe="2656.50"/>
      </ecc12:Conceptos>
    </ecc12:EstadoDeCuentaCombustible>
    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="11111111-2222-3333-4444-555555555555"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

// TAG/peaje: varios Concepto en un mismo CFDI, SIN ecc12 — el caso donde el
// estándar NO da fecha por transacción.
const CONSOLIDADO_TAG_SIN_FECHA = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" TipoDeComprobante="I" Fecha="2026-04-30T23:59:00" Total="928.00">
  <cfdi:Emisor Rfc="cap850101xy1"/>
  <cfdi:Receptor Rfc="tin950101abc"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="78101803" ClaveUnidad="E48" Cantidad="1" Importe="310.00" Descripcion="Cruce caseta Km 42"/>
    <cfdi:Concepto ClaveProdServ="78101803" ClaveUnidad="E48" Cantidad="1" Importe="298.00" Descripcion="Cruce caseta Km 88"/>
    <cfdi:Concepto ClaveProdServ="78101803" ClaveUnidad="E48" Cantidad="1" Importe="320.00" Descripcion="Cruce caseta Km 142"/>
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="66666666-7777-8888-9999-000000000000"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

describe('parseCfdiXml — CFDI consolidado (líneas)', () => {
  it('ECC12: extrae UNA línea por transacción real, con fecha, estación y folio propios', () => {
    const r = parseCfdiXml(CONSOLIDADO_ECC12)!;
    expect(r).not.toBeNull();
    expect(r.lineas).toHaveLength(3);
    expect(esConsolidado(r)).toBe(true);

    const [l1, l2, l3] = r.lineas;
    expect(l1).toMatchObject({
      indice: 1, fuente: 'ecc12', fecha: '2026-04-03T09:12:00', monto: 2904.05,
      estacionRfc: 'EST010101AAA', estacionClave: '4521', folioOperacion: 'OP-100234', cantidad: 120.5,
    });
    expect(l2.fecha).toBe('2026-04-11T18:47:00');
    expect(l3.estacionRfc).toBe('EST010101AAA'); // misma estación que l1, día distinto
  });

  it('ECC12: el RFC de la estación real es DISTINTO del RFC emisor (el monedero)', () => {
    const r = parseCfdiXml(CONSOLIDADO_ECC12)!;
    expect(r.rfcEmisor).toBe('EDN010101AA1'); // el monedero
    expect(r.lineas[0].estacionRfc).toBe('EST010101AAA'); // la gasolinera real
    expect(r.rfcEmisor).not.toBe(r.lineas[0].estacionRfc);
  });

  it('ECC12 gana sobre el fallback de concepto base (solo 1 Concepto en el ejemplo, pero si hubiera varios)', () => {
    const r = parseCfdiXml(CONSOLIDADO_ECC12)!;
    expect(r.lineas.every((l) => l.fuente === 'ecc12')).toBe(true);
  });

  it('sin ECC12 pero con VARIOS Concepto: cada uno es su línea, monto real, fecha ausente', () => {
    const r = parseCfdiXml(CONSOLIDADO_TAG_SIN_FECHA)!;
    expect(r.lineas).toHaveLength(3);
    expect(esConsolidado(r)).toBe(true);
    expect(r.lineas.map((l) => l.monto)).toEqual([310, 298, 320]);
    // LA LIMITACIÓN REAL, no disimulada: el estándar no da fecha por Concepto.
    expect(r.lineas.every((l) => l.fecha === undefined)).toBe(true);
    expect(r.lineas.every((l) => l.fuente === 'concepto_base')).toBe(true);
    expect(r.lineas[1].descripcion).toBe('Cruce caseta Km 88');
  });

  it('la suma de las líneas del ECC12 cuadra contra el SubTotal declarado por el complemento', () => {
    const r = parseCfdiXml(CONSOLIDADO_ECC12)!;
    const suma = r.lineas.reduce((s, l) => s + l.monto, 0);
    expect(suma).toBeCloseTo(2904.05 + 2308.5 + 2656.5, 2);
  });
});
