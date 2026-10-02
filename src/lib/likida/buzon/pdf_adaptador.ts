import { randomUUID } from 'node:crypto';
import { createLlmBudget } from '@/lib/llm/budget';
import { aBuffer } from './bytes';
import type { PuertosPdf, LecturaVision } from './pdf_factura';

// ═══════════════════════════════════════════════════════════════════════════
// LOS PUERTOS REALES DEL PDF: `pdf-parse` (texto y rendido a imagen) y el lector de
// visión del producto (`extraerComprobante`, con su presupuesto de IA cobrado a la
// flota). Todo con import dinámico: ni el texto ni el rendido ni la visión se cargan
// hasta que un PDF llega al buzón. Las pruebas de la orquestación usan dobles; la
// lectura de texto sobre un PDF real se prueba en pdf_adaptador.test.ts.
// ═══════════════════════════════════════════════════════════════════════════

const MAX_PAGINAS_TEXTO = 5;
const MAX_PAGINAS_IMAGEN = 2;

export function crearPuertosPdf(tenantId: string): PuertosPdf {
  return {
    async leerTexto(bytes) {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: aBuffer(bytes) });
      try {
        const r = await parser.getText({ first: MAX_PAGINAS_TEXTO });
        return { ok: true, texto: r.text ?? '' };
      } catch (e) {
        const nombre = e instanceof Error ? `${e.name} ${e.message}` : '';
        return { ok: false, motivo: /password/i.test(nombre) ? 'protegido' : 'corrupto' };
      } finally {
        await parser.destroy().catch(() => {});
      }
    },

    async imagenes(bytes) {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: aBuffer(bytes) });
      try {
        const s = await parser.getScreenshot({ first: MAX_PAGINAS_IMAGEN, desiredWidth: 1400, imageDataUrl: true, imageBuffer: false });
        return (s.pages ?? []).map((p: { dataUrl?: string }) => p.dataUrl).filter((u: string | undefined): u is string => !!u);
      } catch {
        return [];
      } finally {
        await parser.destroy().catch(() => {});
      }
    },

    async vision(imagenes, signal): Promise<LecturaVision> {
      const { extraerComprobante } = await import('../intake/ocr');
      // Mismo patrón que `ingresarFacturaDesdeFoto`: la visión gasta contra el tope diario del tenant.
      const r = await extraerComprobante(imagenes, signal, createLlmBudget(tenantId, randomUUID(), 'interactivo'));
      const g = r.gasto;
      return {
        legible: r.legible,
        uuid: g.cfdiUuid ?? null,
        monto: g.monto,
        subTotal: typeof g.subTotal === 'number' ? g.subTotal : null,
        rfcEmisor: g.rfcEmisor ?? null,
        rfcReceptor: g.rfcReceptor ?? null,
        fecha: g.fecha ?? null,
        confianza: typeof g.ocrConfianza === 'number' ? g.ocrConfianza : null,
      };
    },
  };
}
