import { describe, it, expect } from 'vitest';
import { parsearTagsMatriz, resolverUnidadesDeTags, type UnidadRef } from './tags';
import { matrizDeCsvTexto } from './csv';

const csv = (t: string) => matrizDeCsvTexto(t);

describe('parsearTagsMatriz', () => {
  it('lee tag/unidad/proveedor y normaliza el TAG', () => {
    const r = parsearTagsMatriz(csv('tag;unidad;proveedor\nIMDM 10000001;C2-08;PASE\nimdm-10000002;C2-09;\n'));
    expect(r.error).toBeUndefined();
    expect(r.tags).toEqual([
      { fila: 2, tag: 'IMDM10000001', tagOriginal: 'IMDM 10000001', unidadRef: 'C2-08', proveedor: 'PASE' },
      { fila: 3, tag: 'IMDM10000002', tagOriginal: 'imdm-10000002', unidadRef: 'C2-09', proveedor: null },
    ]);
  });
  it('encabezados alternativos (economico / placas)', () => {
    const r = parsearTagsMatriz(csv('Dispositivo,Numero economico\nIMDM10000001,C2-08\n'));
    expect(r.tags).toHaveLength(1);
  });
  it('faltan columnas → dice cuáles y qué leyó', () => {
    const r = parsearTagsMatriz(csv('foo,bar\n1,2\n'));
    expect(r.error).toMatch(/Faltan columnas: tag, unidad/);
    expect(r.error).toMatch(/«foo», «bar»/);
  });
  it('filas malas con su número, sin tumbar las buenas', () => {
    const r = parsearTagsMatriz(csv('tag,unidad\nN/A,C1\nIMDM10000001,\nAB,C1\nIMDM10000009,C9\n'));
    expect(r.tags.map((t) => t.tag)).toEqual(['IMDM10000009']);
    expect(r.rechazadas.map((x) => x.fila)).toEqual([2, 3, 4]);
  });
  it('el mismo TAG con DOS unidades distintas: se rechazan todas sus filas (no se elige)', () => {
    const r = parsearTagsMatriz(csv('tag,unidad\nIMDM10000001,C1\nIMDM-10000001,C2\nIMDM10000002,C3\n'));
    expect(r.tags.map((t) => t.tag)).toEqual(['IMDM10000002']);
    expect(r.rechazadas).toHaveLength(2);
    expect(r.rechazadas[0].motivo).toMatch(/unidades distintas/);
  });
  it('el mismo TAG repetido con la MISMA unidad es inocuo (una sola alta)', () => {
    const r = parsearTagsMatriz(csv('tag,unidad\nIMDM10000001,C1\nimdm 10000001,c1\n'));
    expect(r.tags).toHaveLength(1);
    expect(r.rechazadas).toEqual([]);
  });
  it('vacío y exceso', () => {
    expect(parsearTagsMatriz([]).error).toMatch(/vacío/);
    expect(parsearTagsMatriz([['tag', 'unidad'], ...Array.from({ length: 5001 }, (_, i) => [`TAG${i}XX`, 'C1'])]).error).toMatch(/más de 5000/);
  });
});

describe('resolverUnidadesDeTags', () => {
  const unidades: UnidadRef[] = [
    { id: 'u1', numeroEconomico: 'C2-08', placas: 'ABC-123' },
    { id: 'u2', numeroEconomico: 'C2-09', placas: 'XYZ-987' },
    { id: 'u3', numeroEconomico: 'T1', placas: 'DUP-001' },
    { id: 'u4', numeroEconomico: 'T2', placas: 'DUP-001' },
  ];
  const t = (unidadRef: string, fila = 2) => ({ fila, tag: 'IMDM10000001', tagOriginal: 'x', unidadRef, proveedor: null });
  it('por número económico (sin importar mayúsculas ni signos)', () => {
    expect(resolverUnidadesDeTags([t('c2 08')], unidades).altas[0].unidadId).toBe('u1');
  });
  it('por placas si no hay económico', () => {
    expect(resolverUnidadesDeTags([t('xyz 987')], unidades).altas[0].unidadId).toBe('u2');
  });
  it('unidad inexistente → rechazo con su fila', () => {
    const r = resolverUnidadesDeTags([t('NOEXISTE', 7)], unidades);
    expect(r.altas).toEqual([]);
    expect(r.rechazadas).toEqual([{ fila: 7, motivo: expect.stringMatching(/no existe en la flota/) }]);
  });
  it('placas que corresponden a dos unidades → ambigua, se rechaza', () => {
    const r = resolverUnidadesDeTags([t('DUP-001')], unidades);
    expect(r.rechazadas[0].motivo).toMatch(/más de una unidad/);
  });
  it('el económico gana a las placas (no es ambigüedad)', () => {
    expect(resolverUnidadesDeTags([t('T1')], unidades).altas[0].unidadId).toBe('u3');
  });
});
