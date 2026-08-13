import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { leerArchivoUniversal, ArchivoNoSoportado, MAX_EXTRACTO } from './archivo';

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
});
