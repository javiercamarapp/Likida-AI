// ═══════════════════════════════════════════════════════════════════════════
// LO COMÚN A TODO IMPORTADOR DE ARCHIVO (auditoría 24, ADM-2).
//
// El lector de CSV/XLSX es el MISMO que usa `dashboard/viajes` (la librería
// `xlsx` del repo, `read` + `sheet_to_json` con `header: 1`): un segundo
// parser sería una segunda opinión sobre qué es una celda vacía. Aquí viven
// la detección de columnas por encabezado (minúsculas, sin acentos), el tope
// de filas DICHO (no mudo, FE-15) y la plantilla descargable.
// ═══════════════════════════════════════════════════════════════════════════

import { read as leerLibro, utils as xlsxUtils } from 'xlsx';
import { numero } from '@/lib/formato';

/** Cuántas filas de datos se leen de un archivo, COMO MÁXIMO. Mismo tope que
 *  el importador de viajes: por encima se DICE con la cifra y se pide partir
 *  el archivo — nunca se importa a medias en silencio. */
export const TOPE_FILAS_IMPORTACION = 2_000;

/** Un CSV de 800 unidades pesa ~60 KB; 4 MB ya es el archivo equivocado. */
export const MAX_ARCHIVO_BYTES = 4 * 1024 * 1024;

/** Cuántas filas se escriben por tanda. Una tanda es UN insert. */
export const FILAS_POR_TANDA = 200;

export interface Descartada { fila: number; motivo: string }

/** Encabezado del mundo real → llave comparable: minúsculas, sin acentos,
 *  sin signos. «Nº de Empleado» y «numero empleado» son la misma columna. */
export function normalizarEncabezado(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** La matriz cruda (fila 0 = encabezados) de un CSV o Excel. Lanza si el
 *  archivo no se puede leer — el llamador lo dice en palabras. */
export function matrizDeArchivo(buffer: ArrayBuffer): unknown[][] {
  const libro = leerLibro(buffer, { type: 'array' });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  if (!hoja) return [];
  return xlsxUtils.sheet_to_json(hoja, { header: 1, raw: true }) as unknown[][];
}

/** Índice de columna por cada llave del catálogo, si el archivo la trae. */
export function detectarColumnas<K extends string>(
  encabezados: unknown[],
  catalogo: Record<K, readonly string[]>,
): Partial<Record<K, number>> {
  const normales = encabezados.map(normalizarEncabezado);
  const indice: Partial<Record<K, number>> = {};
  for (const clave of Object.keys(catalogo) as K[]) {
    const i = normales.findIndex((e) => catalogo[clave].includes(e));
    if (i >= 0) indice[clave] = i;
  }
  return indice;
}

export function filaVacia(fila: unknown[] | undefined): boolean {
  return !fila || fila.every((c) => c === null || c === undefined || String(c).trim() === '');
}

/** Una celda como texto recortado; `''` si venía vacía. Un número de Excel
 *  (una placa «1234» que Excel volvió numérica) sale como su texto. */
export function celdaTexto(v: unknown, max: number): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return String(v).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Los encabezados que se leyeron, para decirlos cuando falta una columna. */
export function encabezadosLeidos(matriz: unknown[][]): string {
  return (matriz[0] ?? []).map((c) => `«${String(c ?? '')}»`).join(', ');
}

/** El aviso de tope, en la forma que va PRIMERO en `descartadas` (FE-15) y
 *  también en `error`. `null` si el archivo cabe. */
export function avisoDeTope(matriz: unknown[][]): Descartada | null {
  const filasDeDatos = Math.max(0, matriz.length - 1);
  if (filasDeDatos <= TOPE_FILAS_IMPORTACION) return null;
  const tope = numero(TOPE_FILAS_IMPORTACION);
  return {
    fila: TOPE_FILAS_IMPORTACION + 1,
    motivo: `El archivo trae ${numero(filasDeDatos)} filas y el tope es ${tope}: se leyeron las primeras ${tope}. Pártelo y sube el resto aparte.`,
  };
}

/** Escapa una celda para CSV (RFC 4180). */
function celdaCsv(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * La plantilla descargable: encabezados + UNA fila de ejemplo. Con BOM para
 * que Excel en español la abra con acentos y sin preguntar.
 *
 * La fila de ejemplo es un ejemplo y se dice: un dato de muestra que alguien
 * suba sin borrar entra como un operador o una unidad de mentira. Por eso el
 * importador la reconoce y la descarta con su nombre (ver `esFilaDeEjemplo`).
 */
export function plantillaCsv(encabezados: readonly string[], ejemplo: readonly string[]): string {
  return '\uFEFF' + [encabezados, ejemplo].map((f) => f.map(celdaCsv).join(',')).join('\r\n') + '\r\n';
}

/** El marcador que la fila de ejemplo de la plantilla trae en el nombre. */
export const MARCA_EJEMPLO = 'EJEMPLO — bórrame';

export function esFilaDeEjemplo(fila: unknown[]): boolean {
  return fila.some((c) => typeof c === 'string' && c.includes('EJEMPLO'));
}

/** Parte una lista en tandas de `tamano`. */
export function enTandas<T>(lista: readonly T[], tamano = FILAS_POR_TANDA): T[][] {
  const salida: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) salida.push(lista.slice(i, i + tamano));
  return salida;
}

/** ¿Es el 23505 de esta restricción? Las DOS señales, como `chocoContra`. */
export function chocaContra(mensaje: string, restriccion: string): boolean {
  return mensaje.includes(restriccion) && /duplicate key|already exists|23505/i.test(mensaje);
}
