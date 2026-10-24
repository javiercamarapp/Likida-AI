import * as XLSX from 'xlsx';
import {
  ETIQUETA_CATEGORIA_COBRO, ROTULO_CANDIDATO, esCategoriaInterna, type CandidatoCobro, type CategoriaCobro, type ResultadoRevision,
} from './reglas_cobro';
import { ETIQUETA_CATEGORIA_TARIFA, type CategoriaTarifa, type EvaluacionTarifa } from './reglas_tarifa';

// ═══════════════════════════════════════════════════════════════════════════
// EL REPORTE «LISTO PARA SUBIR AL PORTAL DEL PROVEEDOR» (T-A2-25).
//
// El reclamo se hace «por sistema» (portal del proveedor, sin persona que atienda):
// finanzas necesita un archivo por categoría con las columnas del archivo original
// del proveedor más lo que el portal pide explicar. El formato EXACTO que acepta el
// portal no lo ha mostrado nadie (BLOQUEO EXTERNO): mientras, formato propio claro,
// con las columnas del archivo original para que se pueda transcribir o cargar.
//
// Una hoja por categoría de candidato; «Resumen» (totales) y «Léeme» (la leyenda de
// candidato). Sin candidatos: libro con la hoja «Sin candidatos» y el mensaje.
// NO lleva la interpretación interna (confianza, evidencia de GPS): eso no se sube.
// Todo es CANDIDATO salvo la diferencia de importe contra una tarifa CONFIRMADA.
//
// PURO: sin base, sin red. Determinista (sin fechas de creación). Los textos del
// proveedor se escriben como TEXTO, jamás como fórmula.
// ═══════════════════════════════════════════════════════════════════════════

export type CategoriaArchivo = CategoriaCobro | CategoriaTarifa;

/** El orden de las hojas: el de la ficha (el importe sobre tarifa va después de los duplicados). */
export const CATEGORIAS_ARCHIVO: readonly CategoriaArchivo[] = [
  'unidad_inmovilizada', 'clase_fuera_de_3_5', 'extemporaneo', 'duplicado_exacto', 'importe_sobre_tarifa', 'tag_dado_de_baja', 'caseta_no_debe_cruzarse',
];

export const ETIQUETA_CATEGORIA_ARCHIVO: Record<CategoriaArchivo, string> = { ...ETIQUETA_CATEGORIA_COBRO, ...ETIQUETA_CATEGORIA_TARIFA };

export const ESTADO_CANDIDATO = 'candidato';
export const ESTADO_CONFIRMADO = 'indebido confirmado';
export type EstadoFila = typeof ESTADO_CANDIDATO | typeof ESTADO_CONFIRMADO;

/** Una línea del reporte: columnas del archivo original + lo que el reclamo explica. */
export interface FilaCandidato {
  categoria: CategoriaArchivo;
  /** Renglón dentro del archivo del proveedor (0-based). */
  indice: number;
  tag: string | null;
  unidad: string | null;
  fecha: string | null;
  hora: string | null;
  clase: number | null;
  caseta: string | null;
  importe: number;
  claseEsperada: number | null;
  importeEsperado: number | null;
  /** `null` = no se puede calcular (p. ej. clase distinta sin tarifa para comparar). */
  montoReclamar: number | null;
  motivo: string;
  estado: EstadoFila;
}

export interface ReporteCandidatos {
  proveedor: string | null;
  archivoNombre: string | null;
  periodoDesde: string | null;
  periodoHasta: string | null;
  /** Categorías que se dejaron fuera porque ya tienen un reclamo registrado. */
  categoriasExcluidas: CategoriaArchivo[];
  /** A37-A2-05: cruces de categorías INTERNAS de la flota que no se incluyen (no son un reclamo al proveedor). */
  internasOmitidas: number;
  /** A37-A2-05: cruces que una persona descartó o justificó y por eso no se incluyen. */
  decididosOmitidos: number;
  filas: FilaCandidato[];
}

/** Una línea ya evaluada con `evaluarContraTarifa`, con los datos que el archivo necesita. */
export interface LineaEvaluadaArchivo extends EvaluacionTarifa {
  indice: number;
  tag?: string | null;
  unidad?: string | null;
  fecha: string | null;
  hora?: string | null;
  clase?: number | null;
  caseta: string | null;
  monto: number;
}

