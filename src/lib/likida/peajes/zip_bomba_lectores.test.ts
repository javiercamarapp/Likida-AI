import { describe, it, expect } from 'vitest';
import { matrizDeArchivoCatalogo } from './archivo';
import { parsearArchivoDesglose } from '../intake/desglose_peaje';
import { leerProgramaXlsx } from '../vigia/programa/lector_xlsx';
import { ErrorLectorPrograma } from '../vigia/programa/lector';

// A37-O7-05 · un zip sintético cuyo directorio central DECLARA una expansión desmedida (no se descomprime nada).
function zipBomba(): Uint8Array {
  const nombre = new TextEncoder().encode('xl/worksheets/sheet1.xml');
  const local = new Uint8Array(30 + nombre.length);
  new DataView(local.buffer).setUint32(0, 0x04034b50, true);
  const cd = new Uint8Array(46 + nombre.length);
  const d = new DataView(cd.buffer);
  d.setUint32(0, 0x02014b50, true);
  d.setUint32(20, 4_000_000, true);
  d.setUint32(24, 4_000_000_000, true);
  d.setUint16(28, nombre.length, true);
  cd.set(nombre, 46);
  const fin = new Uint8Array(22);
  const f = new DataView(fin.buffer);
  f.setUint32(0, 0x06054b50, true);
  f.setUint16(10, 1, true);
  f.setUint32(12, cd.length, true);
  f.setUint32(16, local.length, true);
  const todo = new Uint8Array(local.length + cd.length + fin.length);
  todo.set(local, 0); todo.set(cd, local.length); todo.set(fin, local.length + cd.length);
  return todo;
}

describe('A37-O7-05: los lectores de .xlsx de peajes y Vigía rechazan una bomba de descompresión antes de descomprimir', () => {
  it('catálogo de peajes', () => {
    const r = matrizDeArchivoCatalogo('catalogo.xlsx', zipBomba());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/descomprimir/);
  });
  it('desglose de peaje', async () => {
    const r = await parsearArchivoDesglose('desglose.xlsx', Buffer.from(zipBomba()));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/descomprimir/);
  });
  it('programa del Vigía', () => {
    expect(() => leerProgramaXlsx(zipBomba(), {})).toThrow(ErrorLectorPrograma);
    expect(() => leerProgramaXlsx(zipBomba(), {})).toThrow(/descomprimir/);
  });
});
