// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN EXTERNA — dibuja la liquidación en EL FORMATO DE LA FLOTA.
//
// Entra la plantilla (`formato_flota.ts`) y las cifras que el cliente calculó;
// salen los dos documentos que la oficina hoy arma a mano: un PDF y un Excel,
// con las mismas columnas, encabezados y orden. NO se calcula nada: cada cifra
// se imprime tal cual llegó (el único total es el que el cliente mandó).
//
// Determinista: mismas entradas, mismos bytes (sin fechas de creación), para
// que una ruta direccionada por contenido no se pise entre dos peticiones.
// El texto viene de un sistema ajeno y el Excel lo abre una persona: las celdas
// de texto se escriben como TEXTO (`t:'s'`), jamás como fórmula.
// ═══════════════════════════════════════════════════════════════════════════

import * as XLSX from 'xlsx';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { fechaDia } from '../export_configurable';
import { dinero, periodoTexto } from './presentacion';
import { wa, cortar, envolver } from './pdf';
import type { ConceptoExterno, MonedaExterna } from './esquema';
import type { CampoEncabezado, CampoRenglon, FormatoFlota } from './formato_flota';

/** Lo que el dibujo necesita de una liquidación; lo arman igual el POST (recién
 *  validada) y el panel (leída de la base). */
export interface DatosFormato {
  claveExterna: string;
  sistemaOrigen: string | null;
  operadorNombre: string;
  razonSocial: string | null;
  viajes: string[];
  desde: string;
  hasta: string;
  conceptos: ConceptoExterno[];
  total: number;
  moneda: MonedaExterna;
}

const ETIQUETA_TIPO = { percepcion: 'Percepción', deduccion: 'Deducción' } as const;

function valorDato(campo: CampoEncabezado, d: DatosFormato, f: FormatoFlota): string {
  switch (campo) {
    case 'operador': return d.operadorNombre;
    case 'claveExterna': return d.claveExterna;
    case 'sistemaOrigen': return d.sistemaOrigen ?? '';
    case 'periodo': return f.fechas === 'dmy' ? periodoTexto(d.desde, d.hasta) : `${d.desde} a ${d.hasta}`;
    case 'desde': return fechaDia(d.desde, f.fechas);
    case 'hasta': return fechaDia(d.hasta, f.fechas);
    case 'viajes': return d.viajes.join(', ');
    case 'moneda': return d.moneda;
    case 'total': return dinero(d.total, d.moneda);
    case 'razonSocial': return d.razonSocial ?? '';
  }
}

/** El valor de una celda de la tabla: número (para que Excel lo sume) o texto. */
function valorRenglon(campo: CampoRenglon, c: ConceptoExterno): string | number | null {
  switch (campo) {
    case 'clave': return c.clave ?? '';
    case 'descripcion': return c.descripcion;
    case 'tipo': return ETIQUETA_TIPO[c.tipo];
    case 'monto': return c.monto;
    case 'montoFirmado': return c.tipo === 'deduccion' ? -c.monto : c.monto;
    case 'percepcion': return c.tipo === 'percepcion' ? c.monto : null;
    case 'deduccion': return c.tipo === 'deduccion' ? c.monto : null;
  }
}

const esNumerico = (campo: CampoRenglon) => campo === 'monto' || campo === 'montoFirmado' || campo === 'percepcion' || campo === 'deduccion';

/** La celda de la tabla ya como texto para el PDF (con moneda solo en el total). */
function textoRenglon(campo: CampoRenglon, c: ConceptoExterno): string {
  const v = valorRenglon(campo, c);
  if (v === null) return '';
  if (typeof v === 'number') return new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  return v;
}

const tituloDe = (f: FormatoFlota, d: DatosFormato) => f.titulo ?? (d.razonSocial?.trim() ? `Liquidación — ${d.razonSocial.trim()}` : 'Liquidación');

const pieDe = (d: DatosFormato) => {
  const origen = d.sistemaOrigen ? `calculada por ${d.sistemaOrigen}` : 'calculada por el sistema de la empresa';
  return `Liquidación ${origen}. Likida solo la entrega: no la recalcula ni la modifica.`;
};

// ── EXCEL ───────────────────────────────────────────────────────────────────

