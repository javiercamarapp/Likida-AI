// Lector de .xlsx del programa de despacho con colores de relleno (T-A4-08).
//
// Misma salida estructural que el CSV (`leerProgramaCsv`, T-A4-02): el xlsx se
// convierte a las mismas líneas (una por fila de la hoja, así `lineaCsv` es el
// número de fila de Excel) y se entrega al lector CSV; no hay una segunda
// implementación de secciones, encabezados ni tope. Encima se agrega el COLOR de
// relleno de cada celda, normalizado a `#RRGGBB`.
//
// El color solo se LEE. Qué significa (patio, despachando...) lo decide la leyenda
// configurable de `leyenda_colores.ts`; aquí no hay ninguna leyenda.
//
// Función pura sobre un Buffer/Uint8Array: sin red ni base.

import { read as leerLibro, SSF } from 'xlsx';
import type { CellObject, WorkSheet } from 'xlsx';
import {
  COLUMNA_LATERAL_PROGRAMA,
  ErrorLectorPrograma,
  leerProgramaCsv,
  type FilaCruda,
  type OpcionesLector,
  type ResultadoLector,
} from './lector';

export interface OpcionesLectorXlsx extends OpcionesLector {
  /** Nombre de la hoja; por defecto la primera. */
  hoja?: string;
}

export interface FilaCrudaXlsx extends FilaCruda {
  /** Color de relleno de la celda UNIDAD (la que usa el cliente para «en patio»), o null. */
  color: string | null;
  /** Color de relleno por columna (nombre normalizado). Solo columnas con relleno. */
  colores: Record<string, string>;
}

export interface ResultadoLectorXlsx extends Omit<ResultadoLector, 'filas'> {
  filas: FilaCrudaXlsx[];
  hoja: string;
  /** false si el libro no trae ningún relleno (o el lector no pudo leer estilos): `color` es null en todo. */
  conRellenos: boolean;
}

/** Tope de bytes (12 MB, igual que A3 y la subida del programa). */
export const TOPE_BYTES_XLSX = 12 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Colores

const TEMA_OFFICE = [
  'FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47',
];

// Paleta indexada estándar de Excel (índices 0-63).
const INDEXADOS = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
];

function aplicarTinte(hex: string, tinte: number): string {
  if (!tinte) return hex;
  const canales = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = canales.map((c) => {
    const v = tinte < 0 ? c * (1 + tinte) : c + (255 - c) * tinte;
    return Math.max(0, Math.min(255, Math.round(v)));
  });
  return out.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}

interface ColorXlsx { rgb?: string; theme?: number; indexed?: number; tint?: number; auto?: number }

/** Color de relleno de Excel (RGB/ARGB, tema o indexado) → `#RRGGBB`, o null si no se puede. */
export function normalizarColorXlsx(c: ColorXlsx | undefined | null): string | null {
  if (!c) return null;
  let hex: string | null = null;
  if (typeof c.rgb === 'string') {
    const t = c.rgb.trim();
    if ((t.length === 6 || t.length === 8) && /^[0-9a-fA-F]+$/.test(t)) hex = t.slice(-6).toUpperCase();
  } else if (typeof c.theme === 'number') {
    hex = TEMA_OFFICE[c.theme] ?? null;
  } else if (typeof c.indexed === 'number') {
    hex = INDEXADOS[c.indexed] ?? null;
  }
  if (hex === null) return null;
  return `#${aplicarTinte(hex, c.tint ?? 0)}`;
}

function colorDeRelleno(celda: CellObject | undefined): string | null {
  const s = (celda as { s?: { patternType?: string; fgColor?: ColorXlsx; bgColor?: ColorXlsx } } | undefined)?.s;
  if (!s || s.patternType === 'none') return null;
  // En un relleno sólido el color visible es fgColor.
  return normalizarColorXlsx(s.fgColor);
}

// ---------------------------------------------------------------------------
// Texto de celda → mismo texto que traería el CSV

const dos = (n: number) => String(n).padStart(2, '0');

