import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  armarVinculos, vinculosAExcel, ENCABEZADOS_VINCULOS, LEYENDA_DIA_DE_VIAJE, HOJAS_VINCULOS,
  type LineaParaVinculos, type VinculoParaArchivo,
} from './vinculos_archivos';

// Archivo «casetas ligadas a viaje / casetas sin viaje» (T-A2-22). Fixtures sintéticos.

const L = (id: string, extra: Partial<LineaParaVinculos> = {}): LineaParaVinculos => ({
  id, fecha: '2026-08-05', hora: '11:30:00', unidad: 'C2-09', caseta: 'Caseta Ejemplo Sur', clase: 3, importe: 100, ...extra,
});
const V = (lineaId: string, extra: Partial<VinculoParaArchivo> = {}): VinculoParaArchivo => ({
  lineaId, estado: 'ligado', viajeId: 'v1', via: 'unidad_ventana', candidatos: [], motivo: null, ...extra,
});
const folios = new Map([['v1', 'VJ-0001'], ['v2', 'VJ-0002'], ['v3', 'VJ-0003']]);

const libro = (bytes: Uint8Array) => XLSX.read(bytes, { type: 'array' });
const filas = (l: XLSX.WorkBook, hoja: string) => XLSX.utils.sheet_to_json<unknown[]>(l.Sheets[hoja], { header: 1, defval: null }).slice(1);

describe('armarVinculos', () => {
  const lineas = [L('a'), L('b'), L('c'), L('d'), L('e'), L('f')];
  const vinculos = [
    V('a'), V('b', { estado: 'sin_viaje', viajeId: null, motivo: 'sin viaje ese día' }),
    V('c', { estado: 'ambiguo', viajeId: null, candidatos: ['v2', 'v3'] }),
    V('d', { estado: 'sin_unidad', viajeId: null, motivo: 'unidad no reconocida' }),
    V('e', { estado: 'conflicto', viajeId: null }),
  ];
  const r = armarVinculos(lineas, vinculos, folios);

  it('reparte cada estado en su hoja', () => {
    expect(r.ligadas.map((f) => f.lineaId)).toEqual(['a']);
    expect(r.sinViaje.map((f) => f.lineaId).sort()).toEqual(['b', 'd', 'f']);
    expect(r.ambiguas.map((f) => f.lineaId).sort()).toEqual(['c', 'e']);
  });
  it('una línea sin vínculo calculado NO se pierde: cae en «sin viaje» rotulada «sin calcular»', () => {
    expect(r.sinViaje.find((f) => f.lineaId === 'f')?.estado).toBe('sin calcular');
  });
  it('la ligada lleva el folio; la ambigua, los folios candidatos', () => {
    expect(r.ligadas[0].folioViaje).toBe('VJ-0001');
    expect(r.ambiguas.find((f) => f.lineaId === 'c')?.folioViaje).toBe('VJ-0002, VJ-0003');
  });
  it('un vínculo de una línea ajena al desglose se ignora', () => {
    expect(armarVinculos([L('a')], [V('a'), V('zzz')], folios).ligadas).toHaveLength(1);
  });
  it('«ligado por día de viaje, no por hora» solo cuando la vía es unidad_ventana', () => {
    const x = armarVinculos([L('a'), L('b')], [V('a'), V('b', { via: 'icident' })], folios);
    expect(x.ligadas.find((f) => f.lineaId === 'a')?.nota).toBe(LEYENDA_DIA_DE_VIAJE);
    expect(x.ligadas.find((f) => f.lineaId === 'b')?.nota).toBe('');
  });
  it('folio desconocido de un viaje ligado queda vacío, no inventado', () => {
    expect(armarVinculos([L('a')], [V('a', { viajeId: 'vX' })], folios).ligadas[0].folioViaje).toBe('');
  });
});

describe('vinculosAExcel', () => {
  const lineas = [L('a'), L('b', { hora: null, clase: null }), L('c')];
  const vinculos = [V('a'), V('b', { estado: 'sin_viaje', viajeId: null }), V('c', { estado: 'ambiguo', viajeId: null, candidatos: ['v2', 'v3'] })];
  const l = libro(vinculosAExcel(armarVinculos(lineas, vinculos, folios)));

  it('tres hojas, en este orden, con el encabezado de la ficha', () => {
    expect(l.SheetNames).toEqual([...HOJAS_VINCULOS]);
    expect(l.SheetNames).toEqual(['Ligadas', 'Sin viaje', 'Ambiguas']);
    for (const h of l.SheetNames) {
      expect(XLSX.utils.sheet_to_json<unknown[]>(l.Sheets[h], { header: 1 })[0]).toEqual([...ENCABEZADOS_VINCULOS]);
    }
  });
  it('cada hoja trae filtro automático y no lleva TAG', () => {
    for (const h of l.SheetNames) expect(l.Sheets[h]['!autofilter']?.ref, h).toBeTruthy();
    expect(ENCABEZADOS_VINCULOS.join('|')).not.toMatch(/tag|tarjeta/i);
  });
  it('las filas caen donde deben, con folio, vía y estado', () => {
    expect(filas(l, 'Ligadas')).toHaveLength(1);
    expect(filas(l, 'Ligadas')[0]).toEqual(expect.arrayContaining(['2026-08-05', 'C2-09', 'Caseta Ejemplo Sur', 100, 'VJ-0001', 'unidad_ventana', 'ligado']));
    expect(filas(l, 'Sin viaje')[0]).toEqual(expect.arrayContaining(['sin_viaje']));
    expect(filas(l, 'Ambiguas')[0]).toEqual(expect.arrayContaining(['VJ-0002, VJ-0003', 'ambiguo']));
  });
  it('la leyenda del día de viaje viaja en la fila ligada por unidad_ventana', () => {
    expect(JSON.stringify(filas(l, 'Ligadas')[0])).toContain(LEYENDA_DIA_DE_VIAJE);
  });
  it('sin ninguna fila: las tres hojas existen igual, solo con encabezado', () => {
    const v = libro(vinculosAExcel(armarVinculos([], [], folios)));
    expect(v.SheetNames).toEqual(['Ligadas', 'Sin viaje', 'Ambiguas']);
    expect(filas(v, 'Ligadas')).toHaveLength(0);
  });
  it('un texto del proveedor que empieza con = se escribe como texto, nunca como fórmula', () => {
    const x = libro(vinculosAExcel(armarVinculos([L('a', { caseta: '=HYPERLINK("x")' })], [V('a')], folios)));
    const celda = Object.values(x.Sheets['Ligadas']).find((c) => typeof c === 'object' && c && 'v' in c && String((c as XLSX.CellObject).v).includes('HYPERLINK')) as XLSX.CellObject;
    expect(celda.f).toBeUndefined();
    expect(String(celda.v).startsWith("'")).toBe(true);
  });
});
