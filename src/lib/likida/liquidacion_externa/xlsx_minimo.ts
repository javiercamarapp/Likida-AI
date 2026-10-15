import { crearZip } from '../buzon/zip_escribir';

// ═══════════════════════════════════════════════════════════════════════════
// ESCRITOR XLSX MÍNIMO CON ESTILOS — solo valores, nunca fórmulas.
//
// SheetJS CE no escribe estilos, y `npm install` de otra librería no procede.
// Un .xlsx es un zip de XML: aquí se escriben a mano las partes mínimas.
// Todo texto va como `inlineStr` (nunca se evalúa) y todo número como `<v>`:
// el cliente pidió que no salga la fórmula (83:35). Sin `<f>`, sin macros, sin
// hojas ocultas, sin metadatos de autor (no hay docProps). Determinista: mismos
// datos => mismos bytes (la fecha del zip es fija).
// ═══════════════════════════════════════════════════════════════════════════

export type TipoBorde = 'thin' | 'dotted' | 'medium';
export interface EstiloCelda {
  fuente?: { nombre?: string; tam?: number; negrita?: boolean; cursiva?: boolean; color?: string };
  /** Relleno sólido, RRGGBB. */
  relleno?: string;
  borde?: { izq?: TipoBorde; der?: TipoBorde; arr?: TipoBorde; aba?: TipoBorde };
  /** 'contable' = _-"$"* #,##0.00_-; 'texto' = @; por defecto General. */
  formato?: 'contable' | 'texto' | 'general';
  alineacion?: { h?: 'left' | 'center' | 'right'; v?: 'top' | 'center' | 'bottom'; ajustar?: boolean };
}
export interface CeldaXlsx {
  /** 1-based. */
  fila: number;
  /** 1-based. */
  col: number;
  valor?: string | number | null;
  /** Clave dentro de `estilos`. */
  estilo?: string;
}
export interface Combinacion { filaDesde: number; colDesde: number; filaHasta: number; colHasta: number }
export interface AreaImpresion { filaDesde: number; colDesde: number; filaHasta: number; colHasta: number }
export interface OpcionesLibro {
  hoja: string;
  celdas: readonly CeldaXlsx[];
  combinaciones?: readonly Combinacion[];
  /** Ancho por columna (1-based -> caracteres). */
  anchos?: Readonly<Record<number, number>>;
  /** Alto por fila (1-based -> puntos). */
  alturas?: Readonly<Record<number, number>>;
  estilos?: Readonly<Record<string, EstiloCelda>>;
  orientacion?: 'landscape' | 'portrait';
  ajustarAnchoPagina?: boolean;
  areaImpresion?: AreaImpresion;
}

const FECHA_FIJA = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
const MAX_FILAS = 1_048_576;
const MAX_COLS = 16_384;
const FMT_CONTABLE = '_-"$"* #,##0.00_-;\\-"$"* #,##0.00_-;_-"$"* "-"??_-;_-@_-';
const ID_FMT_CONTABLE = 164;

