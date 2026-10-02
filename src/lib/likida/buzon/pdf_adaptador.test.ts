import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { crearPuertosPdf } from './pdf_adaptador';
import { leerPdfFactura } from './pdf_factura';

// El adaptador REAL de texto sobre un PDF REAL (generado con pdf-lib): lo único que se sustituye en el resto de
// las pruebas es el lector de visión. Aquí no se toca el modelo.

const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

async function pdfConTexto(lineas: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  const pagina = doc.addPage([600, 800]);
  lineas.forEach((l, i) => pagina.drawText(l, { x: 40, y: 750 - i * 20, size: 11, font: fuente }));
  return doc.save();
}

describe('crearPuertosPdf — texto real', () => {
  it('lee la capa de texto de un PDF real y la factura sale por la vía de texto, sin visión', async () => {
    const pdf = await pdfConTexto([
      `Folio fiscal: ${UUID}`, 'RFC Emisor: AAA010101AAA', 'RFC Receptor: BBB010101BBB', 'Subtotal $1,000.00', 'Total $1,160.00',
    ]);
    const puertos = crearPuertosPdf('t-1');
    const r = await leerPdfFactura(pdf, puertos, { signal: AbortSignal.timeout(20_000) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.datos).toMatchObject({ uuid: UUID, total: 1160, fuente: 'pdf_texto' });
  }, 30_000);

  it('un PDF CORRUPTO (cabecera buena, cuerpo basura) se dice corrupto, sin lanzar', async () => {
    const corrupto = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('esto no es un pdf de verdad '.repeat(50))]);
    const r = await leerPdfFactura(corrupto, crearPuertosPdf('t-1'), { signal: AbortSignal.timeout(20_000) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(['corrupto', 'ilegible', 'sin_imagenes']).toContain(r.motivo);
  }, 30_000);

  it('un PDF truncado a la mitad tampoco tumba nada', async () => {
    const pdf = await pdfConTexto([`Folio fiscal: ${UUID}`, 'Total $10.00']);
    const r = await leerPdfFactura(pdf.subarray(0, Math.floor(pdf.length / 2)), crearPuertosPdf('t-1'), { signal: AbortSignal.timeout(20_000) });
    expect(r.ok).toBe(false);
  }, 30_000);
});
