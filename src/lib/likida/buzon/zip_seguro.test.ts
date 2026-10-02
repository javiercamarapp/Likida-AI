import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { leerZipSeguro, pareceZip, LIMITES_ZIP } from './zip_seguro';
import { crearZip, nombreSeguroZip } from './zip_escribir';
import { construirZipCrudo } from './zip_fixtures.test.util';

// ═══════════════════════════════════════════════════════════════════════════
// EL LECTOR DE ZIP BAJO ATAQUE. El buzón de facturas es entrada NO autenticada
// y un .zip es el vehículo clásico: bombas de descompresión, tamaños que mienten,
// rutas que se escapan, zips dentro de zips, entradas solapadas, cifrados.
// Cada prueba fabrica el archivo malicioso a mano (zip_fixtures.test.util.ts) y
// afirma las dos cosas que importan: que NO se descomprima de más (la memoria y el
// tiempo son el ataque) y que el resultado sea un rechazo explícito, no un 500.
// ═══════════════════════════════════════════════════════════════════════════

const xml = (n: number) => Buffer.from(`<?xml version="1.0"?><Comprobante n="${n}"/>`);
const pdf = Buffer.from('%PDF-1.4\n%fake\n');

describe('el camino sano: lo que crearZip escribe, leerZipSeguro lo lee', () => {
  it('ida y vuelta de un lote XML + PDF con nombres con acentos', () => {
    const zip = crearZip([
      { nombre: 'factura-ñandú.xml', bytes: xml(1) },
      { nombre: 'factura-ñandú.pdf', bytes: pdf, almacenar: true },
    ]);
    const r = leerZipSeguro(zip);
    expect(r.rechazado).toBeNull();
    expect(r.entradas.map((e) => e.nombre).sort()).toEqual(['factura-ñandú.pdf', 'factura-ñandú.xml']);
    expect(r.entradas.find((e) => e.nombre.endsWith('.xml'))!.bytes.equals(xml(1))).toBe(true);
    expect(r.entradas.every((e) => e.profundidad === 0)).toBe(true);
  });

  it('las carpetas dentro del zip se aplanan al nombre y se muestran saneadas', () => {
    const zip = crearZip([{ nombre: 'a.xml', bytes: xml(2) }]);
    const crudo = construirZipCrudo([{ nombre: 'proveedor/2026/factura.xml', datos: xml(2) }]);
    expect(leerZipSeguro(zip).entradas).toHaveLength(1);
    const r = leerZipSeguro(crudo);
    expect(r.entradas[0].nombre).toBe('factura.xml');
    expect(r.entradas[0].ruta).toBe('proveedor/2026/factura.xml');
  });

  it('un zip dentro de un zip (un nivel) se abre; uno más profundo se omite sin tumbar lo demás', () => {
    const nivel2 = crearZip([{ nombre: 'profundo.xml', bytes: xml(9) }]);
    const nivel1 = crearZip([{ nombre: 'medio.xml', bytes: xml(5) }, { nombre: 'interno.zip', bytes: nivel2, almacenar: true }]);
    const afuera = crearZip([{ nombre: 'raiz.xml', bytes: xml(1) }, { nombre: 'caja.zip', bytes: nivel1, almacenar: true }]);
    const r = leerZipSeguro(afuera);
    expect(r.rechazado).toBeNull();
    expect(r.entradas.map((e) => [e.nombre, e.profundidad]).sort()).toEqual([['medio.xml', 1], ['raiz.xml', 0]]);
    expect(r.omitidas).toContainEqual({ ruta: 'interno.zip', motivo: 'profundidad' });
  });

  it('solo se descomprime lo que se va a leer: lo demás se omite sin tocarlo', () => {
    const r = leerZipSeguro(crearZip([
      { nombre: 'a.xml', bytes: xml(1) }, { nombre: 'virus.exe', bytes: Buffer.from('MZ') }, { nombre: 'foto.jpg', bytes: Buffer.from([0xff, 0xd8]) },
    ]));
    expect(r.entradas.map((e) => e.nombre)).toEqual(['a.xml']);
    expect(r.omitidas.filter((o) => o.motivo === 'tipo_ignorado').map((o) => o.ruta).sort()).toEqual(['foto.jpg', 'virus.exe']);
  });

  it('pareceZip distingue por bytes, no por extensión', () => {
    expect(pareceZip(crearZip([{ nombre: 'a.xml', bytes: xml(1) }]))).toBe(true);
    expect(pareceZip(Buffer.from('%PDF-1.4'))).toBe(false);
    expect(pareceZip(Buffer.from('PK'))).toBe(false);
  });
});

