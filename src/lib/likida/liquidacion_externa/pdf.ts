// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN EXTERNA — el PDF que Likida genera cuando el cliente NO adjunta
// el suyo. Determinístico, sin LLM, y con UNA regla: se imprimen las cifras del
// cliente tal cual llegaron. Ni se recalculan ni se «corrigen».
//
// Dice de dónde vienen (`Calculada por …`) y que Likida solo la entrega: el
// papel que ve el chofer no puede insinuar que Likida verificó un cálculo que
// no hizo. Lo único que Likida comprobó —y el documento lo dice— es que el
// total sea la suma de los renglones (esquema.ts).
// ═══════════════════════════════════════════════════════════════════════════

import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { dinero, periodoTexto } from './presentacion';
import type { LiquidacionExternaNormalizada } from './esquema';

const INK = rgb(0.06, 0.06, 0.09);
const MUTED = rgb(0.45, 0.47, 0.52);
const HAIRLINE = rgb(0.88, 0.89, 0.91);
const PANEL = rgb(0.955, 0.957, 0.965);

const A4: [number, number] = [595.28, 841.89];
const M = 48;
const PISO = 70;

/** WinAnsi no codifica todo Unicode, y estos textos vienen de un sistema ajeno:
 *  un solo carácter fuera de Latin-1 haría que `drawText` lanzara. */
function wa(s: string): string {
  return s
    .replace(/→/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/[\u007F-\u009F]/g, '?')
    .replace(/[^ -ÿ–—•€]/g, '?');
}

function cortar(s: string, ancho: number, f: PDFFont, size: number): string {
  const v = wa(s);
  if (f.widthOfTextAtSize(v, size) <= ancho) return v;
  let lo = 0, hi = v.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (f.widthOfTextAtSize(`${v.slice(0, mid)}...`, size) <= ancho) lo = mid; else hi = mid - 1;
  }
  return `${v.slice(0, lo)}...`;
}

/** Parte un texto en líneas que caben en `ancho`, midiendo con la fuente real:
 *  el descargo no se recorta, se envuelve (un descargo cortado a medias es peor
 *  que ninguno). */
function envolver(s: string, ancho: number, f: PDFFont, size: number): string[] {
  const lineas: string[] = [];
  let actual = '';
  for (const p of wa(s).split(/\s+/).filter(Boolean)) {
    const tentativa = actual ? `${actual} ${p}` : p;
    if (f.widthOfTextAtSize(tentativa, size) <= ancho) { actual = tentativa; continue; }
    if (actual) lineas.push(actual);
    actual = f.widthOfTextAtSize(p, size) <= ancho ? p : cortar(p, ancho, f, size);
  }
  if (actual) lineas.push(actual);
  return lineas.length ? lineas : [''];
}

export interface DatosPdfExterno {
  liquidacion: LiquidacionExternaNormalizada;
  operadorNombre: string;
  razonSocial?: string | null;
}