export interface EntradaCandidatos {
  proveedor: string | null;
  archivoNombre: string | null;
  periodoDesde: string | null;
  periodoHasta: string | null;
  revision: ResultadoRevision;
  /** Líneas del desglose evaluadas contra el tarifario. Puede venir vacío (sin tarifario no hay hoja de importe). */
  evaluadas?: readonly LineaEvaluadaArchivo[];
  /** Categorías con un reclamo ya registrado: se omiten. */
  excluir?: ReadonlySet<CategoriaArchivo>;
  /**
   * A37-A2-05: renglones que una persona ya descartó o justificó, como `${indice}|${categoria}`. No se suben al proveedor
   * (antes el monto del archivo los incluía).
   */
  decididos?: ReadonlySet<string>;
}

const centavos = (n: number): number => Math.round((n + Number.EPSILON) * 100);
const pesos = (c: number): number => c / 100;

/** Primera frase de un texto llano (el punto debe ir seguido de espacio y mayúscula: «$189.50» no se corta). */
const unaFrase = (s: string): string => {
  const m = /^(.+?[.!?])(?=\s+[A-ZÁÉÍÓÚÑ¿¡]|$)/s.exec(s.trim());
  return (m ? m[1] : s.trim()).replace(/\s+/g, ' ');
};

function montoDeCategoria(c: CandidatoCobro, t: EvaluacionTarifa | undefined): number | null {
  if (c.categoria === 'clase_fuera_de_3_5') return t && t.importeEsperado !== null ? t.montoReclamable : null;
  return c.monto;
}

/** Arma las filas del reporte. Pura y determinista: mismo resultado con las líneas barajadas. */
export function armarCandidatos(e: EntradaCandidatos): ReporteCandidatos {
  const excluir = e.excluir ?? new Set<CategoriaArchivo>();
  const evaluadas = new Map((e.evaluadas ?? []).map((l) => [l.indice, l]));
  const decididos = e.decididos ?? new Set<string>();
  const filas: FilaCandidato[] = [];
  let internasOmitidas = 0;
  let decididosOmitidos = 0;

  for (const c of e.revision.candidatos) {
    if (excluir.has(c.categoria)) continue;
    // A37-A2-05: lo interno de la flota no sale hacia el proveedor.
    if (esCategoriaInterna(c.categoria)) { internasOmitidas++; continue; }
    // Un cruce justificado o descartado por una persona tampoco se reclama.
    if (c.justificacion || decididos.has(`${c.indice}|${c.categoria}`)) { decididosOmitidos++; continue; }
    const t = evaluadas.get(c.indice);
    filas.push({
      categoria: c.categoria, indice: c.indice, tag: c.tag, unidad: c.unidad, fecha: c.fecha, hora: c.hora, clase: c.clase, caseta: c.caseta, importe: c.monto,
      claseEsperada: t ? t.claseEsperada : null, importeEsperado: t ? t.importeEsperado : null,
      montoReclamar: montoDeCategoria(c, t), motivo: unaFrase(c.quePaso), estado: ESTADO_CANDIDATO,
    });
  }

  if (!excluir.has('importe_sobre_tarifa')) {
    for (const l of evaluadas.values()) {
      if (l.categoriaTarifa !== 'importe_sobre_tarifa') continue;
      if (decididos.has(`${l.indice}|importe_sobre_tarifa`)) { decididosOmitidos++; continue; }
      filas.push({
        categoria: 'importe_sobre_tarifa', indice: l.indice, tag: l.tag ?? null, unidad: l.unidad ?? null, fecha: l.fecha, hora: l.hora ? l.hora.slice(0, 8) : null,
        clase: l.clase ?? null, caseta: l.caseta, importe: l.monto, claseEsperada: l.claseEsperada, importeEsperado: l.importeEsperado,
        montoReclamar: l.montoReclamable, motivo: unaFrase(l.quePasoTarifa),
        estado: l.estadoTarifa === 'cobro_indebido_confirmado' ? ESTADO_CONFIRMADO : ESTADO_CANDIDATO,
      });
    }
  }

  const orden = new Map(CATEGORIAS_ARCHIVO.map((c, i) => [c, i]));
  filas.sort((a, b) => ((orden.get(a.categoria) ?? 0) - (orden.get(b.categoria) ?? 0)) || (a.indice - b.indice));
  return {
    proveedor: e.proveedor, archivoNombre: e.archivoNombre, periodoDesde: e.periodoDesde, periodoHasta: e.periodoHasta,
    categoriasExcluidas: CATEGORIAS_ARCHIVO.filter((c) => excluir.has(c)), internasOmitidas, decididosOmitidos, filas,
  };
}