describe('ADVERSARIAL — bombas de descompresión', () => {
  it('una bomba CLÁSICA (60 MB de ceros en ~60 KB) se rechaza por razón de compresión SIN descomprimirla', () => {
    const ceros = Buffer.alloc(60 * 1024 * 1024);
    const zip = construirZipCrudo([{ nombre: 'bomba.xml', datos: ceros }]);
    expect(zip.length).toBeLessThan(200 * 1024);
    const inicio = Date.now();
    const r = leerZipSeguro(zip);
    // 60 MB declarados > tope por entrada (8 MB): se omite como entrada grande, sin descomprimir.
    expect(r.entradas).toHaveLength(0);
    expect(r.omitidas).toContainEqual({ ruta: 'bomba.xml', motivo: 'entrada_grande' });
    expect(Date.now() - inicio).toBeLessThan(500);
  });

  it('una bomba que cabe en el tope por entrada pero tiene razón absurda (7 MB en ~7 KB) rechaza el zip ENTERO', () => {
    const ceros = Buffer.alloc(7 * 1024 * 1024);
    const zip = construirZipCrudo([{ nombre: 'sana.xml', datos: xml(1) }, { nombre: 'bomba.xml', datos: ceros }]);
    const r = leerZipSeguro(zip);
    expect(r.rechazado).toBe('bomba');
    expect(r.entradas).toEqual([]);           // ni siquiera la entrada sana se entrega
  });

  it('un tamaño declarado que MIENTE (dice 100 bytes, descomprime a 50 MB) se corta con maxOutputLength: no se materializa', () => {
    const ceros = Buffer.alloc(50 * 1024 * 1024);
    const comprimidos = deflateRawSync(ceros);
    const zip = construirZipCrudo([{ nombre: 'mentira.xml', datos: Buffer.alloc(100), comprimidos, tamanoDeclarado: 100 }]);
    const inicio = Date.now();
    const r = leerZipSeguro(zip);
    expect(r.rechazado).toBe('bomba');
    expect(r.entradas).toEqual([]);
    expect(Date.now() - inicio).toBeLessThan(2000);
  });

  it('muchas entradas legítimas cuyo TOTAL pasa el tope rechazan el zip (la suma también es un ataque)', () => {
    // 4 entradas de ~7 MB de texto casi incompresible: 28 MB > 24 MB.
    const ruido = (n: number) => { const b = Buffer.alloc(7 * 1024 * 1024); for (let i = 0; i < b.length; i++) b[i] = (i * 2654435761 + n) & 0xff; return b; };
    const zip = construirZipCrudo([1, 2, 3, 4].map((n) => ({ nombre: `f${n}.pdf`, datos: ruido(n), metodo: 0 as const })));
    expect(leerZipSeguro(zip, { maxBytesZip: 40 * 1024 * 1024 }).rechazado).toBe('bomba');
  });

  it('la bomba de ZIPS ANIDADOS rechaza todo: no se lee nada de lo demás', () => {
    const bomba = construirZipCrudo([{ nombre: 'dentro.xml', datos: Buffer.alloc(7 * 1024 * 1024) }]);
    const afuera = crearZip([{ nombre: 'ok.xml', bytes: xml(1) }, { nombre: 'caja.zip', bytes: bomba, almacenar: true }]);
    const r = leerZipSeguro(afuera);
    expect(r.rechazado).toBe('bomba');
    expect(r.entradas).toEqual([]);
  });
});

