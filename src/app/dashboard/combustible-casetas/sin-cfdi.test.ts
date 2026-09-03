import { describe, it, expect } from 'vitest';
import { calcularSinCfdi } from './sin-cfdi';
import type { DocumentoRow } from '@/lib/likida/analytics';

function doc(concepto: string, cfdiUuid: string | null): DocumentoRow {
  return { concepto, cfdiUuid } as DocumentoRow;
}

describe('calcularSinCfdi — AUDITORÍA 25, MEDIO', () => {
  it('docs === null (la consulta falló) es "error", no "sin_datos"', () => {
    // Antes `docs?.filter(...) ?? []` volvía esto indistinguible del caso
    // "no hay comprobantes": 340 cargas de diésel registradas y la lectura
    // de documentos caída se pintaba como "Sin comprobantes... todavía".
    const r = calcularSinCfdi(null);
    expect(r.estado).toBe('error');
    expect(r.pct).toBeNull();
  });

  it('docs vino vacío de verdad (la consulta funcionó) es "sin_datos"', () => {
    const r = calcularSinCfdi([]);
    expect(r.estado).toBe('sin_datos');
    expect(r.pct).toBeNull();
  });

  it('docs sin ningún diesel/caseta (solo otros conceptos) también es "sin_datos"', () => {
    const r = calcularSinCfdi([doc('viaticos', 'uuid-1')]);
    expect(r.estado).toBe('sin_datos');
  });

  it('con comprobantes de diesel/caseta calcula el % real sin CFDI', () => {
    const r = calcularSinCfdi([
      doc('diesel', null),
      doc('diesel', 'uuid-1'),
      doc('caseta', null),
      doc('viaticos', null), // no cuenta: no es diesel ni caseta
    ]);
    expect(r.estado).toBe('ok');
    expect(r.total).toBe(3);
    expect(r.sinCfdi).toBe(2);
    expect(r.pct).toBe(67);
  });
});
