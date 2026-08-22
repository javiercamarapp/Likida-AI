// ═══════════════════════════════════════════════════════════════════════════
// EL MOTOR DE INFORMES EN PDF — el mismo lenguaje visual que el papel de
// liquidación (liquidacion/pdf.ts, EL CANON: doble línea de apertura, chip,
// marcadores de sección, bandas de panel y zebra, logo en el pie), hecho
// GENÉRICO para que cualquier reporte/estadística que se pida desde el panel
// llegue con formato y estilo (orden del 17-ago).
//
// Determinístico y SIN LLM, como el canon: aquí solo se DIBUJA lo que el
// llamador ya calculó. Un informe define título, periodo, KPIs, secciones
// (tablas de filas [etiqueta, valor] o tablas de columnas) y notas; el motor
// pagina, envuelve midiendo con la fuente y jamás trunca en silencio.
// ═══════════════════════════════════════════════════════════════════════════

import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { fechaMx } from '@/lib/formato';
import { LOGO_PNG_BASE64 } from '@/lib/marca/logo';

const INK = rgb(0.06, 0.06, 0.09);
const MUTED = rgb(0.45, 0.47, 0.52);
const HAIRLINE = rgb(0.88, 0.89, 0.91);
const PANEL = rgb(0.955, 0.957, 0.965);
const ZEBRA = rgb(0.977, 0.978, 0.982);

export interface KpiInforme { etiqueta: string; valor: string; nota?: string }
export interface SeccionInforme {
  titulo: string;
  /** Tabla de dos columnas etiqueta→valor… */
  filas?: Array<[string, string]>;
  /** …o tabla de N columnas (la primera se alinea a la izquierda, la última a
   *  la derecha — el patrón concepto/…/monto del canon). */
  tabla?: { columnas: string[]; filas: string[][] };
  /** Párrafos de lectura (se envuelven midiendo). */
  parrafos?: string[];
}
export interface Informe {
  titulo: string;
  /** Quién encabeza el papel — la razón social de la flota, o null para un
   *  informe interno de Likida. Un nombre NUNCA se inventa (regla del canon). */
  razonSocial?: string | null;
  periodo?: string;
  kpis?: KpiInforme[];
  secciones: SeccionInforme[];
  notas?: string[];
  generadoEn?: string;
}

