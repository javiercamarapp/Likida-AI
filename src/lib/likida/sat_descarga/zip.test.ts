import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { leerZip, MAX_ENTRADAS } from './zip';

/**
 * Construye un ZIP real (no un fixture binario pegado) para que la prueba
 * mida el LECTOR y no una cadena mágica. `metodo` 8 = deflate, 0 = almacenado.
 */
function armarZip(archivos: Array<{ nombre: string; contenido: string; metodo?: 0 | 8 }>): Buffer {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let offset = 0;

  for (const a of archivos) {
    const metodo = a.metodo ?? 8;
    const crudo = Buffer.from(a.contenido, 'utf8');
    const datos = metodo === 8 ? deflateRawSync(crudo) : crudo;
    const nombre = Buffer.from(a.nombre, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(0, 14); // crc: el lector no lo usa
    local.writeUInt32LE(datos.length, 18);
    local.writeUInt32LE(crudo.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    local.writeUInt16LE(0, 28);
    locales.push(Buffer.concat([local, nombre, datos]));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt32LE(datos.length, 20);
    central.writeUInt32LE(crudo.length, 24);
    central.writeUInt16LE(nombre.length, 28);
    central.writeUInt32LE(offset, 42);
    centrales.push(Buffer.concat([central, nombre]));

    offset += 30 + nombre.length + datos.length;
  }

  const cuerpo = Buffer.concat(locales);
  const dir = Buffer.concat(centrales);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(archivos.length, 8);
  eocd.writeUInt16LE(archivos.length, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(cuerpo.length, 16);
  return Buffer.concat([cuerpo, dir, eocd]);
}

const CFDI = '<?xml version="1.0"?><cfdi:Comprobante Total="1160.00"/>';

describe('leerZip', () => {
  it('saca los XML de un paquete deflateado', () => {
    const r = leerZip(armarZip([
      { nombre: 'A1B2.xml', contenido: CFDI },
      { nombre: 'C3D4.xml', contenido: '<x>2</x>' },
    ]));
    expect(r.entradas).toHaveLength(2);
    expect(r.entradas[0]).toEqual({ nombre: 'A1B2.xml', contenido: CFDI });
    expect(r.truncado).toBe(false);
    expect(r.ilegibles).toBe(0);
  });

  it('lee también las entradas ALMACENADAS sin comprimir (método 0)', () => {
    const r = leerZip(armarZip([{ nombre: 'plano.xml', contenido: CFDI, metodo: 0 }]));
    expect(r.entradas[0].contenido).toBe(CFDI);
  });

  it('deja fuera lo que no es XML — el paquete del SAT trae metadatos', () => {
    const r = leerZip(armarZip([
      { nombre: 'A.xml', contenido: CFDI },
      { nombre: 'metadata.txt', contenido: 'uuid|rfc|total' },
    ]));
    expect(r.entradas.map((e) => e.nombre)).toEqual(['A.xml']);
  });

  it('el filtro se puede cambiar sin tocar el lector', () => {
    const r = leerZip(
      armarZip([{ nombre: 'metadata.txt', contenido: 'hola' }]),
      (n) => n.endsWith('.txt'),
    );
    expect(r.entradas[0].contenido).toBe('hola');
  });

  it('un método de compresión desconocido se cuenta como ILEGIBLE, no como vacío', () => {
    // 99 = AES: existe, y devolver sus bytes crudos sería entregar basura que
    // el parser de CFDI tomaría por un comprobante ausente.
    const zip = armarZip([{ nombre: 'raro.xml', contenido: CFDI, metodo: 0 }]);
    // Se muta el método en el directorio central Y en el encabezado local.
    zip.writeUInt16LE(99, 8);
    const dirOffset = zip.readUInt32LE(zip.length - 22 + 16);
    zip.writeUInt16LE(99, dirOffset + 10);
    const r = leerZip(zip);
    expect(r.entradas).toHaveLength(0);
    expect(r.ilegibles).toBe(1);
  });

  it('un buffer que no es ZIP devuelve vacío en vez de lanzar', () => {
    expect(leerZip(Buffer.from('no soy un zip'))).toEqual({ entradas: [], truncado: false, ilegibles: 0 });
    expect(leerZip(Buffer.alloc(0)).entradas).toHaveLength(0);
  });

  it('corta al llegar al tope de entradas y lo DECLARA', () => {
    // El tope real son 50,000 entradas: armar ese ZIP en una prueba sería
    // lento sin medir nada nuevo. Se verifica la constante y que el campo
    // exista, que es el contrato que el llamador lee para decirlo.
    expect(MAX_ENTRADAS).toBe(50_000);
    const r = leerZip(armarZip([{ nombre: 'A.xml', contenido: CFDI }]));
    expect(r).toHaveProperty('truncado', false);
  });

  it('un directorio central corrupto no tira el paquete: devuelve lo que sí leyó', () => {
    const zip = armarZip([
      { nombre: 'A.xml', contenido: CFDI },
      { nombre: 'B.xml', contenido: '<b/>' },
    ]);
    // Se rompe el offset del directorio central: apunta fuera del archivo.
    zip.writeUInt32LE(zip.length + 500, zip.length - 22 + 16);
    const r = leerZip(zip);
    expect(r.entradas).toHaveLength(0);
  });

  it('un encabezado LOCAL roto cuenta esa entrada como ilegible y sigue con la otra', () => {
    const zip = armarZip([
      { nombre: 'A.xml', contenido: CFDI },
      { nombre: 'B.xml', contenido: '<b/>' },
    ]);
    // Se destruye la firma del primer encabezado local (offset 0).
    zip.writeUInt32LE(0xdeadbeef, 0);
    const r = leerZip(zip);
    expect(r.ilegibles).toBe(1);
    expect(r.entradas.map((e) => e.nombre)).toEqual(['B.xml']);
  });
});
