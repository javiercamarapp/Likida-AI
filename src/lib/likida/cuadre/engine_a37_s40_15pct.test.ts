import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './engine';
import type { Gasto } from '@/types/likida';

// A37-S40-07 y A37-S40-08: la frontera del 15 % (RFA 2026 regla 2.9) en centavos
// y sin que la abstención de la facilidad se salte el resto de las validaciones.

const estimulos = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: [] };

function diesel(over: Partial<Gasto> = {}): Gasto {
  return {
    id: 'g1', concepto: 'diesel', monto: 100.1, subTotal: 86.29, folio: 'F1',
    fecha: '2026-03-10', ocrConfianza: 0.95, cfdiUuid: 'uuid-1', xmlVerificado: true,
    rfcReceptor: 'REC010101AA1', tipoComprobante: 'I', ivaTraslado: 13.81, formaPago: '01',
    ...over,
  };
}

function correr(g: Gasto, over: Record<string, unknown> = {}) {
  return cuadrarViaje({
    viajeId: 'v1', anticipo: 100.1, politica: [{ concepto: 'diesel', topeMonto: 100000 }],
    estimulos, gastos: [g], facilidad15: true,
    totalCombustibleEjercicio: 1000.13, efectivoPrevEjercicio: 49.92, anioEjercicio: '2026',
    ...over,
  } as Parameters<typeof cuadrarViaje>[0]);
}

describe('A37-S40-08 · el tope del 15 % se compara en centavos', () => {
  it('efectivo que llega al tope al centavo queda DENTRO, sin «excedente de $0.00»', () => {
    // 15 % de 1,000.13 = 150.0195 → tope de 150.02; previo 49.92 + 100.10 = 150.02.
    const r = correr(diesel());
    expect(r.diferencias.some((d) => d.tipo === 'efectivo_sobre_15')).toBe(false);
    expect(r.diferencias.some((d) => d.tipo === 'combustible_efectivo_dentro15')).toBe(true);
  });

  it('un centavo por encima SÍ es excedente', () => {
    const r = correr(diesel({ monto: 100.11, subTotal: 86.3 }));
    const d = r.diferencias.find((x) => x.tipo === 'efectivo_sobre_15');
    expect(d?.monto).toBe(0.01);
  });
});

describe('A37-S40-07 · la abstención de la facilidad no salta las demás validaciones', () => {
  it('con el contador ilegible, un CFDI CANCELADO sigue marcándose cancelado', () => {
    const r = correr(diesel({ estadoSat: 'cancelado' }), { totalCombustibleEjercicio: 0 });
    expect(r.diferencias.some((d) => d.tipo === 'combustible_efectivo')).toBe(true);
    expect(r.diferencias.some((d) => d.tipo === 'cfdi_cancelado')).toBe(true);
  });

  it('con el contador ilegible, el gasto sobre el tope de política sigue marcándose', () => {
    const r = correr(diesel({ monto: 500, subTotal: 431.03, ivaTraslado: 68.97 }), {
      totalCombustibleEjercicio: 0, politica: [{ concepto: 'diesel', topeMonto: 300 }],
    });
    expect(r.diferencias.some((d) => d.tipo === 'combustible_efectivo')).toBe(true);
    expect(r.diferencias.some((d) => d.tipo === 'sobre_politica')).toBe(true);
  });

  it('un comprobante de OTRO ejercicio con CFDI cancelado también conserva la marca', () => {
    const r = correr(diesel({ estadoSat: 'cancelado', fecha: '2025-12-30' }));
    expect(r.diferencias.some((d) => d.tipo === 'cfdi_cancelado')).toBe(true);
  });
});