export async function generarInformePDF(inf: Informe): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(inf.titulo);
  doc.setProducer('Likida');

  const A4: [number, number] = [595.28, 841.89];
  let page = doc.addPage(A4);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const M = 48;
  const ANCHO = 595.28 - 2 * M;
  let y = 800;
  const PISO_PIE = 64;

  // El mismo saneador WinAnsi del canon: los datos pueden venir de OCR.
  const wa = (s: string): string =>
    s.replace(/→/g, '-').replace(/[●○]/g, '•').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/[^ -ÿ–—•€]/g, '?');

  const text = (s: string, x: number, yy: number, size: number, f: PDFFont, color = INK) =>
    page.drawText(wa(s), { x, y: yy, size, font: f, color });
  const right = (s: string, xR: number, yy: number, size: number, f: PDFFont, color = INK) => {
    const v = wa(s);
    page.drawText(v, { x: xR - f.widthOfTextAtSize(v, size), y: yy, size, font: f, color });
  };
  const rule = (yy: number, color = HAIRLINE, grosor = 0.75) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: 595.28 - M, y: yy }, thickness: grosor, color });
  const caja = (x: number, yy: number, w: number, h: number, fill: ReturnType<typeof rgb>) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, color: fill });
  const cortar = (s2: string, ancho: number, f: PDFFont, size: number): string => {
    const v = wa(s2);
    if (f.widthOfTextAtSize(v, size) <= ancho) return v;
    let lo = 0, hi = v.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (f.widthOfTextAtSize(v.slice(0, mid) + '...', size) <= ancho) lo = mid; else hi = mid - 1;
    }
    return v.slice(0, lo) + '...';
  };
  const envolverMedido = (s2: string, ancho: number, f: PDFFont, size: number): string[] => {
    const palabras = wa(s2).split(/\s+/).filter(Boolean);
    const lineas: string[] = [];
    let actual = '';
    for (const p of palabras) {
      const t = actual ? `${actual} ${p}` : p;
      if (f.widthOfTextAtSize(t, size) <= ancho) { actual = t; continue; }
      if (actual) lineas.push(actual);
      actual = f.widthOfTextAtSize(p, size) <= ancho ? p : cortar(p, ancho, f, size);
      if (actual.endsWith('...')) { lineas.push(actual); actual = ''; }
    }
    if (actual) lineas.push(actual);
    return lineas.length ? lineas : [''];
  };
  const asegurar = (alto: number): boolean => {
    if (y - alto >= PISO_PIE) return false;
    page = doc.addPage(A4);
    y = 800;
    return true;
  };
  const seccionTitulo = (titulo: string) => {
    caja(M, y - 1, 5, 7.5, INK);
    text(titulo.toUpperCase(), M + 11, y, 8, bold, MUTED);
    y -= 6;
    rule(y);
    y -= 18;
  };

  // ── Encabezado: el mismo arranque que el canon ──────────────────────────
  const enc = inf.razonSocial?.trim() || null;
  text(enc ?? 'Likida', M, y, enc ? 17 : 20, bold, INK);
  if (enc) text('Procesado por Likida', M, y - 13, 7.5, font, MUTED);
  right(inf.titulo.toUpperCase(), 595.28 - M, y + 5, 9, bold, MUTED);
  if (inf.periodo) {
    const per = wa(inf.periodo);
    const w = bold.widthOfTextAtSize(per, 9) + 16;
    page.drawRectangle({ x: 595.28 - M - w, y: y - 14, width: w, height: 17, color: PANEL, borderColor: HAIRLINE, borderWidth: 0.75 });
    right(per, 595.28 - M - 8, y - 9, 9, bold, INK);
  }
  y -= 30;
  rule(y, INK, 1.4);
  rule(y - 3);
  y -= 28;

  // ── KPIs: fila de cajas de panel, hasta 4 por renglón ───────────────────
  if (inf.kpis?.length) {
    const porFila = Math.min(4, inf.kpis.length);
    const wCaja = (ANCHO - (porFila - 1) * 10) / porFila;
    for (let i = 0; i < inf.kpis.length; i += porFila) {
      asegurar(56);
      const grupo = inf.kpis.slice(i, i + porFila);
      grupo.forEach((k, j) => {
        const x = M + j * (wCaja + 10);
        page.drawRectangle({ x, y: y - 40, width: wCaja, height: 46, color: PANEL, borderColor: HAIRLINE, borderWidth: 0.75 });
        text(cortar(k.etiqueta.toUpperCase(), wCaja - 16, bold, 6.5), x + 8, y - 6, 6.5, bold, MUTED);
        text(cortar(k.valor, wCaja - 16, bold, 15), x + 8, y - 24, 15, bold, INK);
        if (k.nota) text(cortar(k.nota, wCaja - 16, font, 6), x + 8, y - 35, 6, font, MUTED);
      });
      y -= 58;
    }
    y -= 4;
  }

  // ── Secciones ───────────────────────────────────────────────────────────
  for (const sec of inf.secciones) {
    asegurar(60);
    seccionTitulo(sec.titulo);

    for (const p of sec.parrafos ?? []) {
      for (const linea of envolverMedido(p, ANCHO - 14, font, 9.5)) {
        if (asegurar(13)) seccionTitulo(`${sec.titulo} (cont.)`);
        text(linea, M + 14, y, 9.5, font, INK);
        y -= 12.5;
      }
      y -= 4;
    }

    if (sec.filas?.length) {
      let i = 0;
      for (const [k, v] of sec.filas) {
        if (asegurar(17)) seccionTitulo(`${sec.titulo} (cont.)`);
        if (i % 2 === 1) caja(M - 6, y - 5, ANCHO + 12, 16, ZEBRA);
        text(cortar(k, ANCHO * 0.6, font, 9.5), M + 14, y, 9.5, font, MUTED);
        right(v, 595.28 - M, y, 9.5, bold, INK);
        y -= 16;
        i++;
      }
      y -= 8;
    }

    if (sec.tabla) {
      const cols = sec.tabla.columnas.length;
      const anchoCol = ANCHO / cols;
      const xDe = (c: number) => M + c * anchoCol;
      const cabecera = () => {
        caja(M - 6, y - 5, ANCHO + 12, 16, PANEL);
        sec.tabla!.columnas.forEach((c, ci) => {
          if (ci === cols - 1) right(c, 595.28 - M, y, 8, bold, MUTED);
          else text(cortar(c, anchoCol - 8, bold, 8), xDe(ci), y, 8, bold, MUTED);
        });
        y -= 16;
      };
      cabecera();
      sec.tabla.filas.forEach((fila, fi) => {
        if (asegurar(17)) { seccionTitulo(`${sec.titulo} (cont.)`); cabecera(); }
        if (fi % 2 === 1) caja(M - 6, y - 5, ANCHO + 12, 16, ZEBRA);
        fila.forEach((celda, ci) => {
          if (ci === cols - 1) right(celda, 595.28 - M, y, 9, font, INK);
          else text(cortar(celda, anchoCol - 8, font, 9), xDe(ci), y, 9, ci === 0 ? font : font, ci === 0 ? INK : MUTED);
        });
        y -= 16;
      });
      y -= 8;
    }
  }

  // ── Notas ───────────────────────────────────────────────────────────────
  for (const nota of inf.notas ?? []) {
    for (const linea of envolverMedido(nota, ANCHO, font, 7)) {
      if (asegurar(10)) { /* las notas siguen en la hoja nueva, sin título */ }
      text(linea, M, y, 7, font, MUTED);
      y -= 9;
    }
    y -= 3;
  }

  // ── Pie: el mismo cierre que el canon, con el logo real ─────────────────
  rule(PISO_PIE - 12);
  const cuando = fechaMx(inf.generadoEn);
  try {
    const logo = await doc.embedPng(Uint8Array.from(atob(LOGO_PNG_BASE64), (c) => c.charCodeAt(0)));
    const hLogo = 9;
    const wLogo = (logo.width / logo.height) * hLogo;
    page.drawImage(logo, { x: M, y: PISO_PIE - 29, width: wLogo, height: hLogo });
    text(`Generado por Likida · ${cuando}`, M + wLogo + 7, PISO_PIE - 27.5, 8, font, MUTED);
  } catch {
    text(`Generado por Likida · ${cuando}`, M, PISO_PIE - 26, 8, font, MUTED);
  }
  right('likida.ai', 595.28 - M, PISO_PIE - 26, 8, font, MUTED);

  return doc.save();
}
