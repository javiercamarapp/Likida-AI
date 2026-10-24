import { describe, it, expect } from 'vitest';
import { utils as xlsxUtils, write as escribirLibro } from 'xlsx';
import { validarZipDeLibro, ArchivoPeligroso, MAX_PARTE_BYTES } from './zip_seguro';
import { matrizDeArchivo, COLUMNAS_MAX_LECTURA } from './archivo';

// A37-S45-09 · un zip sintético mínimo cuyo directorio central DECLARA tamaños
// (no se descomprime nada: es justo lo que la validación mide).
function zipDeclarando(partes: Array<{ comprimido: number; real: number }>): ArrayBuffer {
  const nombre = new TextEncoder().encode('xl/worksheets/sheet1.xml');
  const local = new Uint8Array(30 + nombre.length);
  new DataView(local.buffer).setUint32(0, 0x04034b50, true);
  const entradas = partes.map(({ comprimido, real }) => {
    const e = new Uint8Array(46 + nombre.length);
    const d = new DataView(e.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint32(20, comprimido, true);
    d.setUint32(24, real, true);
    d.setUint16(28, nombre.length, true);
    e.set(nombre, 46);
    return e;
  });
  const cdLen = entradas.reduce((a, e) => a + e.length, 0);
  const fin = new Uint8Array(22);
  const f = new DataView(fin.buffer);
  f.setUint32(0, 0x06054b50, true);
  f.setUint16(10, partes.length, true);
  f.setUint32(12, cdLen, true);
  f.setUint32(16, local.length, true);
  const todo = new Uint8Array(local.length + cdLen + fin.length);
  todo.set(local, 0);
  let o = local.length;
  for (const e of entradas) { todo.set(e, o); o += e.length; }
  todo.set(fin, o);
  return todo.buffer;
}

describe('validarZipDeLibro', () => {
  it('rechaza una hoja que se descomprimiría ~1000:1', () => {
    expect(() => validarZipDeLibro(zipDeclarando([{ comprimido: 4_000_000, real: 4_000_000_000 }]))).toThrow(ArchivoPeligroso);
  });
  it('rechaza una parte mayor al tope aunque la razón sea baja', () => {
    expect(() => validarZipDeLibro(zipDeclarando([{ comprimido: MAX_PARTE_BYTES, real: MAX_PARTE_BYTES + 1 }]))).toThrow(ArchivoPeligroso);
  });
  it('rechaza la suma desmedida repartida en muchas partes', () => {
    const partes = Array.from({ length: 20 }, () => ({ comprimido: 2_000_000, real: 8_000_000 }));
    expect(() => validarZipDeLibro(zipDeclarando(partes))).toThrow(ArchivoPeligroso);
  });
  it('deja pasar un libro normal y un CSV (no zip)', () => {
    expect(() => validarZipDeLibro(zipDeclarando([{ comprimido: 20_000, real: 90_000 }]))).not.toThrow();
    expect(() => validarZipDeLibro(new TextEncoder().encode('placa,unidad\nAAA,1\n').buffer as ArrayBuffer)).not.toThrow();
  });
});

describe('matrizDeArchivo', () => {
  it('lee un .xlsx real normal', () => {
    const hoja = xlsxUtils.aoa_to_sheet([['placa', 'unidad'], ['AAA-1', 'U1']]);
    const libro = xlsxUtils.book_new();
    xlsxUtils.book_append_sheet(libro, hoja, 'Hoja1');
    const bytes = escribirLibro(libro, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    expect(matrizDeArchivo(bytes)).toEqual([['placa', 'unidad'], ['AAA-1', 'U1']]);
  });
  it('rechaza una hoja con demasiadas columnas', () => {
    const fila = Array.from({ length: COLUMNAS_MAX_LECTURA + 5 }, (_, i) => `c${i}`);
    const csv = fila.join(',') + '\n';
    expect(() => matrizDeArchivo(new TextEncoder().encode(csv).buffer as ArrayBuffer)).toThrow(/columnas/);
  });
});
