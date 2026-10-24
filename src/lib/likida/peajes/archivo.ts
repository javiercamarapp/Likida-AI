import * as XLSX from 'xlsx';
import { matrizDeCsv } from './csv';
import type { Celda } from './formatos';

/** Tope de bytes de un archivo de catálogo (casetas, TAGs): un CSV de miles de filas pesa decenas de KB. */
export const MAX_CATALOGO_BYTES = 4 * 1024 * 1024;
/** Columnas máximas que se conservan por fila de un catálogo. */
export const TOPE_COLUMNAS_CATALOGO = 64;

/**
 * Filas FÍSICAS máximas que se leen de una hoja (A37-A2-15). Los catálogos topan en 5,000 filas y una liquidación en
 * ~300 bitácoras; sin `sheetRows`, un .xlsx de pocos KB se descomprimía a millones de filas en memoria ANTES de que
 * esos topes dijeran nada (bomba de descompresión; el desglose de peajes ya se acota igual).
 */
export const MAX_FILAS_LECTURA_CATALOGO = 50_000;

/**
 * La matriz de celdas de un archivo de catálogo. CSV/TSV con el lector propio
 * (celdas de texto); Excel/ODS con la librería de hojas. Devuelve el motivo si
 * no se puede abrir — jamás lanza.
 */
export function matrizDeArchivoCatalogo(nombre: string, buffer: Uint8Array): { ok: true; matriz: Celda[][] } | { ok: false; motivo: string } {
  if (buffer.length === 0) return { ok: false, motivo: 'El archivo está vacío.' };
  if (buffer.length > MAX_CATALOGO_BYTES) return { ok: false, motivo: 'El archivo pesa demasiado para ser un catálogo (máximo 4 MB). Revisa que sea el correcto.' };
  const ext = (/\.([a-z0-9]+)$/i.exec(nombre.trim())?.[1] ?? '').toLowerCase();
  try {
    if (ext === 'csv' || ext === 'tsv' || ext === 'txt' || ext === '') return { ok: true, matriz: matrizDeCsv(buffer) };
    if (ext === 'xlsx' || ext === 'xls' || ext === 'ods') {
      const libro = XLSX.read(buffer, { type: 'array', sheets: 0, sheetRows: MAX_FILAS_LECTURA_CATALOGO });
      const hoja = libro.Sheets[libro.SheetNames[0]];
      if (!hoja) return { ok: false, motivo: 'El archivo no trae ninguna hoja con datos.' };
      // `!fullref` lo pone la librería solo si `sheetRows` truncó la hoja: trae demasiadas filas para ser un catálogo.
      if ('!fullref' in hoja) return { ok: false, motivo: `La hoja trae demasiadas filas (más de ${MAX_FILAS_LECTURA_CATALOGO.toLocaleString('es-MX')}). Revisa que sea el archivo correcto o pártelo.` };
      return { ok: true, matriz: XLSX.utils.sheet_to_json<Celda[]>(hoja, { header: 1, raw: true, defval: '' }).map((f) => (f.length > TOPE_COLUMNAS_CATALOGO ? f.slice(0, TOPE_COLUMNAS_CATALOGO) : f)) };
    }
    return { ok: false, motivo: `No sé leer un archivo .${ext}. Sube un CSV o un Excel.` };
  } catch {
    return { ok: false, motivo: 'No pude abrir el archivo. Revisa que no esté dañado o protegido con contraseña.' };
  }
}