// ── Totales ─────────────────────────────────────────────────────────────────

export interface ResumenCandidatos {
  porCategoria: Record<CategoriaArchivo, { n: number; monto: number; sinMonto: number }>;
  /** Líneas distintas (una línea puede estar en dos categorías). */
  lineasDistintas: number;
  /** Monto reclamable sin contar dos veces una línea que cae en dos categorías: el mayor de sus montos. */
  montoTotal: number;
  /** Filas que no se pudieron valorar (sin tarifa para comparar). */
  sinMonto: number;
}

export function resumirCandidatos(r: ReporteCandidatos): ResumenCandidatos {
  const porCategoria = Object.fromEntries(CATEGORIAS_ARCHIVO.map((c) => [c, { n: 0, monto: 0, sinMonto: 0 }])) as ResumenCandidatos['porCategoria'];
  const centCat = new Map<CategoriaArchivo, number>();
  const porLinea = new Map<number, number>();
  let sinMonto = 0;
  for (const f of r.filas) {
    const p = porCategoria[f.categoria];
    p.n++;
    if (f.montoReclamar === null) { p.sinMonto++; sinMonto++; continue; }
    const c = centavos(f.montoReclamar);
    centCat.set(f.categoria, (centCat.get(f.categoria) ?? 0) + c);
    porLinea.set(f.indice, Math.max(porLinea.get(f.indice) ?? 0, c));
  }
  for (const [cat, c] of centCat) porCategoria[cat].monto = pesos(c);
  let total = 0;
  for (const c of porLinea.values()) total += c;
  return { porCategoria, lineasDistintas: new Set(r.filas.map((f) => f.indice)).size, montoTotal: pesos(total), sinMonto };
}

// ── Excel / CSV ─────────────────────────────────────────────────────────────

type Fila = Array<string | number | null>;

