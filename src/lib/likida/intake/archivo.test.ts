import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { leerArchivoUniversal, ArchivoNoSoportado, ArchivoDemasiadoGrande, MAX_EXTRACTO } from './archivo';
import { crearZip } from '../buzon/zip_escribir';
import { crc32 } from 'node:zlib';

/** Zip mínimo (entradas sin comprimir) que CONSERVA las rutas: `crearZip` aplana los nombres y un .xlsx necesita `xl/…`. */
function zipConRutas(entradas: Array<{ nombre: string; bytes: Buffer }>): Buffer {
  const partes: Buffer[] = []; const centrales: Buffer[] = []; let offset = 0;
  for (const e of entradas) {
    const n = Buffer.from(e.nombre); const crc = crc32(e.bytes) >>> 0;
    const loc = Buffer.alloc(30 + n.length);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt32LE(crc, 14);
    loc.writeUInt32LE(e.bytes.length, 18); loc.writeUInt32LE(e.bytes.length, 22); loc.writeUInt16LE(n.length, 26); n.copy(loc, 30);
    const cen = Buffer.alloc(46 + n.length);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(e.bytes.length, 20); cen.writeUInt32LE(e.bytes.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(offset, 42); n.copy(cen, 46);
    partes.push(loc, e.bytes); centrales.push(cen); offset += loc.length + e.bytes.length;
  }
  const dir = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(entradas.length, 8); fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(dir.length, 12); fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...partes, dir, fin]);
}

describe('leerArchivoUniversal — el lector del chat', () => {
  it('lee un Excel: hojas, filas y extracto tabulado', async () => {
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([
      ['Concepto', 'Monto'], ['Diésel', 8340.5], ['Casetas', 1200],
    ]), 'Gastos');
    const buf = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const r = await leerArchivoUniversal('gastos.xlsx', buf);
    expect(r.clase).toBe('hoja');
    expect(r.extracto).toContain('Diésel | 8340.5');
    expect(r.meta).toContainEqual(['Filas', 3]);
  });

  it('lee un CSV por la misma vía', async () => {
    const r = await leerArchivoUniversal('viajes.csv', Buffer.from('folio,anticipo\nF-1,8000\nF-2,5500\n'));
    expect(r.clase).toBe('hoja');
    expect(r.extracto).toContain('F-1 | 8000');
  });

  it('recorta el texto gigante y lo DICE (nunca lectura silenciosamente parcial)', async () => {
    const r = await leerArchivoUniversal('log.txt', Buffer.from('x'.repeat(MAX_EXTRACTO * 2)));
    expect(r.extracto.length).toBeLessThanOrEqual(MAX_EXTRACTO + 60);
    expect(r.extracto).toContain('[recortado');
  });

  it('un XML de CFDI extrae los campos que importan', async () => {
    const xml = `<cfdi:Comprobante Total="1855.00" Fecha="2026-08-10T11:22:33"><cfdi:Emisor Rfc="ABC123456XYZ"/><cfdi:Receptor Rfc="DEF987654ABC"/><tfd:TimbreFiscalDigital UUID="11111111-2222-3333-4444-555555555555"/></cfdi:Comprobante>`;
    const r = await leerArchivoUniversal('factura.xml', Buffer.from(xml));
    expect(r.clase).toBe('cfdi');
    expect(r.meta).toContainEqual(['Total', '1855.00']);
    expect(r.meta).toContainEqual(['RFC emisor', 'ABC123456XYZ']);
  });

  it('lee un PDF REAL generado con pdf-lib', async () => {
    const doc = await PDFDocument.create();
    const fuente = await doc.embedFont(StandardFonts.Helvetica);
    const pagina = doc.addPage();
    pagina.drawText('Estado de cuenta TAG - total del periodo 4520.75 MXN en casetas de la ruta Silao Monterrey', { x: 40, y: 700, size: 12, font: fuente });
    const buf = Buffer.from(await doc.save());
    const r = await leerArchivoUniversal('estado-tag.pdf', buf);
    expect(r.clase).toBe('pdf');
    expect(r.extracto).toContain('4520.75');
    expect(r.meta).toContainEqual(['Páginas leídas', 1]);
  }, 20_000);

  it('lo que no conoce lo rechaza con nombre, no lo finge', async () => {
    await expect(leerArchivoUniversal('video.mp4', Buffer.from('x'))).rejects.toBeInstanceOf(ArchivoNoSoportado);
  });

  // A37-S10-04
  it('A37-S10-04: una hoja de miles de filas se lee solo hasta el tope, pero el total de filas se informa', async () => {
    const aoa: Array<Array<string | number>> = [['n', 'v']];
    for (let i = 1; i <= 5000; i++) aoa.push([i, i * 2]);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(aoa), 'Grande');
    const r = await leerArchivoUniversal('grande.xlsx', XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    expect(r.meta).toContainEqual(['Filas', 5001]);
    expect(r.extracto).toContain('5001 filas, primeras 60');
    expect(r.extracto).not.toContain('4000 | 8000');
  });

  it('A37-S10-04: un .xlsx cuya hoja se descomprime a decenas de MB (bomba) se rechaza ANTES de parsear', async () => {
    const hojaGigante = Buffer.concat([Buffer.from('<worksheet><sheetData>'), Buffer.alloc(30 * 1024 * 1024, 0x20), Buffer.from('</sheetData></worksheet>')]);
    const zip = crearZip([
      { nombre: '[Content_Types].xml', bytes: Buffer.from('<Types/>') },
      { nombre: 'xl/worksheets/sheet1.xml', bytes: hojaGigante },
    ]);
    await expect(leerArchivoUniversal('bomba.xlsx', zip)).rejects.toBeInstanceOf(ArchivoDemasiadoGrande);
  });

  it('A37-S10-04: un .xlsx de pocos KB que DECLARA la dimensión A1:XFD1048576 se lee en segundos, no materializa millones de filas', async () => {
    const p = (nombre: string, xml: string) => ({ nombre, bytes: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${xml}`) });
    const NS = 'http://schemas.openxmlformats.org/';
    const entradas = [
      p('[Content_Types].xml', `<Types xmlns="${NS}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
      p('_rels/.rels', `<Relationships xmlns="${NS}package/2006/relationships"><Relationship Id="rId1" Type="${NS}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
      p('xl/workbook.xml', `<workbook xmlns="${NS}spreadsheetml/2006/main" xmlns:r="${NS}officeDocument/2006/relationships"><sheets><sheet name="H" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      p('xl/_rels/workbook.xml.rels', `<Relationships xmlns="${NS}package/2006/relationships"><Relationship Id="rId1" Type="${NS}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
      // La dimensión DECLARADA es la máxima de Excel; las celdas reales son 2 filas.
      p('xl/worksheets/sheet1.xml', `<worksheet xmlns="${NS}spreadsheetml/2006/main"><dimension ref="A1:XFD1048576"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="B1" t="inlineStr"><is><t>b</t></is></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>2</v></c></row></sheetData></worksheet>`),
    ];
    const falso = zipConRutas(entradas);
    const t0 = Date.now();
    const r = await leerArchivoUniversal('declarada.xlsx', falso);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(r.clase).toBe('hoja');
    expect(r.extracto).toContain('a | b');
  }, 20_000);
});
