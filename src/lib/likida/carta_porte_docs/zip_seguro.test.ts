import * as XLSX from 'xlsx';
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

describe('exigirZipAcotado (A37-S31-05)', () => {
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
