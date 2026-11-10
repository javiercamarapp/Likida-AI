import { describe, expect, it } from 'vitest';
import { celdaCsv, ENCABEZADOS_CSV_FACTURAS, facturasACsv } from './facturas-csv';
import type { FacturaSaasFila } from './transferencia';

const base: FacturaSaasFila = {
  id: 'f-1', tenantId: 't-1', tenantNombre: 'Flota Uno', periodoInicio: '2026-10-01', periodoFin: '2026-10-31', monto: 17500, subtotal: 15086.21, iva: 2413.79,
  moneda: 'MXN', estado: 'pagada', referencia: 'LK-ABC', metodoCobro: 'transferencia', referenciaBanco: 'MOV-9', pagadaEn: '2026-11-02T15:00:00Z',
  conciliadaEn: '2026-11-02T15:00:00Z', cfdiUuid: 'UUID-1', timbradaEn: '2026-11-02T15:01:00Z', cfdiCanceladoEn: null, cfdiXmlUrl: null,
  cfdiVerificacionUrl: null, creadaEn: '2026-10-31T10:00:00Z',
};

describe('facturasACsv', () => {
  it('empieza con BOM, usa CRLF y trae un encabezado por columna', () => {
    const csv = facturasACsv([base]);
    expect(csv.startsWith('﻿')).toBe(true);
    const [cab, fila] = csv.slice(1).split('\r\n');
    expect(cab.split(',')).toHaveLength(ENCABEZADOS_CSV_FACTURAS.length);
    expect(fila.split(',')).toHaveLength(ENCABEZADOS_CSV_FACTURAS.length);
  });

  it('los montos salen con punto y dos decimales, sin separador de millares', () => {
    const fila = facturasACsv([base]).slice(1).split('\r\n')[1];
    expect(fila).toContain(',15086.21,2413.79,17500.00,');
  });

  it('un dato que la fila no tiene sale VACÍO, nunca 0, y la factura sin desglose lo dice', () => {
    const csv = facturasACsv([{ ...base, subtotal: null, iva: null, estado: 'pendiente', cfdiUuid: null, pagadaEn: null }]);
    const fila = csv.slice(1).split('\r\n')[1];
    expect(fila).toContain(',pendiente,MXN,,,17500.00,');
    expect(fila).toContain('Sin desglose de IVA: no se puede timbrar');
    expect(fila).not.toMatch(/,0\.00,/);
  });

  it('una pagada sin CFDI se marca para el contador', () => {
    expect(facturasACsv([{ ...base, cfdiUuid: null }])).toContain('Pagada sin CFDI timbrado');
  });

  it('una lista vacía solo trae el encabezado', () => {
    expect(facturasACsv([]).slice(1).split('\r\n').filter(Boolean)).toHaveLength(1);
  });
});

describe('celdaCsv', () => {
  it('escapa comillas, comas y saltos de línea', () => {
    expect(celdaCsv('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
  it('neutraliza una fórmula tecleada por una persona', () => {
    expect(celdaCsv('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(celdaCsv('+52 55')).toBe("'+52 55");
    expect(celdaCsv('@suma')).toBe("'@suma");
  });
  it('nulo es vacío y no finito es vacío', () => {
    expect(celdaCsv(null)).toBe('');
    expect(celdaCsv(undefined)).toBe('');
    expect(celdaCsv(Number.NaN)).toBe('');
  });
});
