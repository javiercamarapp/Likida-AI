import { describe, expect, it } from 'vitest';
import { ErrorLectorPrograma, leerProgramaCsv } from './lector';
import { leerProgramaXlsx, normalizarColorXlsx } from './lector_xlsx';

// ---------------------------------------------------------------------------
// Constructor de .xlsx sintético CON rellenos. La escritura de SheetJS (edición
// comunitaria) no emite estilos, así que se arma el zip a mano (sin compresión,
// hoja con cadenas en línea). Todo el contenido es inventado.

type Relleno = string; // atributos de <fgColor>: p. ej. 'rgb="FFFF99CC"' o 'theme="5" tint="0.4"'
interface CeldaX { v: string | number; relleno?: Relleno; formatoId?: number }
type Fila = Array<string | number | CeldaX | null>;

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = TABLA_CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipSinCompresion(archivos: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  for (const [nombre, texto] of Object.entries(archivos)) {
    const n = enc.encode(nombre);
    const d = enc.encode(texto);
    const crc = crc32(d);
    const local = Uint8Array.from([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(d.length), ...u32(d.length), ...u16(n.length), ...u16(0), ...n, ...d,
    ]);
    central.push(Uint8Array.from([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(d.length), ...u32(d.length), ...u16(n.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...n,
    ]));
    partes.push(local);
    offset += local.length;
  }
  const tamCentral = central.reduce((a, b) => a + b.length, 0);
  const fin = Uint8Array.from([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length),
    ...u32(tamCentral), ...u32(offset), ...u16(0),
  ]);
  const total = new Uint8Array(offset + tamCentral + fin.length);
  let p = 0;
  for (const x of [...partes, ...central, fin]) { total.set(x, p); p += x.length; }
  return total;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function letra(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function construirXlsx(filas: Fila[], opciones: { conEstilos?: boolean } = {}): Uint8Array {
  const conEstilos = opciones.conEstilos ?? true;
  const rellenos: string[] = [];
  const xfs: Array<{ fill: number; fmt: number }> = [{ fill: 0, fmt: 0 }];
  const estiloDe = (relleno: Relleno | undefined, fmt: number): number => {
    if (!conEstilos || (!relleno && !fmt)) return 0;
    let fill = 0;
    if (relleno) {
      let i = rellenos.indexOf(relleno);
      if (i === -1) { rellenos.push(relleno); i = rellenos.length - 1; }
      fill = i + 2;
    }
    let x = xfs.findIndex((q) => q.fill === fill && q.fmt === fmt);
    if (x === -1) { xfs.push({ fill, fmt }); x = xfs.length - 1; }
    return x;
  };

  const filasXml = filas.map((fila, r) => {
    const celdas = fila.map((c, i) => {
      if (c === null || c === '') return '';
      const o: CeldaX = typeof c === 'object' ? c : { v: c };
      const ref = `${letra(i)}${r + 1}`;
      const s = estiloDe(o.relleno, o.formatoId ?? 0);
      const attr = s ? ` s="${s}"` : '';
      return typeof o.v === 'number'
        ? `<c r="${ref}"${attr}><v>${o.v}</v></c>`
        : `<c r="${ref}"${attr} t="inlineStr"><is><t>${esc(o.v)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${celdas}</row>`;
  }).join('');

  const hoja = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${filasXml}</sheetData></worksheet>`;
  const estilos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="${rellenos.length + 2}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${rellenos.map((a) => `<fill><patternFill patternType="solid"><fgColor ${a}/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.map((x) => `<xf numFmtId="${x.fmt}" fontId="0" fillId="${x.fill}" borderId="0" xfId="0"${x.fill ? ' applyFill="1"' : ''}${x.fmt ? ' applyNumberFormat="1"' : ''}/>`).join('')}</cellXfs></styleSheet>`;

  return zipSinCompresion({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Programa" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': estilos,
    'xl/worksheets/sheet1.xml': hoja,
  });
}

// ---------------------------------------------------------------------------
// Programa sintético: una sección de exportación y una de importación.

const ENC = ['#', 'SUC', 'TIPO DE VIAJE', 'ORIGEN-DESTINO', 'CLIENTE', 'CONSIGNATARIO', 'LINEA', 'CAJA',
  'COMENTARIOS', 'CITA', 'CITA LIMITE', 'UNIDAD', 'COMENTARIOS', 'TRANSITO', 'CCP', 'ASIGNACION', 'SALIO'];
const IDX_UNIDAD = ENC.indexOf('UNIDAD');

function datos(n: number, caja: string | CeldaX, unidad: CeldaX | string | null, extra: Partial<Record<string, string | number | CeldaX>> = {}): Fila {
  const f: Fila = new Array(17).fill(null);
  f[0] = n; f[1] = 'GDL'; f[2] = 'EXPO'; f[3] = 'NLD-GDL'; f[4] = 'CLIENTE DE PRUEBA';
  f[5] = 'CONSIGNATARIO DE PRUEBA'; f[6] = 'LINEA UNO'; f[7] = caja; f[IDX_UNIDAD] = unidad;
  for (const [k, v] of Object.entries(extra)) f[ENC.indexOf(k)] = v ?? null;
  return f;
}

const ROSA = 'rgb="FFFF99CC"';
const GRIS = 'rgb="FFD9D9D9"';
const AMARILLO = 'rgb="FFFFFF00"';

function programa(): Fila[] {
  return [
    ['EXPORTACION 05 DE OCTUBRE 2026'],
    ENC,
    datos(1, 'CAJA-001', { v: 'U-100', relleno: ROSA }),
    datos(2, 'CAJA-002', { v: 'U-101', relleno: GRIS }),
    datos(3, 'CAJA-003', { v: 'U-102', relleno: AMARILLO }),
    datos(4, 'CAJA-004', 'U-103'),
    [],
    ['IMPORTACION 05 DE OCTUBRE 2026'],
    ENC,
    datos(1, 'CAJA-101', { v: 'U-200', relleno: ROSA }, { TRANSITO: 'PATIO NLD' }),
  ];
}

const T = { terminal: 'GDL' };

describe('leerProgramaXlsx · colores', () => {
  it('lee el relleno de la celda UNIDAD como #RRGGBB (rosa, gris, amarillo) y null sin relleno', () => {
    const r = leerProgramaXlsx(construirXlsx(programa()), T);
    expect(r.conRellenos).toBe(true);
    expect(r.filas.map((f) => f.celdas.CAJA)).toEqual(['CAJA-001', 'CAJA-002', 'CAJA-003', 'CAJA-004', 'CAJA-101']);
    expect(r.filas.map((f) => f.color)).toEqual(['#FF99CC', '#D9D9D9', '#FFFF00', null, '#FF99CC']);
    expect(r.filas[0].colores).toEqual({ UNIDAD: '#FF99CC' });
    expect(r.filas[3].colores).toEqual({});
  });

  it('guarda el color de cualquier columna por su nombre normalizado', () => {
    const f = datos(1, { v: 'CAJA-009', relleno: GRIS }, null);
    const filas: Fila[] = [['EXPORTACION 05 DE OCTUBRE 2026'], ENC, f];
    const r = leerProgramaXlsx(construirXlsx(filas), T);
    expect(r.filas[0].colores).toEqual({ CAJA: '#D9D9D9' });
    expect(r.filas[0].color).toBeNull();
  });

  it('un libro sin estilos devuelve color=null en todo y no falla', () => {
    const r = leerProgramaXlsx(construirXlsx(programa(), { conEstilos: false }), T);
    expect(r.conRellenos).toBe(false);
    expect(r.filas).toHaveLength(5);
    for (const f of r.filas) {
      expect(f.color).toBeNull();
      expect(f.colores).toEqual({});
    }
  });

  it('normaliza ARGB, RGB, tema con tinte e indexado', () => {
    expect(normalizarColorXlsx({ rgb: 'FFFF99CC' })).toBe('#FF99CC');
    expect(normalizarColorXlsx({ rgb: 'ff99cc' })).toBe('#FF99CC');
    expect(normalizarColorXlsx({ theme: 5 })).toBe('#ED7D31');
    expect(normalizarColorXlsx({ theme: 0, tint: -0.5 })).toBe('#808080');
    expect(normalizarColorXlsx({ indexed: 45 })).toBe('#FF99CC');
    expect(normalizarColorXlsx({ indexed: 999 })).toBeNull();
    expect(normalizarColorXlsx({ rgb: 'zzz' })).toBeNull();
    expect(normalizarColorXlsx(undefined)).toBeNull();
  });

  it('un relleno de tema se lee desde el archivo', () => {
    const filas: Fila[] = [
      ['EXPORTACION 05 DE OCTUBRE 2026'], ENC,
      datos(1, 'CAJA-001', { v: 'U-100', relleno: 'theme="5"' }),
    ];
    const r = leerProgramaXlsx(construirXlsx(filas), T);
    expect(r.filas[0].color).toBe('#ED7D31');
  });
});

describe('leerProgramaXlsx · mismo contrato que el CSV', () => {
  it('produce las mismas secciones, filas y números de línea que el CSV equivalente', () => {
    const filas = programa();
    const csv = filas.map((f) => f.map((c) => (c === null ? '' : typeof c === 'object' ? c.v : c)).join(';')).join('\n');
    const base = leerProgramaCsv(csv, T);
    const r = leerProgramaXlsx(construirXlsx(filas), T);
    expect(r.secciones).toEqual(base.secciones);
    expect(r.avisos).toEqual(base.avisos);
    expect(r.resumen).toEqual(base.resumen);
    expect(r.filas.map(({ color: _c, colores: _cs, ...resto }) => resto)).toEqual(base.filas);
    // lineaCsv = número de fila de Excel
    expect(r.filas[0].lineaCsv).toBe(3);
    expect(r.secciones[1].lineaTitulo).toBe(8);
  });

  it('una cita con formato de fecha sale como el texto «d/m/aaaa h:mm» que entiende el normalizador', () => {
    // 46300.35416… = 05/10/2026 08:30 (serial de Excel 1900).
    const serial = 46300 + (8 * 60 + 30) / 1440;
    const filas: Fila[] = [
      ['EXPORTACION 05 DE OCTUBRE 2026'], ENC,
      datos(1, 'CAJA-001', 'U-100', { CITA: { v: serial, formatoId: 22 } }),
    ];
    const r = leerProgramaXlsx(construirXlsx(filas), T);
    expect(r.filas[0].celdas.CITA).toBe('5/10/2026 8:30');
  });

  it('un delimitador dentro de una celda no desplaza las columnas', () => {
    const filas: Fila[] = [
      ['EXPORTACION 05 DE OCTUBRE 2026'], ENC,
      datos(1, 'CAJA-001', 'U-100', { COMENTARIOS: 'uno; dos' }),
    ];
    const r = leerProgramaXlsx(construirXlsx(filas), T);
    expect(r.filas[0].celdas.COMENTARIOS).toBe('uno dos');
    expect(r.filas[0].celdas.UNIDAD).toBe('U-100');
  });
});

describe('leerProgramaXlsx · errores llanos', () => {
  it('un archivo que no es Excel dice que no se pudo abrir', () => {
    expect(() => leerProgramaXlsx(new TextEncoder().encode('esto no es un xlsx'), T))
      .toThrowError(ErrorLectorPrograma);
  });

  it('un archivo vacío', () => {
    expect(() => leerProgramaXlsx(new Uint8Array(0), T)).toThrowError(/vacío/);
  });

  it('una hoja sin la fila de encabezados', () => {
    const filas: Fila[] = [['hola', 'mundo'], ['uno', 'dos']];
    expect(() => leerProgramaXlsx(construirXlsx(filas), T)).toThrowError(/encabezados/);
  });

  it('pide una hoja que no existe', () => {
    expect(() => leerProgramaXlsx(construirXlsx(programa()), { ...T, hoja: 'Otra' })).toThrowError(/Otra/);
  });
});
