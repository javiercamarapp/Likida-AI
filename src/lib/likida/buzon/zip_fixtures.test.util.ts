import { deflateRawSync, crc32 } from 'node:zlib';

// Un constructor de zips CRUDO para las pruebas adversariales: deja declarar tamaños que mienten, apuntar dos
// entradas a los mismos bytes, marcar el bit de cifrado o meter nombres con `../`. Un zip bien formado se
// escribe con `crearZip`; esto existe para fabricar los que NO lo son.

export interface EntradaCruda {
  nombre: string;
  /** Los bytes SIN comprimir. */
  datos: Uint8Array;
  metodo?: 0 | 8;
  /** Pisa el tamaño declarado (mentir). */
  tamanoDeclarado?: number;
  /** Pisa el CRC declarado. */
  crcDeclarado?: number;
  /** Bits de propósito general (0x1 = cifrado). */
  flags?: number;
  /** Escribe la entrada apuntando al local header de OTRA entrada (solape). */
  apuntaA?: number;
  /** Datos YA comprimidos (pisa la compresión de `datos`). */
  comprimidos?: Uint8Array;
}

export function construirZipCrudo(entradas: EntradaCruda[], opciones: { zip64?: boolean; comentario?: string } = {}): Buffer {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  const offsets: number[] = [];
  let offset = 0;

  for (const e of entradas) {
    const nombre = Buffer.from(e.nombre, 'utf8');
    const crudo = Buffer.from(e.datos);
    const metodo = e.metodo ?? 8;
    const comp = e.comprimidos ? Buffer.from(e.comprimidos) : metodo === 8 ? deflateRawSync(crudo) : crudo;
    const crc = e.crcDeclarado ?? (crc32(crudo) >>> 0);
    const tam = e.tamanoDeclarado ?? crudo.length;
    const flags = (e.flags ?? 0) | 0x800;

    const local = Buffer.alloc(30 + nombre.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(tam, 22);
    local.writeUInt16LE(nombre.length, 26);
    nombre.copy(local, 30);
    offsets.push(offset);
    locales.push(local, comp);
    offset += local.length + comp.length;
  }

  entradas.forEach((e, i) => {
    const nombre = Buffer.from(e.nombre, 'utf8');
    const crudo = Buffer.from(e.datos);
    const metodo = e.metodo ?? 8;
    const comp = e.comprimidos ? Buffer.from(e.comprimidos) : metodo === 8 ? deflateRawSync(crudo) : crudo;
    const central = Buffer.alloc(46 + nombre.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE((e.flags ?? 0) | 0x800, 8);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt32LE(e.crcDeclarado ?? (crc32(crudo) >>> 0), 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(e.tamanoDeclarado ?? crudo.length, 24);
    central.writeUInt16LE(nombre.length, 28);
    central.writeUInt32LE(e.apuntaA !== undefined ? offsets[e.apuntaA] : offsets[i], 42);
    nombre.copy(central, 46);
    centrales.push(central);
  });

  const cd = Buffer.concat(centrales);
  const comentario = Buffer.from(opciones.comentario ?? '');
  const eocd = Buffer.alloc(22 + comentario.length);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(opciones.zip64 ? 0xffff : entradas.length, 8);
  eocd.writeUInt16LE(opciones.zip64 ? 0xffff : entradas.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(comentario.length, 20);
  comentario.copy(eocd, 22);
  return Buffer.concat([...locales, cd, eocd]);
}
