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
import { logger } from '@/lib/logger';
import { generateStructured } from '@/lib/llm/openrouter';
import { decodeCfdiFromImage, bufferFromDataUrl, esRfcValido, esUuidValido } from './cfdi';
import { normalizarFecha } from './fecha';
import { consultarCFDI } from './sat';
import type { Gasto, ConceptoGasto, EstadoSat } from '@/types/cuadra';

const ExtraccionSchema = z.object({
  concepto: z.enum(['diesel', 'caseta', 'factura', 'viaticos', 'otro']),
  producto: z.string().nullable(),        // "Diesel", "Regular", "Premium", "GSuper", "Magna"
  monto: z.number().nullable(),           // TOTAL
  subtotal: z.number().nullable(),        // si viene desglosado
  iva_monto: z.number().nullable(),       // IVA en pesos, TAL CUAL aparece (no lo calcules)
  iva_tasa: z.number().nullable(),        // tasa LEÍDA en el ticket (0.16, 0.08), o null si no aparece
  litros: z.number().nullable(),
  precio_unitario: z.number().nullable(),
  forma_pago: z.enum(['efectivo', 'tarjeta', 'otro']).nullable(),
  fecha: z.string().nullable(),
  folio: z.string().nullable(),           // CRUDO, tal cual (conserva ceros a la izquierda)
  web_id: z.string().nullable(),          // string (numérico o alfanumérico)
  estacion: z.string().nullable(),        // nombre/# de estación
  rfc_emisor: z.string().nullable(),
  cfdi_uuid: z.string().nullable(),
  confianza: z.number().min(0).max(1),
  legible: z.boolean(),
});

const SYSTEM = `Eres un extractor de datos de comprobantes de gasto de transporte en México (tickets de gasolinera de diésel/gasolina, casetas, facturas CFDI). Extrae los campos de la imagen a JSON.

REGLAS DURAS:
- Si un campo NO es claramente legible, devuélvelo null. NUNCA inventes ni CALCULES: montos, folios, RFC, UUID, IVA ni tasas. Lee lo que está impreso.
- "confianza" = qué tan seguro estás de haber leído bien el monto y el folio (0 a 1).
- "legible": false si la foto está tan borrosa/cortada que no confías en el monto.
- concepto: diesel (combustible/gasolinera, sea diésel o gasolina), caseta (peaje/autopista), factura (CFDI fiscal), viaticos (comida/hospedaje), otro.
- monto: el TOTAL del comprobante, solo el número.

MAPEO DE ETIQUETAS (mapea el CONCEPTO, no la etiqueta literal; varían por estación):
- folio ← "FOLIO" / "NOTA" / "NUM VENTA" / "NUM. VENTA".
- web_id ← "WEB ID" / "WebID" (trátalo como string; puede ser numérico "65038155" o alfanumérico "006A").
- estacion ← "ESTACION" / "EST" / "EST.".
- litros ← "LITROS" / "CANTIDAD" / "CANT-LTS" / "CANT/LTS" / "U.M." (la cantidad en litros).
- forma_pago ← "FORMA DE PAGO" / "TIPO OPER" / "TIPO DE OPERACION" → 'efectivo' o 'tarjeta'.
- precio_unitario ← "PRECIO" (por litro).

IMPUESTOS (crítico):
- iva_monto: el IVA en pesos TAL CUAL aparece ("IVA:", "IVA 16%:", "8% IVA:"). NO lo calcules.
- iva_tasa: la tasa que aparezca impresa (16% → 0.16; 8% → 0.08). Si el ticket NO muestra tasa ni desglose de IVA, devuelve null. En la franja fronteriza el IVA es 8%: respeta lo impreso.
- subtotal: el que aparezca; si no viene, null.

NO CONFUNDIR: "CLAVE PEMEX 32011" (o similar) es un código INTERNO de producto de la estación, NO el ClaveProdServ del SAT. No lo pongas como folio ni como clave fiscal.`;

export interface ExtraerResultado {
  gasto: Gasto;
  legible: boolean;
  // Costo de la llamada de visión (para el contador por liquidación).
  costo: { modelo: string; tokensIn: number; tokensOut: number; costoUsd: number };
}

