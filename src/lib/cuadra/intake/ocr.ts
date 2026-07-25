// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO 1 — INTAKE / OCR de comprobantes.
//
// Fusiona visión + extracción JSON en UNA llamada (Gemini Flash con schema).
// Estrategia de precisión (de la investigación):
//   1. Pedir confianza por documento + "legible": bool → alimenta el umbral.
//   2. Decodificar el QR del CFDI y SOBRESCRIBIR uuid/rfc/total del OCR con el
//      del QR (0% de error vs leer 36 chars con visión).
//   3. Validar RFC/UUID por regex (el JSON válido no garantiza el valor).
// ═══════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { generateStructured } from '@/lib/llm/openrouter';
import { decodeCfdiFromImage, bufferFromDataUrl, esRfcValido, esUuidValido } from './cfdi';
import type { Gasto, ConceptoGasto } from '@/types/cuadra';

const ExtraccionSchema = z.object({
  concepto: z.enum(['diesel', 'caseta', 'factura', 'viaticos', 'otro']),
  monto: z.number().nullable(),
  fecha: z.string().nullable(),
  folio: z.string().nullable(),
  rfc_emisor: z.string().nullable(),
  cfdi_uuid: z.string().nullable(),
  confianza: z.number().min(0).max(1),
  legible: z.boolean(),
});

const SYSTEM = `Eres un extractor de datos de comprobantes de gasto de transporte en México (tickets de diésel, casetas, facturas CFDI). Extrae los campos de la imagen a JSON.

REGLAS DURAS:
- Si un campo NO es claramente legible, devuélvelo null. NUNCA inventes montos, folios, RFC ni UUID.
- "confianza" = qué tan seguro estás de haber leído bien monto y folio (0 a 1).
- "legible": false si la foto está tan borrosa/cortada que no confías en el monto.
- concepto: diesel (combustible/gasolinera), caseta (peaje/autopista), factura (CFDI/factura fiscal), viaticos (comida/hospedaje), otro.
- monto: el TOTAL del comprobante, solo el número.`;

export interface ExtraerResultado {
  gasto: Gasto;
  legible: boolean;
  // Costo de la llamada de visión (para el contador por liquidación).
  costo: { modelo: string; tokensIn: number; tokensOut: number; costoUsd: number };
}

/** Extrae un comprobante de una imagen (data-URL). Cruza OCR + QR CFDI. */
export async function extraerComprobante(imageDataUrl: string): Promise<ExtraerResultado> {
  const res = await generateStructured({
    role: 'ocr',
    system: SYSTEM,
    messages: [{ role: 'user', content: 'Extrae los datos de este comprobante.' }],
    images: [imageDataUrl],
    schema: ExtraccionSchema,
    schemaName: 'comprobante',
  });
  const { data } = res;

  // Cruce con el QR del CFDI (gana sobre el OCR para campos fiscales).
  let uuid = data.cfdi_uuid && esUuidValido(data.cfdi_uuid) ? data.cfdi_uuid.toLowerCase() : undefined;
  let rfc = data.rfc_emisor && esRfcValido(data.rfc_emisor) ? data.rfc_emisor.toUpperCase() : undefined;
  let monto = data.monto ?? 0;
  let cfdiValido: boolean | undefined;

  try {
    const qr = await decodeCfdiFromImage(bufferFromDataUrl(imageDataUrl));
    if (qr) {
      if (qr.uuid) uuid = qr.uuid;
      if (qr.rfcEmisor) rfc = qr.rfcEmisor;
      if (qr.total != null) monto = qr.total; // el total del QR es autoritativo
      cfdiValido = true; // QR presente y parseado = CFDI verificable
    }
  } catch {
    // sin QR — se queda con lo del OCR
  }

  const gasto: Gasto = {
    id: randomUUID(),
    concepto: data.concepto as ConceptoGasto,
    monto,
    fecha: data.fecha ?? undefined,
    folio: data.folio ?? undefined,
    rfcEmisor: rfc,
    cfdiUuid: uuid,
    imagenUrl: undefined,
    ocrConfianza: data.confianza,
    cfdiValido,
  };

  return {
    gasto,
    legible: data.legible && monto > 0,
    costo: { modelo: res.model, tokensIn: res.tokensIn, tokensOut: res.tokensOut, costoUsd: res.cost },
  };
}
