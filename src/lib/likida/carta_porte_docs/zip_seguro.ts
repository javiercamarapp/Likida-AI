// A37-S31-05 · Un .xlsx es un zip: 12 MB comprimidos pueden declarar GB al descomprimirse (zip bomb). Antes de que
// `XLSX.read` descomprima nada se lee el DIRECTORIO CENTRAL (unos cientos de bytes por entrada) y se suma lo que cada
// entrada dice que pesará descomprimida. Si no se puede verificar (directorio ilegible o zip64) se rechaza: fail-closed.
// CT-SEG-10: el tamaño DECLARADO lo escribe quien arma el zip y puede mentir (declarar KB y descomprimir GB). Por eso, además,
// se MIDE el inflado real de cada entrada con un tope duro (`maxOutputLength`): nunca se materializa más del tope restante.
import { inflateRawSync } from 'node:zlib';

/** Total descomprimido que se acepta para un libro de embarque (un libro de 2,000 filas pesa unos cuantos MB). */
export const MAX_BYTES_DESCOMPRIMIDOS = 100 * 1024 * 1024;
export const MAX_ENTRADAS_ZIP = 2_000;

export class ZipNoSeguro extends Error {
  constructor(motivo: string) { super(motivo); this.name = 'ZipNoSeguro'; }
}

const esZip = (b: Uint8Array): boolean => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

const demasiado = (tope: number): string => `El libro de Excel se descomprime a más de ${tope / 1024 / 1024} MB: no es un documento de embarque.`;

/** Descomprime de verdad UNA entrada con tope y devuelve su tamaño real; lanza si pasa del restante o no se puede leer. */
function medirInflado(bytes: Uint8Array, v: DataView, cd: number, restante: number, tope: number): number {
  const metodo = v.getUint16(cd + 10, true);
  const comprimido = v.getUint32(cd + 20, true);
  const lh = v.getUint32(cd + 42, true);
  if (lh + 30 > bytes.length || v.getUint32(lh, true) !== 0x04034b50) throw new ZipNoSeguro('El archivo comprimido está dañado o incompleto.');
  const ini = lh + 30 + v.getUint16(lh + 26, true) + v.getUint16(lh + 28, true);
  const fin = ini + comprimido;
  if (comprimido === 0xffffffff || fin > bytes.length) throw new ZipNoSeguro('El archivo comprimido está dañado o incompleto.');
  const datos = bytes.subarray(ini, fin);
  if (metodo === 0) {
    if (datos.length > restante) throw new ZipNoSeguro(demasiado(tope));
    return datos.length;
  }
  if (metodo !== 8) throw new ZipNoSeguro('El archivo comprimido usa un método de compresión no admitido.');
  try {
    return inflateRawSync(datos, { maxOutputLength: Math.max(restante, 1) }).length;
  } catch (e) {
    const codigo = (e as { code?: string }).code;
    if (codigo === 'ERR_BUFFER_TOO_LARGE') throw new ZipNoSeguro(demasiado(tope));
    throw new ZipNoSeguro('El archivo comprimido está dañado o incompleto.');
  }
}

/** Lanza `ZipNoSeguro` si el archivo es un zip cuyo tamaño descomprimido declarado pasa del tope o no se puede verificar. Otros formatos pasan. */
export function exigirZipAcotado(bytes: Uint8Array, tope = MAX_BYTES_DESCOMPRIMIDOS): void {
  if (!esZip(bytes)) return;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Fin del directorio central: firma 0x06054b50 en los últimos 22 + 65,535 bytes.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new ZipNoSeguro('El archivo comprimido está dañado o incompleto.');
  const entradas = v.getUint16(eocd + 10, true);
  const tam = v.getUint32(eocd + 12, true);
  let pos = v.getUint32(eocd + 16, true);
  if (entradas === 0xffff || tam === 0xffffffff || pos === 0xffffffff) throw new ZipNoSeguro('El archivo comprimido es demasiado grande para leerse.');
  if (entradas > MAX_ENTRADAS_ZIP) throw new ZipNoSeguro('El archivo comprimido trae demasiados elementos para ser un libro de Excel.');
  let total = 0;
  let real = 0;
  for (let n = 0; n < entradas; n++) {
    if (pos + 46 > bytes.length || v.getUint32(pos, true) !== 0x02014b50) throw new ZipNoSeguro('El archivo comprimido está dañado o incompleto.');
    const descomprimido = v.getUint32(pos + 24, true);
    if (descomprimido === 0xffffffff) throw new ZipNoSeguro('El archivo comprimido es demasiado grande para leerse.');
    total += descomprimido;
    if (total > tope) throw new ZipNoSeguro(demasiado(tope));
    real += medirInflado(bytes, v, pos, tope - real, tope);
    pos += 46 + v.getUint16(pos + 28, true) + v.getUint16(pos + 30, true) + v.getUint16(pos + 32, true);
  }
}