/** Excel evalúa como fórmula el texto que empieza con = + - @: se neutraliza con un apóstrofo visible. */
const texto = (v: string | null | undefined): string => {
  const s = v ?? '';
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

/** Las columnas del archivo original primero (en ese orden: así el lector tolerante las reconoce) y luego lo del reclamo. */
export const ENCABEZADOS_CANDIDATOS = [
  'Tarjeta/TAG', 'No. económico', 'Fecha', 'Hora', 'Clase', 'Caseta', 'Importe',
  'Clase esperada', 'Importe esperado', 'Monto a reclamar', 'Motivo', 'Estado',
] as const;

const filaDe = (f: FilaCandidato): Fila => [
  texto(f.tag), texto(f.unidad), f.fecha, f.hora, f.clase, texto(f.caseta), f.importe,
  f.claseEsperada, f.importeEsperado, f.montoReclamar, texto(f.motivo), f.estado === ESTADO_CONFIRMADO ? 'Indebido confirmado' : 'Candidato',
];

export const LEYENDA_LEEME: readonly string[] = [
  'Cómo leer este archivo',
  `${ROTULO_CANDIDATO}. Cada renglón es un candidato: una razón para pedirle al proveedor que revise el cobro, no una afirmación de que sea indebido.`,
  'Solo se rotula «Indebido confirmado» la diferencia de importe contra una tarifa que una persona o el proveedor ya confirmó.',
  '«Monto a reclamar» es lo que se pediría en ese renglón; vacío significa que no hay con qué calcularlo (por ejemplo, falta la tarifa de esa caseta).',
  'Una misma línea puede aparecer en dos hojas; el total de «Resumen» no la cuenta dos veces.',
  'El formato exacto que acepta el portal del proveedor aún no se conoce: este archivo trae las columnas del archivo original para transcribirlo o cargarlo.',
];

const periodoTexto = (r: ReporteCandidatos) => (r.periodoDesde && r.periodoHasta ? `${r.periodoDesde} a ${r.periodoHasta}` : 'periodo no declarado');
const mensajeVacio = (r: ReporteCandidatos) => (r.categoriasExcluidas.length > 0
  ? 'No hay candidatos pendientes: los que había ya tienen un reclamo registrado.'
  : 'No hay candidatos en este archivo: nada que reclamar con las reglas de hoy.');

export function candidatosAExcel(r: ReporteCandidatos): Uint8Array {
  const libro = XLSX.utils.book_new();
  const resumen = resumirCandidatos(r);

  if (r.filas.length === 0) {
    const hoja = XLSX.utils.aoa_to_sheet([[mensajeVacio(r)], [ROTULO_CANDIDATO]]);
    hoja['!cols'] = [{ wch: 90 }];
    XLSX.utils.book_append_sheet(libro, hoja, 'Sin candidatos');
  } else {
    for (const cat of CATEGORIAS_ARCHIVO) {
      const filas = r.filas.filter((f) => f.categoria === cat);
      if (filas.length === 0) continue;
      const hoja = XLSX.utils.aoa_to_sheet([[...ENCABEZADOS_CANDIDATOS], ...filas.map(filaDe)]);
      for (let i = 0; i < filas.length; i++) {
        for (const c of [6, 8, 9]) {
          const celda = hoja[XLSX.utils.encode_cell({ r: 1 + i, c })];
          if (celda && celda.t === 'n') celda.z = '#,##0.00';
        }
      }
      hoja['!cols'] = [18, 14, 12, 9, 8, 28, 12, 10, 12, 14, 70, 20].map((wch) => ({ wch }));
      XLSX.utils.book_append_sheet(libro, hoja, ETIQUETA_CATEGORIA_ARCHIVO[cat].slice(0, 31));
    }
  }

  const filasResumen: Fila[] = [
    ['Resumen para el portal del proveedor'],
    [ROTULO_CANDIDATO],
    [`Archivo: ${texto(r.archivoNombre) || 'sin nombre'} · Proveedor: ${texto(r.proveedor) || 'no declarado'} · Periodo: ${periodoTexto(r)}`],
    ...(r.categoriasExcluidas.length > 0
      ? [[`No incluye las categorías que ya tienen reclamo registrado: ${r.categoriasExcluidas.map((c) => ETIQUETA_CATEGORIA_ARCHIVO[c]).join(', ')}.`]] as Fila[]
      : []),
    ...(r.internasOmitidas > 0
      ? [[`No incluye ${r.internasOmitidas} cruce(s) de categorías internas de la flota (caseta que no debe cruzarse, unidad inmovilizada): no son un reclamo al proveedor.`]] as Fila[]
      : []),
    ...(r.decididosOmitidos > 0
      ? [[`No incluye ${r.decididosOmitidos} cruce(s) que una persona descartó o justificó.`]] as Fila[]
      : []),
    [],
    ['Categoría', 'Renglones', 'Monto a reclamar (MXN)', 'Sin monto calculable'],
    ...CATEGORIAS_ARCHIVO.map((c): Fila => [ETIQUETA_CATEGORIA_ARCHIVO[c], resumen.porCategoria[c].n, resumen.porCategoria[c].monto, resumen.porCategoria[c].sinMonto]),
    [],
    ['Líneas distintas', resumen.lineasDistintas],
    ['Total a reclamar (MXN), sin contar dos veces una línea', resumen.montoTotal],
    ['Renglones sin monto calculable', resumen.sinMonto],
  ];
  const hRes = XLSX.utils.aoa_to_sheet(filasResumen);
  hRes['!cols'] = [{ wch: 60 }, { wch: 12 }, { wch: 22 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(libro, hRes, 'Resumen');

  const hLeeme = XLSX.utils.aoa_to_sheet(LEYENDA_LEEME.map((l) => [l]));
  hLeeme['!cols'] = [{ wch: 110 }];
  XLSX.utils.book_append_sheet(libro, hLeeme, 'Léeme');

  return new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer);
}

const celdaCsv = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV equivalente: una sola tabla con la categoría al inicio. UTF-8 con BOM (Excel lo abre con acentos). */
export function candidatosACsv(r: ReporteCandidatos): string {
  const lineas: string[] = [['Categoría', ...ENCABEZADOS_CANDIDATOS].map(celdaCsv).join(',')];
  for (const f of r.filas) lineas.push([ETIQUETA_CATEGORIA_ARCHIVO[f.categoria], ...filaDe(f)].map(celdaCsv).join(','));
  if (r.filas.length === 0) lineas.push(celdaCsv(mensajeVacio(r)));
  return `\uFEFF${lineas.join('\r\n')}\r\n`;
}
