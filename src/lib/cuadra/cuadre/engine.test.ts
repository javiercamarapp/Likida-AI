import { describe, it, expect } from 'vitest';
import { cuadrarViaje, type PoliticaGasto } from './engine';
import type { Gasto } from '@/types/cuadra';

const g = (p: Partial<Gasto>): Gasto => ({
  id: Math.random().toString(36).slice(2),
  concepto: 'diesel',
  monto: 0,
  ocrConfianza: 0.95,
  ...p,
});

const politica: PoliticaGasto[] = [
  { concepto: 'diesel', topeMonto: 2500 },
  { concepto: 'caseta', topeMonto: 1000 },
  { concepto: 'factura', requiereCfdi: true },
];

describe('cuadrarViaje', () => {
  it('cuadra exacto cuando comprobado = anticipo y todo dentro de política', () => {
    const r = cuadrarViaje({
      viajeId: 'v1', anticipo: 3000, politica,
      gastos: [g({ concepto: 'diesel', monto: 2000, folio: 'A1' }), g({ concepto: 'caseta', monto: 1000, folio: 'C1' })],
    });
    expect(r.totalComprobado).toBe(3000);
    expect(r.diferencia).toBe(0);
    expect(r.estatus).toBe('cuadrada');
    expect(r.diferencias).toHaveLength(0);
  });

  it('detecta sobre-política, faltante de CFDI y diferencia de anticipo', () => {
    const r = cuadrarViaje({
      viajeId: 'v2', anticipo: 5000, politica,
      gastos: [
        g({ concepto: 'diesel', monto: 3000, folio: 'D1' }),          // 500 sobre tope 2500
        g({ concepto: 'caseta', monto: 800, folio: 'C1' }),
        g({ concepto: 'factura', monto: 800, folio: 'F1' }),          // requiere CFDI, sin uuid
      ],
    });
    expect(r.totalComprobado).toBe(4600);
    expect(r.diferencia).toBe(400); // sobró anticipo, a favor empresa
    const tipos = r.diferencias.map((d) => d.tipo).sort();
    expect(tipos).toContain('sobre_politica');
    expect(tipos).toContain('sin_cfdi');
    expect(tipos).toContain('anticipo');
    expect(r.estatus).toBe('revisar'); // sin_cfdi → revisar
  });

  it('detecta comprobantes duplicados (mismo folio+monto)', () => {
    const r = cuadrarViaje({
      viajeId: 'v3', anticipo: 4000, politica,
      gastos: [
        g({ concepto: 'diesel', monto: 2000, folio: 'DUP' }),
        g({ concepto: 'diesel', monto: 2000, folio: 'DUP' }),
      ],
    });
    expect(r.diferencias.some((d) => d.tipo === 'duplicado')).toBe(true);
    expect(r.estatus).toBe('con_diferencias');
  });

  it('marca baja confianza de OCR para revisión', () => {
    const r = cuadrarViaje({
      viajeId: 'v4', anticipo: 1000, politica,
      gastos: [g({ concepto: 'caseta', monto: 1000, folio: 'C9', ocrConfianza: 0.5 })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'ocr_baja_confianza')).toBe(true);
    expect(r.estatus).toBe('revisar');
  });

  it('duplicado por UUID NO infla el total (fix del audit)', () => {
    const r = cuadrarViaje({
      viajeId: 'v5', anticipo: 2000, politica,
      gastos: [
        g({ concepto: 'diesel', monto: 2000, cfdiUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', folio: 'X1' }),
        g({ concepto: 'diesel', monto: 2000, cfdiUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', folio: 'X2' }),
      ],
    });
    expect(r.totalComprobado).toBe(2000); // NO 4000
    expect(r.diferencias.some((d) => d.tipo === 'duplicado')).toBe(true);
  });

  it('detecta RFC receptor distinto al de la empresa', () => {
    const r = cuadrarViaje({
      viajeId: 'v6', anticipo: 1000, politica, empresaRfc: 'EMP010101AAA',
      gastos: [g({ concepto: 'factura', monto: 1000, folio: 'F1', cfdiUuid: 'u', rfcReceptor: 'CHOFER800101XY1' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'rfc_receptor')).toBe(true);
    expect(r.estatus).toBe('revisar');
  });

  it('detecta CFDI cancelado ante el SAT', () => {
    const r = cuadrarViaje({
      viajeId: 'v7', anticipo: 1000, politica,
      gastos: [g({ concepto: 'factura', monto: 1000, folio: 'F2', cfdiUuid: 'u2', estadoSat: 'cancelado' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'cfdi_cancelado')).toBe(true);
  });

  it('SAT pendiente NO tumba: continúa como revisar', () => {
    const r = cuadrarViaje({
      viajeId: 'v8', anticipo: 1000, politica,
      gastos: [g({ concepto: 'factura', monto: 1000, folio: 'F3', cfdiUuid: 'u3', estadoSat: 'pendiente' })],
    });
    expect(r.diferencias.some((d) => d.tipo === 'cfdi_pendiente')).toBe(true);
    expect(r.estatus).toBe('revisar');
  });
});
