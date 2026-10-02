// ═══════════════════════════════════════════════════════════════════════════
// EL REPORTE DE RECLAMACIÓN, COMO ARCHIVO — Excel y PDF para mandarle al
// proveedor de peaje (o a quien lo gestiona) con la evidencia pegada.
//
// Mismo contenido que la pantalla: por cada cruce, fecha, hora, caseta, TAG,
// unidad, monto, POR QUÉ, la evidencia de GPS y el motivo; arriba, el resumen y
// las leyendas (qué significa «reclamable» y qué NO afirma). Determinista (sin
// fechas de creación). Los textos vienen del proveedor y de la flota: en el
// Excel se escriben como TEXTO (jamás fórmula) y en el PDF se limpian a WinAnsi.
// ═══════════════════════════════════════════════════════════════════════════

import * as XLSX from 'xlsx';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { mxn, fechaHoraMx } from '@/lib/formato';
import { wa, cortar, envolver } from '../liquidacion_externa/pdf';
import { ETIQUETA_MOTIVO_RECLAMACION, type CruceReclamable, type EvidenciaMuestra, type ReporteReclamacion } from './reclamacion';

const resumenLinea = (r: ReporteReclamacion): string => {
  const s = r.resumen;
  return `${s.reclamables} de ${s.lineas} líneas reclamables · ${mxn(s.montoReclamable)}`;
};

const periodo = (r: ReporteReclamacion) => (r.periodoDesde && r.periodoHasta ? `${r.periodoDesde} a ${r.periodoHasta}` : 'periodo no declarado');

/** «05 ago 2026, 10:28 · 120 m de la caseta · 2 min antes» */
export function textoEvidencia(e: EvidenciaMuestra): string {
  const rel = e.minutosDelPase === 0 ? 'a la hora del pase'
    : `${Math.abs(e.minutosDelPase)} min ${e.minutosDelPase < 0 ? 'antes' : 'después'}`;
  const dist = e.distanciaCasetaM !== null ? ` · a ${Math.round(e.distanciaCasetaM)} m de la caseta` : '';
  return `${fechaHoraMx(e.en)} (${rel}) · ${e.lat}, ${e.lng}${dist}`;
}

// ── EXCEL ───────────────────────────────────────────────────────────────────

const ENCABEZADOS = [
  'Línea', 'Fecha del cruce', 'Hora del pase', 'Caseta (proveedor)', 'Caseta (catálogo)', 'TAG', 'Unidad', 'Monto (MXN)',
  'Motivo', 'Confianza', 'Por qué se reclama', 'Distancia unidad–caseta (m)', 'Radio de la caseta (m)', 'Evidencia GPS', 'Zona', 'Primer cobro (línea)',
] as const;

