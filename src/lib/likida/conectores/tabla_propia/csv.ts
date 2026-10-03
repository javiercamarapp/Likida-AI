import { ErrorTablaPropia, type CursoTablaPropia, type GeocercaTablaPropia, type PosicionTablaPropia, type ResultadoLectura } from './contrato';
import {
  ALIAS_CURSO, ALIAS_GEOCERCA, ALIAS_POSICION, MAX_FILAS_LECTURA, indiceDe, registrosACursos, registrosAGeocercas, registrosAPosiciones, type Registro,
} from './filas';

// ═══════════════════════════════════════════════════════════════════════════
// CSV de SU sistema (modo csv_sftp, y CUALQUIER CSV que se suba a mano).
// Separador detectado en el encabezado (`,` `;` tab); con `;` el decimal puede
// ser coma (el CSV de Excel en español). Acotado en tamaño y filas.
// ═══════════════════════════════════════════════════════════════════════════

export const MAX_BYTES_CSV = 25_000_000;

export function separadorDe(texto: string): string {
  const primera = texto.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const cuenta = (s: string) => primera.split(s).length - 1;
  return [';', '\t', ','].reduce((m, c) => (cuenta(c) > cuenta(m) ? c : m), ',');
}

export function partirCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, '');
  const sep = separadorDe(t);
  const filas: string[][] = [];
  let fila: string[] = []; let campo = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else q = false; } else campo += c; }
    else if (c === '"' && campo === '') q = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; fila.push(campo); campo = ''; filas.push(fila); fila = []; if (filas.length > MAX_FILAS_LECTURA + 1) break; }
    else campo += c;
  }
  if (campo !== '' || fila.length > 0) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => f.some((x) => x.trim() !== ''));
}

function aRegistros<K extends string>(texto: string, alias: Record<K, string[]>, obligatorias: readonly K[], aceptaUna?: readonly K[]): { registros: Registro[]; decimalComa: boolean } {
  if (texto.length > MAX_BYTES_CSV) throw new ErrorTablaPropia('El archivo pesa más de 25 MB; acota la ventana o divídelo.', 'formato');
  return { ...aRegistrosDeMatriz(partirCsv(texto), alias, obligatorias, aceptaUna), decimalComa: separadorDe(texto) === ';' };
}

/** La misma lectura sobre una matriz ya partida (un Excel o un CSV leído por otro lado): la primera fila son los encabezados. */
function aRegistrosDeMatriz<K extends string>(matriz: readonly (readonly string[])[], alias: Record<K, string[]>, obligatorias: readonly K[], aceptaUna?: readonly K[]): { registros: Registro[] } {
  if (matriz.length === 0) throw new ErrorTablaPropia('El archivo está vacío.', 'formato');
  const enc = matriz[0];
  const ix = Object.fromEntries((Object.keys(alias) as K[]).map((k) => [k, indiceDe(enc, alias[k])])) as Record<K, number>;
  const faltan = obligatorias.filter((k) => ix[k] < 0);
  if (aceptaUna && aceptaUna.every((k) => ix[k] < 0)) faltan.push(aceptaUna.join(' o ') as K);
  if (faltan.length) {
    throw new ErrorTablaPropia(`Faltan columnas obligatorias: ${faltan.join(', ')}. Encabezados leídos: ${enc.slice(0, 20).join(' | ').slice(0, 300)}.`, 'formato');
  }
  const registros = matriz.slice(1).map((c) => {
    const r: Registro = {};
    for (const k of Object.keys(alias) as K[]) r[k] = ix[k] >= 0 ? (c[ix[k]] ?? '') : undefined;
    return r;
  });
  return { registros };
}

export function leerPosicionesCsv(texto: string, opciones: { zona?: string } = {}): ResultadoLectura<PosicionTablaPropia> {
  const { registros, decimalComa } = aRegistros(texto, ALIAS_POSICION, ['unidad', 'lat', 'lon', 'fecha_hora']);
  return registrosAPosiciones(registros, { zona: opciones.zona, decimalComa, primeraFila: 2 });
}

export function leerGeocercasCsv(texto: string): ResultadoLectura<GeocercaTablaPropia> {
  const { registros, decimalComa } = aRegistros(texto, ALIAS_GEOCERCA, ['codigo', 'nombre'], ['lat_centro', 'poligono_wkt']);
  return registrosAGeocercas(registros, { decimalComa, primeraFila: 2 });
}

/** Cursos (rutas autorizadas): una fila por curso; las casetas van en UNA celda separadas por «|»; el corredor, como LINESTRING(lon lat, …). */
export function leerCursosCsv(texto: string): ResultadoLectura<CursoTablaPropia> {
  const { registros, decimalComa } = aRegistros(texto, ALIAS_CURSO, ['codigo', 'nombre'], ['casetas', 'corredor_wkt']);
  return registrosACursos(registros, { decimalComa, primeraFila: 2 });
}

/** Los cursos de un Excel o de cualquier matriz ya leída (las celdas se leen como texto: las fechas se escriben AAAA-MM-DD o DD/MM/AAAA). */
export function leerCursosMatriz(matriz: ReadonlyArray<ReadonlyArray<unknown>>): ResultadoLectura<CursoTablaPropia> {
  const texto = matriz.slice(0, MAX_FILAS_LECTURA + 1).map((f) => f.map((c) => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c))));
  const { registros } = aRegistrosDeMatriz(texto.filter((f) => f.some((x) => x.trim() !== '')), ALIAS_CURSO, ['codigo', 'nombre'], ['casetas', 'corredor_wkt']);
  return registrosACursos(registros, { primeraFila: 2 });
}