export function generarExcelFormato(f: FormatoFlota, d: DatosFormato): Uint8Array {
  const filas: Array<Array<string | number | null>> = [];
  filas.push([tituloDe(f, d)]);
  filas.push([]);
  for (const dato of f.datos) filas.push([dato.etiqueta, valorDato(dato.campo, d, f)]);
  if (f.datos.length > 0) filas.push([]);
  const filaEncabezados = filas.length;
  filas.push(f.columnas.map((c) => c.encabezado));
  for (const c of d.conceptos) filas.push(f.columnas.map((col) => valorRenglon(col.campo, c)));
  const primeraCifra = filaEncabezados + 1;
  const ultimaCifra = filaEncabezados + d.conceptos.length;
  let filaTotal = -1;
  if (f.total.mostrar) {
    // El total ES el que mandó el cliente, escrito como número (no una fórmula
    // que lo recalcule): en la columna de cifra principal, o la última.
    const idxMonto = f.columnas.findIndex((c) => c.campo === 'monto' || c.campo === 'montoFirmado');
    const idx = idxMonto >= 0 ? idxMonto : f.columnas.length - 1;
    const fila: Array<string | number | null> = f.columnas.map(() => null);
    fila[0] = f.total.etiqueta;
    if (idx > 0) fila[idx] = d.total; else fila[1] = d.total;
    filas.push([]);
    filaTotal = filas.length;
    filas.push(fila);
  }
  filas.push([]);
  filas.push([pieDe(d)]);

  const hoja = XLSX.utils.aoa_to_sheet(filas);
  // Formato numérico de las columnas de cifra; las cifras de dinero llevan 2 decimales.
  f.columnas.forEach((col, i) => {
    if (!esNumerico(col.campo)) return;
    for (let r = primeraCifra; r <= ultimaCifra; r++) {
      const celda = hoja[XLSX.utils.encode_cell({ r, c: i })];
      if (celda && celda.t === 'n') celda.z = '#,##0.00';
    }
  });
  if (filaTotal >= 0) {
    for (let c = 0; c < Math.max(f.columnas.length, 2); c++) {
      const celda = hoja[XLSX.utils.encode_cell({ r: filaTotal, c })];
      if (celda && celda.t === 'n') celda.z = '#,##0.00';
    }
  }
  hoja['!cols'] = f.columnas.map((c) => ({ wch: c.campo === 'descripcion' ? 44 : esNumerico(c.campo) ? 16 : 14 }));
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Liquidación');
  const salida = XLSX.write(libro, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
  return new Uint8Array(salida);
}

// ── PDF ─────────────────────────────────────────────────────────────────────

const INK = rgb(0.06, 0.06, 0.09);
const MUTED = rgb(0.45, 0.47, 0.52);
const HAIRLINE = rgb(0.88, 0.89, 0.91);
const PANEL = rgb(0.955, 0.957, 0.965);
const A4: [number, number] = [595.28, 841.89];
const M = 44;
const PISO = 70;

const PESO_COLUMNA: Record<CampoRenglon, number> = { clave: 1.1, descripcion: 3.4, tipo: 1.2, monto: 1.5, montoFirmado: 1.5, percepcion: 1.5, deduccion: 1.5 };

export async function generarPdfFormato(f: FormatoFlota, d: DatosFormato): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(wa(`Liquidación ${d.claveExterna}`));
  doc.setProducer('Likida');
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage(A4);
  let y = 800;

  const text = (s: string, x: number, yy: number, size: number, fn: PDFFont, color = INK) => page.drawText(wa(s), { x, y: yy, size, font: fn, color });
  const right = (s: string, xRight: number, yy: number, size: number, fn: PDFFont, color = INK) => {
    const v = wa(s);
    page.drawText(v, { x: xRight - fn.widthOfTextAtSize(v, size), y: yy, size, font: fn, color });
  };
  const rule = (yy: number, color = HAIRLINE, grosor = 0.75) => page.drawLine({ start: { x: M, y: yy }, end: { x: A4[0] - M, y: yy }, thickness: grosor, color });
  const asegurar = (alto: number): boolean => {
    if (y - alto >= PISO) return false;
    page = doc.addPage(A4);
    y = 800;
    return true;
  };

  // Título.
  for (const linea of envolver(tituloDe(f, d), A4[0] - 2 * M, bold, 16).slice(0, 2)) { text(linea, M, y, 16, bold); y -= 20; }
  rule(y + 6, INK, 1.2);
  y -= 14;

  // Datos sobre la tabla, en dos columnas.
  if (f.datos.length > 0) {
    const mitad = (A4[0] - 2 * M) / 2;
    f.datos.forEach((dato, i) => {
      const col = i % 2;
      if (col === 0 && i > 0) y -= 30;
      const x = M + col * mitad;
      text(dato.etiqueta.toUpperCase(), x, y, 7, bold, MUTED);
      text(cortar(valorDato(dato.campo, d, f) || '—', mitad - 14, font, 10.5), x, y - 12, 10.5, font);
    });
    y -= 40;
  }

  // La tabla.
  const ancho = A4[0] - 2 * M;
  const suma = f.columnas.reduce((a, c) => a + PESO_COLUMNA[c.campo], 0);
  const anchos = f.columnas.map((c) => (PESO_COLUMNA[c.campo] / suma) * ancho);
  const xs = anchos.map((_, i) => M + anchos.slice(0, i).reduce((a, b) => a + b, 0));
  const cabecera = () => {
    page.drawRectangle({ x: M - 4, y: y - 5, width: ancho + 8, height: 16, color: PANEL });
    f.columnas.forEach((c, i) => {
      if (esNumerico(c.campo)) right(cortar(c.encabezado, anchos[i] - 6, bold, 8), xs[i] + anchos[i] - 4, y, 8, bold, MUTED);
      else text(cortar(c.encabezado, anchos[i] - 6, bold, 8), xs[i], y, 8, bold, MUTED);
    });
    y -= 18;
  };
  cabecera();
  for (const c of d.conceptos) {
    if (asegurar(20)) cabecera();
    f.columnas.forEach((col, i) => {
      const t = textoRenglon(col.campo, c);
      if (esNumerico(col.campo)) right(cortar(t, anchos[i] - 6, font, 9.5), xs[i] + anchos[i] - 4, y, 9.5, font);
      else text(cortar(t, anchos[i] - 8, font, 9.5), xs[i], y, 9.5, font);
    });
    y -= 17;
  }

  if (f.total.mostrar) {
    asegurar(50);
    y -= 2;
    rule(y, INK, 1);
    y -= 20;
    text(cortar(f.total.etiqueta, 300, bold, 11), M, y, 11, bold);
    right(dinero(d.total, d.moneda), A4[0] - M - 4, y, 12, bold);
    y -= 30;
  }

  for (const linea of envolver(pieDe(d), ancho, font, 7.5)) {
    asegurar(12);
    text(linea, M, y, 7.5, font, MUTED);
    y -= 11;
  }
  return doc.save();
}
