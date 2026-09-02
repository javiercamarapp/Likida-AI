// ═══════════════════════════════════════════════════════════════════════════
// AUD24 · PRU-A1/A4 (ALTO, REINCIDENTE) — el parser de `Impuestos/Retenciones`
// (cfdi_xml.ts:355-364, FIS-A1) no tenía UNA prueba: 35 archivos de `intake/`
// pasan sin citar `ivaRetenido` ni `isrRetenido`. La mutación M15 (`if (imp
// === '002')` → `if (imp === '001')`) cuenta la retención de IVA (002, la que
// hacen los permisionarios de autotransporte) como si fuera ISR (001), y
// nada enrojece.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { parseCfdiXml } from './cfdi_xml';

const base = (impuestosInner: string) => `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" TipoDeComprobante="I" Fecha="2026-04-25T10:00:00" Total="1160.00">
  <cfdi:Emisor Rfc="est010101aaa"/>
  <cfdi:Receptor Rfc="tin950101abc"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="78101800" ClaveUnidad="E48" Cantidad="1" Descripcion="Flete"/>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosRetenidos="400.00" TotalImpuestosTrasladados="160.00">${impuestosInner}</cfdi:Impuestos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

const CON_RETENCION_IVA = base(`
    <cfdi:Retenciones>
      <cfdi:Retencion Impuesto="002" Importe="400.00"/>
    </cfdi:Retenciones>
    <cfdi:Traslados>
      <cfdi:Traslado Impuesto="002" Importe="160.00" TipoFactor="Tasa" TasaOCuota="0.160000"/>
    </cfdi:Traslados>`);

const CON_RETENCION_ISR = base(`
    <cfdi:Retenciones>
      <cfdi:Retencion Impuesto="001" Importe="120.00"/>
    </cfdi:Retenciones>`);

describe('PRU-A1/A4: la retención de IVA (002) no se cuenta como ISR (001)', () => {
  it('Retencion Impuesto="002" → ivaRetenido, NUNCA isrRetenido', () => {
    const r = parseCfdiXml(CON_RETENCION_IVA)!;
    expect(r.ivaRetenido).toBe(400);
    expect(r.isrRetenido).toBe(0);
  });

  it('Retencion Impuesto="001" → isrRetenido, NUNCA ivaRetenido (el otro extremo)', () => {
    const r = parseCfdiXml(CON_RETENCION_ISR)!;
    expect(r.isrRetenido).toBe(120);
    expect(r.ivaRetenido).toBe(0);
  });
});