export async function generarPdfLiquidacionExterna(d: DatosPdfExterno): Promise<Uint8Array> {
  const liq = d.liquidacion;
  const doc = await PDFDocument.create();
  doc.setTitle(wa(`Liquidación ${liq.claveExterna}`));
  doc.setProducer('Likida');
  // Fechas fijas: el mismo contenido da los mismos bytes, que es lo que permite
  // subirlo a una ruta direccionada por contenido sin que dos peticiones
  // concurrentes se pisen con documentos distintos.
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));

  let page = doc.addPage(A4);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 800;

  const text = (s: string, x: number, yy: number, size: number, f: PDFFont, color = INK) =>
    page.drawText(wa(s), { x, y: yy, size, font: f, color });
  const right = (s: string, xRight: number, yy: number, size: number, f: PDFFont, color = INK) => {
    const v = wa(s);
    page.drawText(v, { x: xRight - f.widthOfTextAtSize(v, size), y: yy, size, font: f, color });
  };
  const rule = (yy: number, color = HAIRLINE, grosor = 0.75) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: A4[0] - M, y: yy }, thickness: grosor, color });
  const asegurar = (alto: number): boolean => {
    if (y - alto >= PISO) return false;
    page = doc.addPage(A4);
    y = 800;
    return true;
  };

  // Encabezado: el papel es de la flota; sin razón social se conserva «Likida»
  // (un nombre nunca se inventa en un documento que se archiva).
  const encabezado = d.razonSocial?.trim() || null;
  text(encabezado ?? 'Likida', M, y, encabezado ? 17 : 20, bold);
  right('LIQUIDACIÓN', A4[0] - M, y + 5, 9, bold, MUTED);
  right(`Folio ${liq.claveExterna}`, A4[0] - M, y - 9, 9, bold);
  y -= 30;
  rule(y, INK, 1.4);
  rule(y - 3);
  y -= 28;

  const kv = (label: string, value: string, x: number, yy: number) => {
    text(label.toUpperCase(), x, yy, 7.5, bold, MUTED);
    text(cortar(value, 230, font, 11), x, yy - 13, 11, font);
  };
  kv('Operador', d.operadorNombre, M, y);
  kv('Periodo', periodoTexto(liq.periodo.desde, liq.periodo.hasta), 320, y);
  y -= 34;
  kv('Viajes', cortar(liq.viajes.join(', '), 230, font, 11), M, y);
  kv('Moneda', liq.moneda, 320, y);
  y -= 40;

  // Renglones
  text('CONCEPTOS', M, y, 8, bold, MUTED);
  y -= 6;
  rule(y);
  y -= 18;
  const cabecera = () => {
    page.drawRectangle({ x: M - 6, y: y - 5, width: A4[0] - 2 * M + 12, height: 16, color: PANEL });
    text('Concepto', M, y, 8, bold, MUTED);
    text('Tipo', 360, y, 8, bold, MUTED);
    right('Monto', A4[0] - M, y, 8, bold, MUTED);
    y -= 16;
  };
  cabecera();
  for (const c of liq.conceptos) {
    if (asegurar(20)) cabecera();
    const etiqueta = c.clave ? `${c.clave} · ${c.descripcion}` : c.descripcion;
    text(cortar(etiqueta, 300, font, 10), M, y, 10, font);
    text(c.tipo === 'percepcion' ? 'Percepción' : 'Deducción', 360, y, 9, font, MUTED);
    // El signo se imprime: el monto del contrato es positivo y lo da el tipo,
    // pero en papel el chofer lee «−$200.00», no tiene el contrato.
    const signo = c.tipo === 'deduccion' ? '-' : '';
    right(`${signo}${dinero(c.monto, liq.moneda)}`, A4[0] - M, y, 10, font);
    y -= 18;
  }

  asegurar(60);
  y -= 4;
  rule(y, INK, 1);
  y -= 22;
  text('TOTAL', M, y, 11, bold);
  right(dinero(liq.total, liq.moneda), A4[0] - M, y, 13, bold);
  y -= 34;

  // Pie: de dónde viene y qué hizo Likida.
  const origen = liq.sistemaOrigen ? `calculada por ${liq.sistemaOrigen}` : 'calculada por el sistema de tu empresa';
  const pie = [
    `Liquidación ${origen}. Likida solo la entrega: no la recalcula ni la modifica.`,
    'Likida comprobó únicamente que el total sea la suma de los conceptos que aparecen arriba.',
    'Si algo no coincide con lo que esperabas, respóndele «No coincide» al mensaje de WhatsApp y avísale a tu oficina.',
  ];
  for (const parrafo of pie) {
    for (const linea of envolver(parrafo, A4[0] - 2 * M, font, 7.5)) {
      asegurar(12);
      text(linea, M, y, 7.5, font, MUTED);
      y -= 11;
    }
  }

  return doc.save();
}
