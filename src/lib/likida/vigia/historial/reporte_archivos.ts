// ═══════════════════════════════════════════════════════════════════════════
// EL REPORTE DE PREGUNTAS FRECUENTES Y TENDENCIAS DEL VIGÍA, COMO ARCHIVO — Excel y PDF para llevarlo a la junta o mandarlo a
// quien decide (pedido del levantamiento: «detectar FAQs y tendencias por tema → reporte»).
//
// Mismo contenido que la pantalla del histórico (`analizarHistorial`): preguntas frecuentes con lo que suele contestar el equipo,
// temas por semana con su cambio contra las 4 semanas previas, y el tiempo de respuesta contra el umbral del Vigía. Determinista
// (sin fecha de creación). Los textos vienen del chat de un cliente: en el Excel son TEXTO (jamás fórmula) y en el PDF se limpian
// a WinAnsi. Nada de teléfonos, correos ni nombres: el histórico no los guarda.
// ═══════════════════════════════════════════════════════════════════════════
import * as XLSX from 'xlsx';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { fechaHoraMx } from '@/lib/formato';
import { wa, cortar, envolver } from '../../liquidacion_externa/pdf';
import { ETIQUETA_TEMA, type ReporteHistorial } from './analisis';

export interface MetaReporteFaqs {
  /** «Todos los grupos» o el nombre del grupo elegido. */
  alcance: string;
  /** El análisis se recortó a los primeros mensajes (histórico muy grande). */
  truncado: boolean;
  umbralMin: number;
}

export const AVISO_REPORTE = 'Los temas se detectan por palabras clave, sin modelo: lo que no encaja queda en «Otros». Una «respuesta típica» es lo que el equipo contestó de verdad dentro de la hora siguiente; no se publica ni se usa sola: el gerente la aprueba antes.';

const periodo = (r: ReporteHistorial): string => (r.desde && r.hasta ? `del ${fechaHoraMx(r.desde)} al ${fechaHoraMx(r.hasta)}` : 'periodo no disponible');
const min = (v: number | null): string => (v === null ? '—' : `${v} min`);
const cambio = (d: number | null): string => (d === null ? 'Histórico corto (menos de 8 semanas)' : `${d > 0 ? '+' : ''}${d}`);

// ── EXCEL ───────────────────────────────────────────────────────────────────

export function faqsAExcel(r: ReporteHistorial, meta: MetaReporteFaqs): Uint8Array {
  const resumen = XLSX.utils.aoa_to_sheet([
    ['Preguntas frecuentes y tendencias del Vigía'],
    [`Alcance: ${meta.alcance}`],
    [`Mensajes ${periodo(r)}`],
    [],
    ['Mensajes en total', r.mensajes],
    ['De clientes', r.mensajesCliente],
    ['De tu equipo', r.mensajesEquipo],
    [],
    ['Tiempo de respuesta del equipo'],
    ['Mediana', min(r.tiempos.medianaMin)],
    ['9 de cada 10 respuestas en', min(r.tiempos.p90Min)],
    [`Esperas que pasaron de ${meta.umbralMin} min`, r.tiempos.sobreUmbral],
    ['Mensajes que nadie contestó', r.tiempos.sinRespuesta],
    [],
    ...(meta.truncado ? [['El histórico es más grande de lo que se analiza de una vez: el reporte usa solo los primeros 50,000 mensajes.'], []] : []),
    [AVISO_REPORTE],
  ]);
  resumen['!cols'] = [{ wch: 46 }, { wch: 16 }];

  const faqs = XLSX.utils.aoa_to_sheet([
    ['Pregunta', 'Tema', 'Veces', 'Días distintos', 'Lo que suele contestar el equipo', 'Respuestas encontradas'],
    ...r.faqs.map((f) => [f.pregunta, ETIQUETA_TEMA[f.tema], f.veces, f.dias, f.respuestaTipica ?? 'Sin respuesta del equipo en la hora siguiente', f.respuestasEncontradas]),
  ]);
  faqs['!cols'] = [{ wch: 60 }, { wch: 28 }, { wch: 8 }, { wch: 14 }, { wch: 70 }, { wch: 14 }];

  const tendencias = XLSX.utils.aoa_to_sheet([
    ['Tema', 'Mensajes', 'Últimas 4 semanas', '4 semanas previas', 'Cambio'],
    ...r.tendencias.map((t) => [t.etiqueta, t.total, t.ultimas4Semanas, t.previas4Semanas, cambio(t.delta)]),
  ]);
  tendencias['!cols'] = [{ wch: 36 }, { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 34 }];

  const semanas = XLSX.utils.aoa_to_sheet([
    ['Tema', 'Semana (lunes)', 'Mensajes'],
    ...r.tendencias.flatMap((t) => t.porSemana.map((s) => [t.etiqueta, s.semana, s.mensajes])),
  ]);
  semanas['!cols'] = [{ wch: 36 }, { wch: 16 }, { wch: 10 }];

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, resumen, 'Resumen');
  XLSX.utils.book_append_sheet(libro, faqs, 'Preguntas frecuentes');
  XLSX.utils.book_append_sheet(libro, tendencias, 'Tendencias');
  XLSX.utils.book_append_sheet(libro, semanas, 'Por semana');
  return new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer);
}

// ── PDF ─────────────────────────────────────────────────────────────────────

