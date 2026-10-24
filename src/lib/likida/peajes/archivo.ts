import * as XLSX from 'xlsx';
import { matrizDeCsv } from './csv';
import type { Celda } from './formatos';

/** Tope de bytes de un archivo de catálogo (casetas, TAGs): un CSV de miles de filas pesa decenas de KB. */
export const MAX_CATALOGO_BYTES = 4 * 1024 * 1024;
/** A37-S51-06: filas FÍSICAS que se leen de un catálogo (XLSX `sheetRows`): un xlsx de pocos KB con dimensión A1:XFD1048576 no se materializa. */
export const TOPE_FILAS_CATALOGO = 50_000;
/** Columnas máximas que se conservan por fila de un catálogo. */
export const TOPE_COLUMNAS_CATALOGO = 64;

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
      const libro = XLSX.read(buffer, { type: 'array', sheetRows: TOPE_FILAS_CATALOGO + 1 });
      const hoja = libro.Sheets[libro.SheetNames[0]];
      if (!hoja) return { ok: false, motivo: 'El archivo no trae ninguna hoja con datos.' };
      const filas = XLSX.utils.sheet_to_json<Celda[]>(hoja, { header: 1, raw: true, defval: '' });
      if (filas.length > TOPE_FILAS_CATALOGO) return { ok: false, motivo: `El catálogo trae más de ${TOPE_FILAS_CATALOGO} filas: parece el archivo equivocado.` };
      return { ok: true, matriz: filas.map((f) => (f.length > TOPE_COLUMNAS_CATALOGO ? f.slice(0, TOPE_COLUMNAS_CATALOGO) : f)) };
    }
    return { ok: false, motivo: `No sé leer un archivo .${ext}. Sube un CSV o un Excel.` };
  } catch {
    return { ok: false, motivo: 'No pude abrir el archivo. Revisa que no esté dañado o protegido con contraseña.' };
  }
}