describe('ADVERSARIAL — estructura y rutas', () => {
  it('más entradas de las permitidas: se rechaza el zip antes de leer una sola', () => {
    const muchas = Array.from({ length: LIMITES_ZIP.maxEntradas + 1 }, (_, i) => ({ nombre: `f${i}.xml`, datos: xml(i) }));
    expect(leerZipSeguro(construirZipCrudo(muchas)).rechazado).toBe('demasiadas_entradas');
  });

  it('la BOMBA DE SOLAPE (dos entradas apuntando a los mismos bytes) se rechaza', () => {
    const zip = construirZipCrudo([
      { nombre: 'a.xml', datos: Buffer.alloc(200_000, 0x41) },
      { nombre: 'b.xml', datos: Buffer.alloc(200_000, 0x41), apuntaA: 0 },
    ]);
    expect(leerZipSeguro(zip).rechazado).toBe('solapado');
  });

  it('rutas con ../, absolutas, con letra de unidad o NUL se OMITEN (nunca se saneen para usarlas)', () => {
    const zip = construirZipCrudo([
      { nombre: '../../etc/passwd.xml', datos: xml(1) },
      { nombre: '/etc/shadow.xml', datos: xml(2) },
      { nombre: 'C:\\Windows\\x.xml', datos: xml(3) },
      { nombre: 'a/../../b.xml', datos: xml(4) },
      { nombre: 'sana.xml', datos: xml(5) },
    ]);
    const r = leerZipSeguro(zip);
    expect(r.entradas.map((e) => e.nombre)).toEqual(['sana.xml']);
    expect(r.omitidas.filter((o) => o.motivo === 'ruta_peligrosa')).toHaveLength(4);
  });

  it('una entrada CIFRADA se omite y las demás se leen', () => {
    const r = leerZipSeguro(construirZipCrudo([
      { nombre: 'secreta.xml', datos: xml(1), flags: 0x1 }, { nombre: 'abierta.xml', datos: xml(2) },
    ]));
    expect(r.entradas.map((e) => e.nombre)).toEqual(['abierta.xml']);
    expect(r.omitidas).toContainEqual({ ruta: 'secreta.xml', motivo: 'cifrado' });
  });

  it('un método de compresión raro (bzip2, lzma…) se omite', () => {
    const zip = construirZipCrudo([{ nombre: 'raro.xml', datos: xml(1) }, { nombre: 'ok.xml', datos: xml(2) }]);
    // Cambia el método de la primera entrada en el directorio central a 12 (bzip2).
    const cd = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zip.writeUInt16LE(12, cd + 10);
    const r = leerZipSeguro(zip);
    expect(r.entradas.map((e) => e.nombre)).toEqual(['ok.xml']);
    expect(r.omitidas).toContainEqual({ ruta: 'raro.xml', motivo: 'metodo_no_soportado' });
  });

  it('el CRC que no coincide delata un archivo alterado: esa entrada se omite', () => {
    const r = leerZipSeguro(construirZipCrudo([{ nombre: 'a.xml', datos: xml(1), crcDeclarado: 0xdeadbeef }, { nombre: 'b.xml', datos: xml(2) }]));
    expect(r.omitidas).toContainEqual({ ruta: 'a.xml', motivo: 'crc_no_coincide' });
    expect(r.entradas.map((e) => e.nombre)).toEqual(['b.xml']);
  });

  it('zip64 se rechaza (no se soporta y no se adivina)', () => {
    expect(leerZipSeguro(construirZipCrudo([{ nombre: 'a.xml', datos: xml(1) }], { zip64: true })).rechazado).toBe('zip64');
  });

  it('basura, vacío, PDF disfrazado de zip y zips truncados fallan cerrado, sin lanzar', () => {
    expect(leerZipSeguro(Buffer.alloc(0)).rechazado).toBe('no_es_zip');
    expect(leerZipSeguro(Buffer.from('%PDF-1.4 esto no es un zip')).rechazado).toBe('no_es_zip');
    expect(leerZipSeguro(Buffer.from('PK\x03\x04basuraaleatoria')).rechazado).toBe('no_es_zip');
    const bueno = crearZip([{ nombre: 'a.xml', bytes: xml(1) }]);
    for (const corte of [10, 30, bueno.length - 5, bueno.length - 25]) {
      const r = leerZipSeguro(bueno.subarray(0, corte));
      expect(r.entradas).toEqual([]);
      expect(r.rechazado).not.toBeNull();
    }
  });

  it('un directorio central que apunta fuera del archivo se rechaza como corrupto', () => {
    const zip = Buffer.from(crearZip([{ nombre: 'a.xml', bytes: xml(1) }]));
    const cd = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zip.writeUInt32LE(zip.length + 1000, cd + 42);       // offset del local header fuera del archivo
    expect(leerZipSeguro(zip).rechazado).toBe('corrupto');
  });

  it('un zip más grande que el tope se rechaza sin leerlo', () => {
    const zip = crearZip([{ nombre: 'a.xml', bytes: xml(1) }]);
    expect(leerZipSeguro(zip, { maxBytesZip: 50 }).rechazado).toBe('demasiado_grande');
  });

  it('nunca lanza: cualquier entrada de bytes aleatorios devuelve un resultado', () => {
    for (let n = 0; n < 200; n++) {
      const bytes = Buffer.alloc(64 + (n * 7) % 400);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + n * 17) & 0xff;
      if (n % 3 === 0) bytes.write('PK\x03\x04', 0, 'latin1');
      if (n % 5 === 0) bytes.write('PK\x05\x06', bytes.length - 22, 'latin1');
      expect(() => leerZipSeguro(bytes)).not.toThrow();
    }
  });
});

describe('crearZip', () => {
  it('desambigua nombres repetidos y sanea rutas y caracteres de control', () => {
    const r = leerZipSeguro(crearZip([
      { nombre: 'f.xml', bytes: xml(1) }, { nombre: 'F.xml', bytes: xml(2) }, { nombre: '../x\n.xml', bytes: xml(3) },
    ]));
    expect(r.entradas.map((e) => e.nombre).sort()).toEqual(['F (2).xml', '__x_.xml', 'f.xml'].sort());
    expect(nombreSeguroZip('a/b\\c:d.xml')).toBe('a_b_c_d.xml');
    expect(nombreSeguroZip('')).toBe('archivo');
  });
});