function textoCelda(celda: CellObject | undefined): string {
  if (!celda || celda.v === undefined || celda.v === null) return '';
  let t: string;
  if (celda.t === 'n' && typeof celda.v === 'number' && celda.z && SSF.is_date(String(celda.z))) {
    const p = SSF.parse_date_code(celda.v);
    if (p) {
      const hora = `${p.H}:${dos(p.M)}`;
      t = celda.v < 1 ? hora : `${p.d}/${p.m}/${p.y} ${hora}`;
      return t;
    }
  }
  if (celda.t === 'b') t = celda.v ? 'VERDADERO' : 'FALSO';
  else if (celda.t === 'e') t = '';
  else t = celda.w ?? String(celda.v);
  // El lector CSV no entiende comillas: el delimitador y los saltos no pueden viajar en la celda.
  return t.replace(/[;\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Encabezados (mismo criterio que lector.ts)

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}
function normEncabezado(s: string): string {
  return norm(s).replace(/\s*-\s*/g, '-');
}

interface FilaHoja { texto: Map<number, string>; relleno: Map<number, string> }

function columnasDeEncabezado(fila: FilaHoja, hasta: number): Map<string, number> | null {
  let caja = false;
  let od = false;
  for (const [i, c] of fila.texto) {
    if (i >= hasta || c === '' || c.length > 40) continue;
    const n = normEncabezado(c);
    if (n === 'CAJA') caja = true;
    else if (n === 'ORIGEN-DESTINO') od = true;
  }
  if (!(caja && od)) return null;
  const vistos = new Map<string, number>();
  const out = new Map<string, number>();
  for (const i of [...fila.texto.keys()].sort((a, b) => a - b)) {
    if (i >= hasta) break;
    const base = normEncabezado(fila.texto.get(i) ?? '');
    if (base === '') continue;
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    out.set(n === 1 ? base : `${base}_${n}`, i);
  }
  return out;
}

// ---------------------------------------------------------------------------

function leerFilasHoja(ws: WorkSheet): { filas: Map<number, FilaHoja>; ultima: number; conRellenos: boolean } {
  const filas = new Map<number, FilaHoja>();
  let ultima = -1;
  let conRellenos = false;
  for (const ref of Object.keys(ws)) {
    if (ref.charCodeAt(0) === 33 /* «!» */) continue;
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!m) continue;
    let col = 0;
    for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
    col -= 1;
    const fila = Number(m[2]) - 1;
    const celda = ws[ref] as CellObject;
    const texto = textoCelda(celda);
    const color = colorDeRelleno(celda);
    if (texto === '' && color === null) continue;
    let f = filas.get(fila);
    if (!f) {
      f = { texto: new Map(), relleno: new Map() };
      filas.set(fila, f);
    }
    if (texto !== '') f.texto.set(col, texto);
    if (color !== null) {
      f.relleno.set(col, color);
      conRellenos = true;
    }
    if (fila > ultima) ultima = fila;
  }
  return { filas, ultima, conRellenos };
}

export function leerProgramaXlsx(
  contenido: ArrayBuffer | Uint8Array,
  opciones: OpcionesLectorXlsx,
): ResultadoLectorXlsx {
  const bytes = contenido instanceof Uint8Array ? contenido : new Uint8Array(contenido);
  if (bytes.byteLength === 0) {
    throw new ErrorLectorPrograma('El archivo está vacío: no trae ninguna fila del programa.');
  }
  if (bytes.byteLength > TOPE_BYTES_XLSX) {
    throw new ErrorLectorPrograma('El archivo pesa más de 12 MB: súbelo por partes o quita las hojas que no se usan.');
  }

  let libro;
  try {
    libro = leerLibro(bytes, { type: 'array', cellStyles: true, cellDates: false });
  } catch {
    throw new ErrorLectorPrograma('No se pudo abrir el archivo: no parece un Excel (.xlsx) válido.');
  }
  const nombreHoja = opciones.hoja ?? libro.SheetNames[0];
  const ws = nombreHoja ? libro.Sheets[nombreHoja] : undefined;
  if (!nombreHoja || !ws) {
    throw new ErrorLectorPrograma(
      opciones.hoja
        ? `El libro no tiene una hoja llamada «${opciones.hoja}».`
        : 'El libro no trae ninguna hoja.',
    );
  }

  const lateralDesde = opciones.columnaLateral ?? COLUMNA_LATERAL_PROGRAMA;
  const { filas: hoja, ultima, conRellenos } = leerFilasHoja(ws);

  // Una línea por fila de la hoja (también las vacías), para que lineaCsv = fila de Excel.
  const lineas: string[] = [];
  for (let r = 0; r <= ultima; r++) {
    const f = hoja.get(r);
    if (!f || f.texto.size === 0) { lineas.push(''); continue; }
    const maxCol = Math.max(...f.texto.keys());
    const celdas = new Array<string>(maxCol + 1).fill('');
    for (const [c, t] of f.texto) celdas[c] = t;
    lineas.push(celdas.join(';'));
  }
  // Fuerza el delimitador ';' aunque la hoja sea de una sola columna.
  const base = leerProgramaCsv(`;\n${lineas.join('\n')}`, opciones);
  // El «;\n» inicial desplaza todo una línea: se deshace aquí.
  const desplazar = (n: number) => n - 1;

  // Colores por fila de datos.
  let columnas: Map<string, number> | null = null;
  const encabezadoPorFila = new Map<number, Map<string, number>>();
  for (let r = 0; r <= ultima; r++) {
    const f = hoja.get(r);
    if (!f) continue;
    const cols = columnasDeEncabezado(f, lateralDesde);
    if (cols) encabezadoPorFila.set(r + 1, cols);
  }
  const lineasEnc = [...encabezadoPorFila.keys()].sort((a, b) => a - b);

  const filas: FilaCrudaXlsx[] = base.filas.map((fc) => {
    const linea = desplazar(fc.lineaCsv);
    columnas = null;
    for (const le of lineasEnc) {
      if (le > linea) break;
      columnas = encabezadoPorFila.get(le) ?? columnas;
    }
    const colores: Record<string, string> = {};
    const f = hoja.get(linea - 1);
    if (f && columnas) {
      for (const [nombre, idx] of columnas) {
        const c = f.relleno.get(idx);
        if (c) colores[nombre] = c;
      }
    }
    return { ...fc, lineaCsv: linea, color: colores['UNIDAD'] ?? null, colores };
  });

  return {
    ...base,
    filas,
    avisos: base.avisos.map((a) => ({ ...a, lineaCsv: a.lineaCsv === null ? null : desplazar(a.lineaCsv) })),
    secciones: base.secciones.map((s) => ({
      ...s,
      lineaTitulo: s.lineaTitulo === null ? null : desplazar(s.lineaTitulo),
      lineaEncabezado: s.lineaEncabezado === null ? null : desplazar(s.lineaEncabezado),
    })),
    lateral: base.lateral.map((l) => ({ ...l, lineaCsv: desplazar(l.lineaCsv) })),
    resumen: { ...base.resumen, lineas: base.resumen.lineas - 1 },
    hoja: nombreHoja,
    conRellenos,
  };
}
