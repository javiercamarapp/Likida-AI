import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { matrizDeArchivoCatalogo, MAX_FILAS_LECTURA_CATALOGO } from './archivo';

const xlsx = (filas: number): Uint8Array => {
  const hoja = XLSX.utils.aoa_to_sheet(Array.from({ length: filas }, (_, i) => [`T${i}`]));
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Hoja1');
  return new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
};

describe('matrizDeArchivoCatalogo · A37-A2-15 lectura acotada', () => {
  it('un Excel normal se lee completo', () => {
    const r = matrizDeArchivoCatalogo('tags.xlsx', xlsx(30));
    expect(r.ok && r.matriz).toHaveLength(30);
  });

  it('un Excel con más filas que el tope de lectura se rechaza sin materializarlo entero', () => {
    const r = matrizDeArchivoCatalogo('tags.xlsx', xlsx(MAX_FILAS_LECTURA_CATALOGO + 500));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/demasiadas filas/i);
  });
});