/** Extrae un comprobante de una imagen (data-URL). Cruza OCR + QR CFDI. */
export async function extraerComprobante(imageDataUrl: string): Promise<ExtraerResultado> {
  let res: Awaited<ReturnType<typeof generateStructured<z.infer<typeof ExtraccionSchema>>>>;
  try {
    res = await generateStructured({
      role: 'ocr',
      system: SYSTEM,
      messages: [{ role: 'user', content: 'Extrae los datos de este comprobante.' }],
      images: [imageDataUrl],
      schema: ExtraccionSchema,
      schemaName: 'comprobante',
    });
  } catch (e) {
    // Ticket ilegible/cortado/ladeado: el modelo no produjo JSON válido. Degrada
    // elegante → 'no legible' para pedir reenvío, en vez de tumbar el flujo.
    logger.warn('ocr.ilegible', { err: e instanceof Error ? e.message : String(e) });
    return {
      gasto: { id: randomUUID(), concepto: 'otro', monto: 0, ocrConfianza: 0 },
      legible: false,
      costo: { modelo: 'ocr', tokensIn: 0, tokensOut: 0, costoUsd: 0 },
    };
  }
  const { data } = res;

  // Cruce con el QR del CFDI (gana sobre el OCR para campos fiscales).
  let uuid = data.cfdi_uuid && esUuidValido(data.cfdi_uuid) ? data.cfdi_uuid.toLowerCase() : undefined;
  let rfc = data.rfc_emisor && esRfcValido(data.rfc_emisor) ? data.rfc_emisor.toUpperCase() : undefined;
  let rfcReceptor: string | undefined;
  let monto = data.monto ?? 0;
  let cfdiValido: boolean | undefined;

  try {
    const qr = await decodeCfdiFromImage(bufferFromDataUrl(imageDataUrl));
    if (qr) {
      if (qr.uuid) uuid = qr.uuid;
      if (qr.rfcEmisor) rfc = qr.rfcEmisor;
      if (qr.rfcReceptor) rfcReceptor = qr.rfcReceptor; // para validar RFC=empresa
      if (qr.total != null) monto = qr.total; // el total del QR es autoritativo
      cfdiValido = true; // QR presente y parseado = CFDI verificable
    }
  } catch {
    // sin QR — se queda con lo del OCR
  }

  // Consulta al SAT (grácil: si no responde → 'pendiente', nunca lanza).
  let estadoSat: EstadoSat | undefined;
  let efos: boolean | null | undefined;
  let efosRevisar: boolean | undefined;
  if (uuid) {
    const sat = await consultarCFDI({ re: rfc, rr: rfcReceptor, tt: monto, id: uuid });
    estadoSat = sat.estado;
    efos = sat.efos;
    efosRevisar = sat.efosDesconocido;
  }

  // Forma de pago leída → c_FormaPago (para la regla de combustible en efectivo).
  const formaPago = data.forma_pago === 'efectivo' ? '01' : data.forma_pago === 'tarjeta' ? '04' : undefined;
  // Folio: se conserva el CRUDO y el NORMALIZADO sin ceros a la izquierda (los
  // portales de facturación piden el normalizado).
  const folioRaw = data.folio ?? undefined;
  const folioNorm = folioRaw ? folioRaw.replace(/^0+(?=\d)/, '') : undefined;

  const gasto: Gasto = {
    id: randomUUID(),
    concepto: data.concepto as ConceptoGasto,
    monto,
    fecha: normalizarFecha(data.fecha),
    folio: folioRaw,
    folioNorm,
    rfcEmisor: rfc,
    rfcReceptor,
    cfdiUuid: uuid,
    imagenUrl: undefined,
    ocrConfianza: data.confianza,
    cfdiValido,
    estadoSat,
    efos,
    efosRevisar,
    formaPago,
    subTotal: data.subtotal ?? undefined,
    // Datos ricos del ticket (para el aviso de portal, rendimiento y validación).
    // El IVA/subtotal del TICKET NO alimentan el acreditamiento (eso exige XML).
    ocrExtra: {
      producto: data.producto ?? undefined,
      fechaRaw: data.fecha ?? undefined,
      litros: data.litros ?? undefined,
      precioUnitario: data.precio_unitario ?? undefined,
      webId: data.web_id ?? undefined,
      estacion: data.estacion ?? undefined,
      ivaMonto: data.iva_monto ?? undefined,
      ivaTasa: data.iva_tasa ?? undefined,
    },
  };

  return {
    gasto,
    legible: data.legible && monto > 0,
    costo: { modelo: res.model, tokensIn: res.tokensIn, tokensOut: res.tokensOut, costoUsd: res.cost },
  };
}
