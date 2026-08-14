import { describe, it, expect } from 'vitest';
import { leerDescripcionPrimerConcepto, compararReceptor, aFilaExportProveedor, type FacturaProveedor } from './proveedores';

// Solo el motor PURO: ingesta/decisión son el patrón claim de la base
// (unique + eq estado, verificación 66); aquí se fijan los contratos que
// romperían al cliente sin hacer ruido.

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

describe('aFilaExportProveedor — el contrato del layout importable', () => {
  const f: FacturaProveedor = {
    id: 'f1', cfdiUuid: 'AAAA-BBBB', emisorRfc: 'TAL010101AB1', emisorNombre: null,
    receptorRfc: 'FLO010101AB1', receptorEsFlota: true, fecha: '2026-08-10',
    subTotal: 2300, iva: 368, total: 2668, descripcion: 'CAMBIO DE LLANTA',
    conceptos: 2, estado: 'aprobada', decididoPor: 'ana@flota.mx',
    decididoEn: '2026-08-14T17:00:00Z', creadoEn: '2026-08-14T16:00:00Z',
  };

  it('las columnas son EXACTAMENTE estas — renombrar una rompe el import del cliente', () => {
    expect(Object.keys(aFilaExportProveedor(f))).toEqual([
      'fecha', 'uuid', 'rfc_emisor', 'rfc_receptor', 'descripcion', 'conceptos',
      'subtotal', 'iva', 'total', 'aprobada_por', 'aprobada_en',
    ]);
  });

  it('los nulos salen como celda vacía, nunca como "null"', () => {
    const fila = aFilaExportProveedor({ ...f, fecha: null, subTotal: null, iva: null, descripcion: null });
    expect(fila.fecha).toBe('');
    expect(fila.subtotal).toBe('');
    expect(fila.iva).toBe('');
    expect(fila.descripcion).toBe('');
    expect(fila.total).toBe(2668);
  });
});