export function reclamacionAExcel(r: ReporteReclamacion): Uint8Array {
  const filas: Array<Array<string | number | null>> = [];
  filas.push(['Solicitud de revisión de cobros de peaje']);
  filas.push([`Proveedor: ${r.proveedor ?? 'no declarado'} · Periodo: ${periodo(r)}`]);
  filas.push([resumenLinea(r)]);
  filas.push([]);
  const filaEnc = filas.length;
  filas.push([...ENCABEZADOS]);
  for (const c of r.cruces) {
    filas.push([
      c.indice + 1, c.fecha, c.hora, c.caseta, c.casetaCatalogo, c.tag, c.unidad, c.monto,
      ETIQUETA_MOTIVO_RECLAMACION[c.motivo], c.confianza, c.porQue, c.distanciaM, c.radioCasetaM,
      c.evidencia.map(textoEvidencia).join('\n'), c.zona ? c.zona.nombre : '', c.duplicadoDeLinea,
    ]);
  }
  const filaTotal = filas.length + 1;
  filas.push([]);
  filas.push(['Total reclamable', null, null, null, null, null, null, r.resumen.montoReclamable]);

  const hoja = XLSX.utils.aoa_to_sheet(filas);
  for (let i = 0; i < r.cruces.length; i++) {
    const celda = hoja[XLSX.utils.encode_cell({ r: filaEnc + 1 + i, c: 7 })];
    if (celda && celda.t === 'n') celda.z = '#,##0.00';
  }
  const total = hoja[XLSX.utils.encode_cell({ r: filaTotal, c: 7 })];
  if (total && total.t === 'n') total.z = '#,##0.00';
  hoja['!cols'] = [6, 12, 10, 26, 26, 16, 10, 13, 26, 10, 70, 14, 12, 70, 20, 12].map((wch) => ({ wch }));

  const resumen = XLSX.utils.aoa_to_sheet([
    ['Resumen'],
    ['Líneas del desglose', r.resumen.lineas],
    ['Líneas reclamables', r.resumen.reclamables],
    ['Monto reclamable (MXN)', r.resumen.montoReclamable],
    [],
    ['Por motivo', 'Líneas', 'Monto (MXN)'],
    ...(Object.keys(ETIQUETA_MOTIVO_RECLAMACION) as Array<keyof typeof ETIQUETA_MOTIVO_RECLAMACION>)
      .map((m) => [ETIQUETA_MOTIVO_RECLAMACION[m], r.resumen.porMotivo[m].n, r.resumen.porMotivo[m].monto]),
    [],
    ['NO se reclaman (sin evidencia en contra del cobro)'],
    ['Confirmadas por el GPS', r.resumen.confirmadas],
    ['Sin datos suficientes', r.resumen.sinDatos],
    ['Sin evaluar con GPS', r.resumen.sinEvaluar],
    [],
    ['Leyendas'],
    ...r.leyendas.map((l) => [l]),
  ]);
  resumen['!cols'] = [{ wch: 60 }, { wch: 14 }, { wch: 16 }];

  const evidencia = XLSX.utils.aoa_to_sheet([
    ['Línea', 'Posición (hora local de México)', 'Minutos respecto al pase', 'Latitud', 'Longitud', 'Distancia a la caseta (m)'],
    ...r.cruces.flatMap((c) => c.evidencia.map((e) => [c.indice + 1, fechaHoraMx(e.en), e.minutosDelPase, e.lat, e.lng, e.distanciaCasetaM])),
  ]);
  evidencia['!cols'] = [{ wch: 8 }, { wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 16 }];

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Reclamación');
  XLSX.utils.book_append_sheet(libro, evidencia, 'Evidencia GPS');
  XLSX.utils.book_append_sheet(libro, resumen, 'Resumen');
  return new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer);
}

// ── PDF ─────────────────────────────────────────────────────────────────────

const INK = rgb(0.06, 0.06, 0.09);
const MUTED = rgb(0.45, 0.47, 0.52);
const HAIRLINE = rgb(0.88, 0.89, 0.91);
const PANEL = rgb(0.955, 0.957, 0.965);
const A4_H: [number, number] = [841.89, 595.28]; // horizontal: la tabla es ancha
const M = 36;
const PISO = 50;

