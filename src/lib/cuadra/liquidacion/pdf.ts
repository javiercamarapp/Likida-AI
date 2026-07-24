// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO 3 — Generador de PDF de liquidación (determinístico, SIN LLM).
//
// Los datos ya vienen estructurados del cuadre; un LLM aquí solo agrega costo,
// latencia y riesgo de alucinar cifras. Estilo: macOS/Apple premium — neutro,
// hairlines, montos tabulares, diferencias en rojo sutil (ver DESIGN.md).
// ═══════════════════════════════════════════════════════════════════════════

import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import type { Liquidacion, Viaje, Operador, Gasto } from '@/types/cuadra';

// Paleta (Apple) en 0–1 para pdf-lib
const INK = rgb(0.06, 0.06, 0.09);
const MUTED = rgb(0.45, 0.47, 0.52);
const HAIRLINE = rgb(0.88, 0.89, 0.91);
const GREEN = rgb(0.2, 0.78, 0.35);
const RED = rgb(1.0, 0.23, 0.19);
const AMBER = rgb(1.0, 0.62, 0.04);

const CONCEPTO_LABEL: Record<string, string> = {
  diesel: 'Diésel', caseta: 'Caseta', factura: 'Factura', viaticos: 'Viáticos', otro: 'Otro',
};

const mxn = (n: number) =>
  n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const fecha = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/**
 * Genera el PDF de liquidación. Devuelve los bytes listos para enviar por
 * WhatsApp o guardar en storage.
 */
export async function generarLiquidacionPDF(
  liq: Liquidacion,
  viaje: Viaje,
  operador: Operador,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Liquidación ${viaje.folio ?? liq.id.slice(0, 8)}`);
  doc.setProducer('Cuadra');

  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const M = 48;
  let y = 800;

  const text = (s: string, x: number, yy: number, size: number, f: PDFFont, color = INK) =>
    page.drawText(s, { x, y: yy, size, font: f, color });
  const right = (s: string, xRight: number, yy: number, size: number, f: PDFFont, color = INK) =>
    page.drawText(s, { x: xRight - f.widthOfTextAtSize(s, size), y: yy, size, font: f, color });
  const rule = (yy: number, color = HAIRLINE) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: 595.28 - M, y: yy }, thickness: 0.75, color });

  // ─── Encabezado ───────────────────────────────────────────────────────────
  text('Cuadra', M, y, 20, bold, INK);
  right('LIQUIDACIÓN DE VIAJE', 595.28 - M, y + 3, 9, bold, MUTED);
  right(`Folio ${viaje.folio ?? liq.id.slice(0, 8).toUpperCase()}`, 595.28 - M, y - 10, 9, font, MUTED);
  y -= 28;
  rule(y);
  y -= 26;

  // ─── Datos del viaje / operador (dos columnas) ──────────────────────────────
  const col2 = 320;
  const kv = (label: string, value: string, x: number, yy: number) => {
    text(label.toUpperCase(), x, yy, 7.5, bold, MUTED);
    text(value, x, yy - 13, 11, font, INK);
  };
  kv('Operador', operador.nombre, M, y);
  kv('Ruta', `${viaje.origen ?? '—'} → ${viaje.destino ?? '—'}`, col2, y);
  y -= 34;
  kv('Terminal', operador.terminal ?? '—', M, y);
  kv('Periodo', `${fecha(viaje.fechaInicio)} – ${fecha(viaje.fechaFin)}`, col2, y);
  y -= 40;

  // ─── Tabla de gastos comprobados ────────────────────────────────────────────
  text('COMPROBANTES', M, y, 8, bold, MUTED);
  y -= 6;
  rule(y);
  y -= 18;
  const cFolio = M, cConcepto = 150, cFecha = 300, cEstado = 400, cMonto = 595.28 - M;
  text('Concepto', cConcepto, y, 8, bold, MUTED);
  text('Folio', cFolio, y, 8, bold, MUTED);
  text('Fecha', cFecha, y, 8, bold, MUTED);
  text('Estado', cEstado, y, 8, bold, MUTED);
  right('Monto', cMonto, y, 8, bold, MUTED);
  y -= 14;

  const gastoConDif = new Set(liq.diferencias.map((d) => d.gastoId).filter(Boolean));
  for (const g of liq.gastos) {
    const flagged = gastoConDif.has(g.id);
    text(CONCEPTO_LABEL[g.concepto] ?? g.concepto, cConcepto, y, 10, font, INK);
    text(g.folio ?? '—', cFolio, y, 9, font, MUTED);
    text(fecha(g.fecha), cFecha, y, 9, font, MUTED);
    if (flagged) text('● revisar', cEstado, y, 9, font, RED);
    else text('● ok', cEstado, y, 9, font, GREEN);
    right(mxn(g.monto), cMonto, y, 10, font, flagged ? RED : INK);
    y -= 18;
    if (y < 200) break; // demo: una página
  }
  y -= 4;
  rule(y);
  y -= 22;

  // ─── Totales ────────────────────────────────────────────────────────────────
  const totalRow = (label: string, value: string, f: PDFFont, color = INK, size = 11) => {
    text(label, cFecha, y, size, f, color);
    right(value, cMonto, y, size, f, color);
    y -= 20;
  };
  totalRow('Total comprobado', mxn(liq.totalComprobado), font);
  totalRow('Anticipo entregado', mxn(liq.totalAnticipo), font);
  rule(y + 6);
  y -= 4;
  const difColor = liq.diferencia === 0 ? GREEN : liq.diferencia > 0 ? INK : AMBER;
  const difLabel = liq.diferencia > 0 ? 'Diferencia a favor de la empresa'
    : liq.diferencia < 0 ? 'Diferencia a favor del operador' : 'Cuadra exacto';
  totalRow(difLabel, mxn(Math.abs(liq.diferencia)), bold, difColor, 13);

  // ─── Diferencias detectadas ─────────────────────────────────────────────────
  if (liq.diferencias.length) {
    y -= 12;
    text('DIFERENCIAS DETECTADAS', M, y, 8, bold, MUTED);
    y -= 6;
    rule(y);
    y -= 16;
    for (const d of liq.diferencias) {
      page.drawCircle({ x: M + 3, y: y + 3, size: 2.5, color: d.tipo === 'sin_comprobante' ? RED : AMBER });
      text(d.nota, M + 14, y, 9.5, font, INK);
      right(mxn(d.monto), cMonto, y, 9.5, bold, d.monto >= 0 ? INK : AMBER);
      y -= 16;
      if (y < 70) break;
    }
  }

  // ─── Pie ────────────────────────────────────────────────────────────────────
  text(`Generado por Cuadra · ${fecha(liq.creadaEn)}`, M, 40, 8, font, MUTED);
  right('cuadra.mx', 595.28 - M, 40, 8, font, MUTED);

  return doc.save();
}
