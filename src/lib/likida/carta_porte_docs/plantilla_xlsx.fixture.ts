// Libro VACIO sintetico con la estructura de 3 hojas y los encabezados de M2 (sin un solo dato).
// Hace las veces de la «plantilla en blanco» que subiria la flota (bloqueo B-2) en las pruebas.
import * as XLSX from 'xlsx';
import { LAYOUT_NORMAL } from './plantilla_tms.layout';

export const HOJAS_PLANTILLA = ['RemintenteDestinatario', 'Mercancias', 'Error'] as const;

export function plantillaEnBlancoSintetica(): Uint8Array {
  const libro = XLSX.utils.book_new();
  for (const h of LAYOUT_NORMAL.hojas) {
    const ws: XLSX.WorkSheet = {};
    for (const tb of h.tablas) for (const col of tb.columnas) ws[`${col.columna}${tb.filaEncabezado}`] = { t: 's', v: col.encabezado };
    if (h.hoja === 'Error') ws.A1 = { t: 's', v: 'Descripcion del error' };
    if (h.hoja === 'RemintenteDestinatario') ws.A6 = { t: 's', v: 'Datos del remitente' };
    const celdas = Object.keys(ws).map((k) => XLSX.utils.decode_cell(k));
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, ...celdas.map((c) => c.r)), c: Math.max(0, ...celdas.map((c) => c.c)) } });
    XLSX.utils.book_append_sheet(libro, ws, h.hoja);
  }
  return new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
