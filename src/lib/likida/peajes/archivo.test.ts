import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { matrizDeArchivoCatalogo, TOPE_FILAS_CATALOGO } from './archivo';

function xlsx(aoa: unknown[][], ref?: string): Uint8Array {
  const hoja = XLSX.utils.aoa_to_sheet(aoa);
  if (ref) hoja['!ref'] = ref;
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'H');
  return new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx' }));
}

describe('matrizDeArchivoCatalogo — A37-S51-06 lectura acotada', () => {
  it('lee un catálogo normal', () => {
    const r = matrizDeArchivoCatalogo('c.xlsx', xlsx([['a', 'b'], [1, 2]]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.matriz).toEqual([['a', 'b'], [1, 2]]);
  });
  it('más filas que el tope: rechazo explícito', () => {
    const filas = Array.from({ length: TOPE_FILAS_CATALOGO + 5 }, (_, i) => [i]);
    const r = matrizDeArchivoCatalogo('c.xlsx', xlsx(filas));
    expect(r.ok).toBe(false);
  });
});