/** Escapa XML y elimina caracteres no válidos en XML 1.0 (control salvo tab/LF/CR). */
export function escaparXml(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function letraColumna(col: number): string {
  if (!Number.isInteger(col) || col < 1 || col > MAX_COLS) throw new Error(`xlsx_minimo: columna fuera de rango (${col})`);
  let n = col;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function ref(fila: number, col: number): string {
  if (!Number.isInteger(fila) || fila < 1 || fila > MAX_FILAS) throw new Error(`xlsx_minimo: fila fuera de rango (${fila})`);
  return `${letraColumna(col)}${fila}`;
}

function color(c: string | undefined, porDefecto: string): string {
  const v = (c ?? porDefecto).replace(/^#/, '').toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(v)) throw new Error(`xlsx_minimo: color inválido (${c})`);
  return `FF${v}`;
}

function nombreHojaValido(n: string): string {
  const limpio = n.replace(/[\\/?*[\]:]/g, '_').replace(/^'+|'+$/g, '').slice(0, 31).trim();
  return limpio || 'Hoja1';
}

interface TablaEstilos { xml: string; indice: Map<string, number> }

function construirEstilos(estilos: Readonly<Record<string, EstiloCelda>>): TablaEstilos {
  const fuentes: string[] = ['<font><sz val="11"/><name val="Calibri"/></font>'];
  const rellenos: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const bordes: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  const xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const indice = new Map<string, number>();
  const unico = (lista: string[], x: string): number => {
    const i = lista.indexOf(x);
    if (i >= 0) return i;
    lista.push(x);
    return lista.length - 1;
  };

  for (const clave of Object.keys(estilos).sort()) {
    const e = estilos[clave]!;
    let fontId = 0;
    if (e.fuente) {
      const f = e.fuente;
      fontId = unico(fuentes,
        `<font>${f.negrita ? '<b/>' : ''}${f.cursiva ? '<i/>' : ''}<sz val="${f.tam ?? 11}"/>` +
        `<color rgb="${color(f.color, '000000')}"/><name val="${escaparXml(f.nombre ?? 'Calibri')}"/></font>`);
    }
    let fillId = 0;
    if (e.relleno) {
      fillId = unico(rellenos, `<fill><patternFill patternType="solid"><fgColor rgb="${color(e.relleno, 'FFFFFF')}"/><bgColor indexed="64"/></patternFill></fill>`);
    }
    let borderId = 0;
    if (e.borde) {
      const l = (tag: string, t?: TipoBorde) => t ? `<${tag} style="${t}"><color rgb="FF000000"/></${tag}>` : `<${tag}/>`;
      borderId = unico(bordes, `<border>${l('left', e.borde.izq)}${l('right', e.borde.der)}${l('top', e.borde.arr)}${l('bottom', e.borde.aba)}<diagonal/></border>`);
    }
    const numFmtId = e.formato === 'contable' ? ID_FMT_CONTABLE : e.formato === 'texto' ? 49 : 0;
    const al = e.alineacion
      ? `<alignment${e.alineacion.h ? ` horizontal="${e.alineacion.h}"` : ''}${e.alineacion.v ? ` vertical="${e.alineacion.v}"` : ''}${e.alineacion.ajustar ? ' wrapText="1"' : ''}/>`
      : '';
    const attrs = `numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"` +
      `${numFmtId ? ' applyNumberFormat="1"' : ''}${fontId ? ' applyFont="1"' : ''}${fillId ? ' applyFill="1"' : ''}` +
      `${borderId ? ' applyBorder="1"' : ''}${al ? ' applyAlignment="1"' : ''}`;
    const xf = al ? `<xf ${attrs}>${al}</xf>` : `<xf ${attrs}/>`;
    xfs.push(xf);
    indice.set(clave, xfs.length - 1);
  }

  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<numFmts count="1"><numFmt numFmtId="${ID_FMT_CONTABLE}" formatCode="${escaparXml(FMT_CONTABLE)}"/></numFmts>` +
    `<fonts count="${fuentes.length}">${fuentes.join('')}</fonts>` +
    `<fills count="${rellenos.length}">${rellenos.join('')}</fills>` +
    `<borders count="${bordes.length}">${bordes.join('')}</borders>` +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';
  return { xml, indice };
}

function construirHoja(o: OpcionesLibro, indice: Map<string, number>): string {
  const porFila = new Map<number, CeldaXlsx[]>();
  const vistas = new Set<string>();
  for (const c of o.celdas) {
    const r = ref(c.fila, c.col);
    if (vistas.has(r)) throw new Error(`xlsx_minimo: celda duplicada ${r}`);
    vistas.add(r);
    if (c.estilo !== undefined && !indice.has(c.estilo)) throw new Error(`xlsx_minimo: estilo inexistente «${c.estilo}»`);
    if (typeof c.valor === 'number' && !Number.isFinite(c.valor)) throw new Error(`xlsx_minimo: número no finito en ${r}`);
    (porFila.get(c.fila) ?? porFila.set(c.fila, []).get(c.fila)!).push(c);
  }
  for (const f of Object.keys(o.alturas ?? {})) if (!porFila.has(Number(f))) porFila.set(Number(f), []);

  const filas = [...porFila.keys()].sort((a, b) => a - b).map((f) => {
    const celdas = porFila.get(f)!.sort((a, b) => a.col - b.col).map((c) => {
      const r = ref(c.fila, c.col);
      const s = c.estilo !== undefined ? ` s="${indice.get(c.estilo)}"` : '';
      if (c.valor === undefined || c.valor === null || c.valor === '') return `<c r="${r}"${s}/>`;
      if (typeof c.valor === 'number') return `<c r="${r}"${s}><v>${c.valor}</v></c>`;
      return `<c r="${r}"${s} t="inlineStr"><is><t xml:space="preserve">${escaparXml(c.valor)}</t></is></c>`;
    });
    const h = o.alturas?.[f];
    const alto = h !== undefined ? ` ht="${h}" customHeight="1"` : '';
    return `<row r="${f}"${alto}>${celdas.join('')}</row>`;
  });

  const cols = Object.keys(o.anchos ?? {}).map(Number).sort((a, b) => a - b)
    .map((c) => `<col min="${c}" max="${c}" width="${o.anchos![c]}" customWidth="1"/>`);
  const merges = (o.combinaciones ?? []).map((m) => `<mergeCell ref="${ref(m.filaDesde, m.colDesde)}:${ref(m.filaHasta, m.colHasta)}"/>`);
  const ajustar = o.ajustarAnchoPagina ?? true;

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    (ajustar ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : '') +
    '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    (cols.length ? `<cols>${cols.join('')}</cols>` : '') +
    `<sheetData>${filas.join('')}</sheetData>` +
    (merges.length ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : '') +
    '<printOptions horizontalCentered="1"/>' +
    '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
    `<pageSetup orientation="${o.orientacion ?? 'landscape'}"${ajustar ? ' fitToWidth="1" fitToHeight="0"' : ''}/>` +
    '</worksheet>';
}


/**
 * `crearZip` sanea los nombres y convierte «/» en «_» (protege a quien extrae), pero un .xlsx NECESITA rutas
 * con carpetas. Se le pasan nombres con «~» y aquí se vuelve a «/» en el MISMO número de bytes, tanto en el
 * encabezado central como en el local. El CRC cubre solo los datos, así que no cambia.
 */
function restaurarRutas(zip: Buffer): Buffer {
  const out = Buffer.from(zip);
  const eocd = out.length - 22;
  if (out.readUInt32LE(eocd) !== 0x06054b50) throw new Error('xlsx_minimo: zip inesperado');
  const total = out.readUInt16LE(eocd + 10);
  let p = out.readUInt32LE(eocd + 16);
  for (let i = 0; i < total; i++) {
    if (out.readUInt32LE(p) !== 0x02014b50) throw new Error('xlsx_minimo: directorio central inesperado');
    const n = out.readUInt16LE(p + 28);
    const extra = out.readUInt16LE(p + 30);
    const coment = out.readUInt16LE(p + 32);
    const local = out.readUInt32LE(p + 42);
    for (const base of [p + 46, local + 30]) {
      for (let k = 0; k < n; k++) if (out[base + k] === 0x7e) out[base + k] = 0x2f;
    }
    p += 46 + n + extra + coment;
  }
  return out;
}

/** Escribe un .xlsx (solo valores). Determinista. */
export function crearLibro(o: OpcionesLibro): Uint8Array {
  const nombre = nombreHojaValido(o.hoja);
  const { xml: styles, indice } = construirEstilos(o.estilos ?? {});
  const hoja = construirHoja(o, indice);
  const area = o.areaImpresion
    ? `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'${escaparXml(nombre.replace(/'/g, "''"))}'!$${letraColumna(o.areaImpresion.colDesde)}$${o.areaImpresion.filaDesde}:$${letraColumna(o.areaImpresion.colHasta)}$${o.areaImpresion.filaHasta}</definedName></definedNames>`
    : '';
  const dec = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const enc = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));
  const zip = crearZip([
    { nombre: '[Content_Types].xml', bytes: enc(dec +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>') },
    { nombre: '_rels~.rels', bytes: enc(dec +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>') },
    { nombre: 'xl~workbook.xml', bytes: enc(dec +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets><sheet name="${escaparXml(nombre)}" sheetId="1" r:id="rId1"/></sheets>${area}</workbook>`) },
    { nombre: 'xl~_rels~workbook.xml.rels', bytes: enc(dec +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>') },
    { nombre: 'xl~styles.xml', bytes: enc(styles) },
    { nombre: 'xl~worksheets~sheet1.xml', bytes: enc(hoja) },
  ], FECHA_FIJA);
  return new Uint8Array(restaurarRutas(zip));
}
