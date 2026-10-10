import { deflateRawSync, crc32 } from 'node:zlib';
import { aBuffer, bufferDeTexto } from './bytes';

// ═══════════════════════════════════════════════════════════════════════════
// ESCRITOR DE ZIP MÍNIMO — para el lote que se le manda al contador.
//
// Sin dependencias, método 0 (almacenado) para lo que ya viene comprimido (PDF) y
// 8 (deflate) para el resto. Nombres en UTF-8 (bit 11). No soporta zip64: un lote
// no pasa de unos cuantos MB y `crearZip` lanza si algo no cabe en 32 bits, en vez
// de escribir un archivo roto. Formato: PKWARE APPNOTE.TXT 6.3.10.
// ═══════════════════════════════════════════════════════════════════════════

export interface EntradaParaZip {
  nombre: string;
  bytes: Uint8Array;
  /** true = ya está comprimido (PDF, JPG): se almacena sin deflate. */
  almacenar?: boolean;
}

/** Fecha/hora DOS (los zips no guardan zona): se escribe en UTC y se documenta. */
function fechaDos(d: Date): { fecha: number; hora: number } {
  const anio = Math.max(1980, d.getUTCFullYear());
  return {
    fecha: ((anio - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    hora: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
  };
}

/** Un nombre seguro de archivo: sin rutas, sin caracteres de control, ≤ 100 caracteres. */
export function nombreSeguroZip(nombre: string): string {
  const limpio = nombre.replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '_').replace(/^\.+/, '_').trim();
  return (limpio || 'archivo').slice(0, 100);
}

export function crearZip(entradas: readonly EntradaParaZip[], ahora: Date = new Date()): Buffer {
  if (entradas.length > 0xfffe) throw new Error('crearZip: demasiadas entradas');
  const { fecha, hora } = fechaDos(ahora);
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let offset = 0;
  const usados = new Set<string>();

  for (const e of entradas) {
    let nombre = nombreSeguroZip(e.nombre);
    // Dos entradas con el mismo nombre se vuelven ambiguas en cualquier descompresor: se desambigua.
    for (let n = 2; usados.has(nombre.toLowerCase()); n++) {
      const punto = nombre.lastIndexOf('.');
      nombre = punto > 0 ? `${nombre.slice(0, punto)} (${n})${nombre.slice(punto)}` : `${nombre} (${n})`;
    }
    usados.add(nombre.toLowerCase());
    const nombreBuf = bufferDeTexto(nombre);
    const crudo = aBuffer(e.bytes);
    const metodo = e.almacenar ? 0 : 8;
    const datos = metodo === 8 ? deflateRawSync(crudo) : crudo;
    const crc = crc32(crudo) >>> 0;
    if (datos.length > 0xfffffffe || crudo.length > 0xfffffffe || offset > 0xfffffffe) throw new Error('crearZip: el lote no cabe sin zip64');

    const local = Buffer.alloc(30 + nombreBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // versión necesaria
    local.writeUInt16LE(0x800, 6);       // flags: UTF-8
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(fecha, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(datos.length, 18);
    local.writeUInt32LE(crudo.length, 22);
    local.writeUInt16LE(nombreBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nombreBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nombreBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);        // versión que lo hizo
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(fecha, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(datos.length, 20);
    central.writeUInt32LE(crudo.length, 24);
    central.writeUInt16LE(nombreBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nombreBuf.copy(central, 46);

    locales.push(local, datos);
    centrales.push(central);
    offset += local.length + datos.length;
  }

  const cd = Buffer.concat(centrales);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entradas.length, 8);
  eocd.writeUInt16LE(entradas.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locales, cd, eocd]);
}
