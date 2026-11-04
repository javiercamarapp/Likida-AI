import * as XLSX from 'xlsx';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { exigirZipAcotado, MAX_BYTES_DESCOMPRIMIDOS, ZipNoSeguro } from './zip_seguro';
import { leerPlantillaTms } from './lector_plantilla_tms';
import { prepararContenido } from './contenido';

function xlsxReal(): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet([['a', 'b'], [1, 2]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

/** Cambia en el directorio central lo que la PRIMERA entrada dice que pesará descomprimida (una bomba declara GB en pocos KB). */
function declararDescomprimido(zip: Uint8Array, bytes: number): Uint8Array {
  const copia = new Uint8Array(zip);
  const v = new DataView(copia.buffer);
  for (let i = 0; i < copia.length - 4; i++) {
    if (v.getUint32(i, true) === 0x02014b50) { v.setUint32(i + 24, bytes, true); return copia; }
  }
  throw new Error('sin directorio central');
}

/** Zip de UNA entrada deflate cuyo directorio central declara `declarado` bytes (mentira) y que en realidad infla a `real`. */
function zipMentiroso(real: number, declarado: number): Uint8Array {
  const datos = deflateRawSync(Buffer.alloc(real, 0x41));
  const nombre = Buffer.from('a.xml');
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(datos.length, 18); lh.writeUInt32LE(declarado, 22); lh.writeUInt16LE(nombre.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(datos.length, 20); cd.writeUInt32LE(declarado, 24); cd.writeUInt16LE(nombre.length, 28); cd.writeUInt32LE(0, 42);
  const localTotal = Buffer.concat([lh, nombre, datos]);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(46 + nombre.length, 12); eocd.writeUInt32LE(localTotal.length, 16);
  return new Uint8Array(Buffer.concat([localTotal, cd, nombre, eocd]));
}

describe('exigirZipAcotado (A37-S31-05)', () => {
  it('CT-SEG-10: una entrada que declara pocos bytes pero infla por encima del tope se rechaza midiendo el inflado real', () => {
    const tope = 1024 * 1024;
    expect(() => exigirZipAcotado(zipMentiroso(5 * tope, 10), tope)).toThrow(ZipNoSeguro);
    expect(() => exigirZipAcotado(zipMentiroso(5 * tope, 10), tope)).toThrow(/se descomprime a más de/);
  });

  it('CT-SEG-10: un zip hecho a mano que dice la verdad y cabe en el tope pasa', () => {
    expect(() => exigirZipAcotado(zipMentiroso(2048, 2048), 1024 * 1024)).not.toThrow();
  });

  it('un xlsx normal pasa y un archivo que no es zip no se toca', () => {
    expect(() => exigirZipAcotado(xlsxReal())).not.toThrow();
    expect(() => exigirZipAcotado(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]))).not.toThrow();
    expect(() => exigirZipAcotado(new TextEncoder().encode('a,b\n1,2'))).not.toThrow();
  });

  it('un zip que declara más de 100 MB descomprimidos se rechaza ANTES de descomprimir', () => {
    const bomba = declararDescomprimido(xlsxReal(), MAX_BYTES_DESCOMPRIMIDOS + 1);
    expect(() => exigirZipAcotado(bomba)).toThrow(ZipNoSeguro);
    expect(() => exigirZipAcotado(declararDescomprimido(xlsxReal(), 0xffffffff))).toThrow(/demasiado grande/);
  });

  it('un zip truncado (sin directorio central) no se puede verificar y se rechaza', () => {
    const z = xlsxReal();
    expect(() => exigirZipAcotado(z.slice(0, z.length - 40))).toThrow(ZipNoSeguro);
  });

  it('el lector de la plantilla del TMS y la preparación del contenido lo aplican', async () => {
    const bomba = declararDescomprimido(xlsxReal(), MAX_BYTES_DESCOMPRIMIDOS + 1);
    expect(leerPlantillaTms(bomba)).toBeNull();
    await expect(prepararContenido(bomba, 'excel')).rejects.toThrow(/El libro de Excel se descomprime/);
  });
});