export async function reclamacionAPdf(r: ReporteReclamacion, razonSocial: string | null = null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(wa('Solicitud de revisión de cobros de peaje'));
  doc.setProducer('Likida');
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage(A4_H);
  let y = A4_H[1] - 40;
  const W = A4_H[0] - 2 * M;

  const text = (s: string, x: number, yy: number, size: number, f: PDFFont, color = INK) => page.drawText(wa(s), { x, y: yy, size, font: f, color });
  const right = (s: string, xRight: number, yy: number, size: number, f: PDFFont, color = INK) => {
    const v = wa(s);
    page.drawText(v, { x: xRight - f.widthOfTextAtSize(v, size), y: yy, size, font: f, color });
  };
  const rule = (yy: number, color = HAIRLINE, grosor = 0.75) => page.drawLine({ start: { x: M, y: yy }, end: { x: A4_H[0] - M, y: yy }, thickness: grosor, color });
  const asegurar = (alto: number): boolean => {
    if (y - alto >= PISO) return false;
    page = doc.addPage(A4_H);
    y = A4_H[1] - 40;
    return true;
  };

  text(razonSocial?.trim() || 'Likida', M, y, 15, bold);
  right('SOLICITUD DE REVISIÓN DE COBROS DE PEAJE', A4_H[0] - M, y + 3, 10, bold, MUTED);
  y -= 16;
  rule(y, INK, 1.2);
  y -= 16;
  text(`Proveedor: ${r.proveedor ?? 'no declarado'}   ·   Periodo: ${periodo(r)}`, M, y, 10, font);
  y -= 14;
  text(resumenLinea(r), M, y, 10, bold);
  y -= 14;
  const s = r.resumen;
  text(
    `Por motivo: ${(Object.keys(ETIQUETA_MOTIVO_RECLAMACION) as Array<keyof typeof ETIQUETA_MOTIVO_RECLAMACION>)
      .map((m) => `${ETIQUETA_MOTIVO_RECLAMACION[m]} ${s.porMotivo[m].n} (${mxn(s.porMotivo[m].monto)})`).join('  ·  ')}`,
    M, y, 8.5, font, MUTED,
  );
  y -= 20;

  // Columnas: Línea | Fecha y hora | Caseta | TAG / unidad | Monto | Por qué y evidencia
  const cols = [
    { t: 'Línea', w: 34 }, { t: 'Fecha y hora', w: 78 }, { t: 'Caseta', w: 128 }, { t: 'TAG / unidad', w: 96 }, { t: 'Monto', w: 62 },
  ];
  const wPor = W - cols.reduce((a, c) => a + c.w, 0);
  const xs: number[] = [];
  let acc = M;
  for (const c of cols) { xs.push(acc); acc += c.w; }
  const xPor = acc;

  const cabecera = () => {
    page.drawRectangle({ x: M - 3, y: y - 5, width: W + 6, height: 15, color: PANEL });
    cols.forEach((c, i) => (c.t === 'Monto' ? right(c.t, xs[i] + c.w - 4, y, 7.5, bold, MUTED) : text(c.t, xs[i], y, 7.5, bold, MUTED)));
    text('Por qué se reclama y evidencia de GPS', xPor, y, 7.5, bold, MUTED);
    y -= 18;
  };
  if (r.cruces.length === 0) {
    text('Ningún cruce de este desglose tiene evidencia suficiente para pedir una revisión.', M, y, 10, font);
    y -= 14;
    text(`Confirmadas por el GPS: ${s.confirmadas} · sin datos suficientes: ${s.sinDatos} · sin evaluar: ${s.sinEvaluar}. Sin datos no es evidencia en contra de nadie.`, M, y, 8.5, font, MUTED);
    y -= 20;
  } else {
    cabecera();
    for (const c of r.cruces) {
      const porQue = envolver(`${ETIQUETA_MOTIVO_RECLAMACION[c.motivo]} (confianza ${c.confianza}). ${c.porQue}`, wPor - 4, font, 8);
      const evid = c.evidencia.flatMap((e) => envolver(`• ${textoEvidencia(e)}`, wPor - 4, font, 7.5));
      const lineasPor = [...porQue, ...evid];
      const alto = Math.max(1, lineasPor.length) * 10.5 + 8;
      if (asegurar(alto)) cabecera();
      text(String(c.indice + 1), xs[0], y, 8, font);
      text(`${c.fecha}`, xs[1], y, 8, font);
      if (c.hora) text(c.hora.slice(0, 8), xs[1], y - 10, 8, font, MUTED);
      text(cortar(c.casetaCatalogo || c.caseta, cols[2].w - 6, font, 8), xs[2], y, 8, font);
      if (c.casetaCatalogo && c.caseta && c.caseta !== c.casetaCatalogo) text(cortar(`(${c.caseta})`, cols[2].w - 6, font, 7), xs[2], y - 10, 7, font, MUTED);
      text(cortar(c.tag || '—', cols[3].w - 6, font, 8), xs[3], y, 8, font);
      if (c.unidad) text(cortar(c.unidad, cols[3].w - 6, font, 8), xs[3], y - 10, 8, font, MUTED);
      right(mxn(c.monto), xs[4] + cols[4].w - 4, y, 8, font);
      lineasPor.forEach((l, i) => text(l, xPor, y - i * 10.5, i < porQue.length ? 8 : 7.5, font, i < porQue.length ? INK : MUTED));
      y -= alto;
      rule(y + 4);
    }
    asegurar(30);
    y -= 6;
    text('TOTAL RECLAMABLE', M, y, 10, bold);
    right(mxn(s.montoReclamable), xs[4] + cols[4].w - 4, y, 10.5, bold);
    y -= 24;
  }

  for (const leyenda of r.leyendas) {
    for (const l of envolver(leyenda, W, font, 7.5)) {
      asegurar(11);
      text(l, M, y, 7.5, font, MUTED);
      y -= 10;
    }
    y -= 2;
  }
  return doc.save();
}

export type { CruceReclamable };