const INK = rgb(0.06, 0.06, 0.09);
const MUTED = rgb(0.45, 0.47, 0.52);
const HAIRLINE = rgb(0.88, 0.89, 0.91);
const PANEL = rgb(0.955, 0.957, 0.965);
const A4: [number, number] = [595.28, 841.89];
const M = 40;
const PISO = 50;

export async function faqsAPdf(r: ReporteHistorial, meta: MetaReporteFaqs, razonSocial: string | null = null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(wa('Preguntas frecuentes y tendencias de clientes'));
  doc.setProducer('Likida');
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - 44;
  const W = A4[0] - 2 * M;

  const text = (s: string, x: number, yy: number, size: number, f: PDFFont, color = INK) => page.drawText(wa(s), { x, y: yy, size, font: f, color });
  const right = (s: string, xRight: number, yy: number, size: number, f: PDFFont, color = INK) => {
    const v = wa(s);
    page.drawText(v, { x: xRight - f.widthOfTextAtSize(v, size), y: yy, size, font: f, color });
  };
  const rule = (yy: number, color = HAIRLINE, grosor = 0.75) => page.drawLine({ start: { x: M, y: yy }, end: { x: A4[0] - M, y: yy }, thickness: grosor, color });
  const asegurar = (alto: number): boolean => {
    if (y - alto >= PISO) return false;
    page = doc.addPage(A4);
    y = A4[1] - 44;
    return true;
  };
  const parrafo = (s: string, size: number, f: PDFFont, color = INK, sangria = 0, interlinea = size + 3) => {
    for (const l of envolver(s, W - sangria, f, size)) {
      asegurar(interlinea);
      text(l, M + sangria, y, size, f, color);
      y -= interlinea;
    }
  };

  text(razonSocial?.trim() || 'Likida', M, y, 15, bold);
  right('PREGUNTAS FRECUENTES Y TENDENCIAS', A4[0] - M, y + 3, 9.5, bold, MUTED);
  y -= 16;
  rule(y, INK, 1.2);
  y -= 16;
  text(`Alcance: ${meta.alcance}`, M, y, 10, font);
  y -= 13;
  text(`${r.mensajes} mensajes (${r.mensajesCliente} de clientes, ${r.mensajesEquipo} del equipo) ${periodo(r)}`, M, y, 9, font, MUTED);
  y -= 20;

  text('Tiempo de respuesta del equipo', M, y, 11, bold);
  y -= 15;
  parrafo(`Mediana ${min(r.tiempos.medianaMin)} · 9 de cada 10 respuestas en ${min(r.tiempos.p90Min)} · ${r.tiempos.sobreUmbral} esperas pasaron de ${meta.umbralMin} min (incluye ${r.tiempos.sinRespuesta} mensajes que nadie contestó).`, 9.5, font);
  y -= 8;

  asegurar(40);
  text('Preguntas frecuentes', M, y, 11, bold);
  y -= 15;
  if (r.faqs.length === 0) {
    parrafo('No hay preguntas que se repitan lo suficiente (al menos 2 veces) para llamarlas frecuentes.', 9.5, font, MUTED);
  }
  for (const [i, f] of r.faqs.entries()) {
    asegurar(46);
    parrafo(`${i + 1}. ${f.pregunta}`, 9.5, bold);
    parrafo(`${ETIQUETA_TEMA[f.tema]} · ${f.veces} veces en ${f.dias} días`, 8.5, font, MUTED, 12);
    parrafo(f.respuestaTipica ? `Lo que suele contestar el equipo: ${f.respuestaTipica}` : 'Sin una respuesta del equipo en la hora siguiente.', 8.5, font, INK, 12);
    y -= 4;
    rule(y + 2);
    y -= 6;
  }

  asegurar(60);
  y -= 6;
  text('Temas y tendencia', M, y, 11, bold);
  y -= 8;
  const cols = [{ t: 'Tema', w: 190 }, { t: 'Mensajes', w: 60 }, { t: 'Últ. 4 sem.', w: 70 }, { t: 'Previas', w: 60 }, { t: 'Cambio', w: W - 380 }];
  const xs: number[] = [];
  let acc = M;
  for (const c of cols) { xs.push(acc); acc += c.w; }
  page.drawRectangle({ x: M - 3, y: y - 12, width: W + 6, height: 15, color: PANEL });
  y -= 9;
  cols.forEach((c, i) => text(c.t, xs[i], y, 7.5, bold, MUTED));
  y -= 14;
  for (const t of r.tendencias) {
    asegurar(14);
    text(cortar(t.etiqueta, cols[0].w - 6, font, 9), xs[0], y, 9, font);
    text(String(t.total), xs[1], y, 9, font);
    text(String(t.ultimas4Semanas), xs[2], y, 9, font);
    text(String(t.previas4Semanas), xs[3], y, 9, font);
    text(cortar(cambio(t.delta), cols[4].w - 4, font, 9), xs[4], y, 9, font, t.delta === null ? MUTED : INK);
    y -= 13;
  }
  y -= 10;
  if (meta.truncado) parrafo('El histórico es más grande de lo que se analiza de una vez: el reporte usa solo los primeros 50,000 mensajes.', 8, font, MUTED);
  parrafo(AVISO_REPORTE, 8, font, MUTED);
  return doc.save();
}
