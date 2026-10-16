// Generador SINTÉTICO de la plantilla «normal» del TMS con la FORMA real (análisis 17 §1.2): ni un valor de las muestras.
//
// Se escribe a mano, con coordenadas literales y SIN importar el layout, para poder contrastar el layout contra la forma
// real: si el layout se equivoca de celda, las pruebas lo ven. Tiene dos variantes:
//   · `plantillaNormalRealEnBlanco()`: 4 hojas, rótulos en A, notas en B (11..47) y en C1:C8, C36 y C37, instrucciones
//     genéricas como comentarios de celda y los encabezados de las dos tablas.
//   · `plantillaNormalRealLlena()`: lo mismo con valores inventados (régimen/referencia/cliente/caja en B5..B8, remitente en
//     C11..C26, una fila de destino y dos de mercancía). Es también el formato de entrada A para el lector (T-A3-47).
import * as XLSX from 'xlsx';
import { rfcValido } from '../documentos_sinteticos.fixture';

export const HOJAS_REAL = ['RemintenteDestinatario', 'Mercancias', 'Error', 'Informacion Agente Aduanal'] as const;

/** Celdas que la plantilla reserva para notas o instrucciones: el sistema jamás las escribe. */
export const CELDAS_NO_TOCAR: readonly string[] = [
  ...Array.from({ length: 8 }, (_, i) => `C${i + 1}`),
  'C36', 'C37',
  // B9..B47: notas, rótulos de sección y los «NO LLENAR ESTE CAMPO» del bloque destinatario.
  ...Array.from({ length: 39 }, (_, i) => `B${i + 9}`),
  // Todo el bloque destinatario (filas 29..47): en B dice «NO LLENAR» y en C no se llena.
  ...Array.from({ length: 19 }, (_, i) => `C${i + 29}`),
];

/** Celdas fijas de la hoja RemintenteDestinatario donde SÍ se escribe un valor. */
export const CELDAS_LLENABLES: readonly string[] = [
  'B5', 'B6', 'B7', 'B8',
  ...[11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26].map((n) => `C${n}`),
];

/** Columnas de la tabla de destinos (fila 49) y de mercancías (fila 21), por letra. */
export const ENCABEZADOS_DESTINOS = ['IdDestino', 'Distancia', 'Razon Social', 'RFC', 'Calle', 'Num Ext', 'Num Int', 'Clave Colonia', 'Colonia', 'CP',
  'Clave Localidad', 'Localidad', 'Clave Municipio', 'Municipio', 'Clave Estado', 'Estado', 'Pais', 'Contacto', 'Telefono', 'Correo'] as const;
export const ENCABEZADOS_MERCANCIAS = ['Id Destino', 'Bienes Transportados', 'Descripcion', 'Cantidad', 'Clave Unidad', 'Unidad', 'Embalaje',
  'Descripcion del embalaje', 'Peso en Kilogramos', 'Fraccion Arancelaria', 'Numero de Pedimento', 'Material Peligroso',
  'Clave Material Peligroso', 'Tipo de Materia', 'RFC Importador'] as const;

const LETRAS = 'ABCDEFGHIJKLMNOPQRST';

/** Rótulos de la columna A de RemintenteDestinatario (fila → rótulo). Genéricos: son rótulos del formulario, no datos. */
const ROTULOS_A: Record<number, string> = {
  5: 'REGIMEN ADUANERO', 6: 'Referencia Interna Cliente (LLENA CLIENTE)', 7: 'Cliente (LLENA EL OPERADOR DEL TMS)', 8: 'Numero de caja (LLENA CLIENTE)',
  9: 'REMITENTE/EMBARCADOR', 10: 'Informacion Solicitada', 11: '*Razon Social Embarcador', 12: '*RFC o Tax ID Embarcador', 13: 'DOMICILIO DE CARGA',
  14: 'Calle', 15: 'Numero Exterior', 16: 'Numero Interior', 17: '*Clave de Colonia (clave SAT)', 18: 'Colonia (SAT)', 19: '*Codigo Postal',
  20: '*Clave Localidad (clave SAT)', 21: 'Localidad', 22: '*Clave de Municipio (clave SAT)', 23: '*Municipio (SAT)', 24: '*Clave Estado (clave SAT)',
  25: '*Estado (SAT)', 26: '*Pais (clave SAT)', 27: 'DESTINATARIO: LLENAR SOLO LOS CAMPOS EN LA TABLA', 28: 'Informacion Solicitada: Instructivo',
  29: '*Distancia Total Origen-destino', 30: '*Razon Social', 31: '*RFC', 32: 'Calle', 33: 'Numero Exterior', 34: 'Numero Interior',
  35: '*Clave de Colonia (clave SAT)', 36: '*Colonia (SAT)', 37: '*Codigo Postal', 38: '*Clave Localidad (clave SAT)', 39: '*Localidad',
  40: '*Clave de Municipio (clave SAT)', 41: '*Municipio (SAT)', 42: '*Clave Estado (clave SAT)', 43: '*Pais (clave SAT)', 44: 'Estado (SAT)',
  45: 'Contacto', 46: 'Telefono', 47: 'Correo Contacto', 48: 'DESTINATARIO: LLENAR SOLO LOS CAMPOS EN LA TABLA',
};

type Celdas = Record<string, { v: string | number; c?: string }>;

function hoja(celdas: Celdas): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maxF = 0; let maxC = 0;
  for (const [coord, { v, c }] of Object.entries(celdas)) {
    const cel: XLSX.CellObject = typeof v === 'number' ? { t: 'n', v } : { t: 's', v };
    if (c) cel.c = [{ a: 'plantilla', t: c }];
    ws[coord] = cel;
    const d = XLSX.utils.decode_cell(coord);
    maxF = Math.max(maxF, d.r); maxC = Math.max(maxC, d.c);
  }
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxF, c: maxC } });
  return ws;
}

function celdasRemitenteEnBlanco(): Celdas {
  const out: Celdas = {};
  for (const [fila, rotulo] of Object.entries(ROTULOS_A)) out[`A${fila}`] = { v: rotulo };
  out.A5 = { v: ROTULOS_A[5], c: 'Clave del regimen segun la hoja de informacion del agente aduanal' };
  out.A8 = { v: ROTULOS_A[8], c: 'Maximo 15 caracteres' };
  // Notas de instrucción (C1:C8, C36, C37) y notas en B (9..47).
  for (let n = 1; n <= 8; n++) out[`C${n}`] = { v: `Nota de instruccion ${n}` };
  for (let n = 9; n <= 26; n++) if (n !== 13) out[`B${n}`] = { v: 'Instruccion de llenado' };
  for (let n = 29; n <= 47; n++) out[`B${n}`] = { v: n === 35 || n === 36 || (n >= 38 && n <= 44) ? 'Se obtiene de catalogo' : 'NO LLENAR ESTE CAMPO' };
  out.C36 = { v: 'Completar en la tabla de abajo, uno por renglon' };
  out.C37 = { v: 'Completar en la tabla de abajo, uno por renglon' };
  // Tabla de destinos: encabezado fila 49, A..T; comentarios genéricos como los de la plantilla real.
  ENCABEZADOS_DESTINOS.forEach((h, i) => { out[`${LETRAS[i]}49`] = { v: h }; });
  out.B49 = { v: ENCABEZADOS_DESTINOS[1], c: 'Solo numeros, sin KM ni millas' };
  out.C49 = { v: ENCABEZADOS_DESTINOS[2], c: 'Sin puntos ni comas' };
  out.O49 = { v: ENCABEZADOS_DESTINOS[14], c: 'Clave en letras' };
  return out;
}

function celdasMercanciasEnBlanco(): Celdas {
  const out: Celdas = { A4: { v: 'INFORMACION DE MERCANCIA PARA CADA EMBARQUE' }, B4: { v: 'Catalogos (catalogos del SAT)' } };
  for (let n = 5; n <= 17; n++) { out[`A${n}`] = { v: `Instructivo de la columna ${n - 4}` }; out[`B${n}`] = { v: 'Se obtiene del catalogo' }; }
  ENCABEZADOS_MERCANCIAS.forEach((h, i) => { out[`${LETRAS[i]}21`] = { v: h }; });
  return out;
}

function libro(rd: Celdas, me: Celdas): XLSX.WorkBook {
  const l = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(l, hoja(rd), 'RemintenteDestinatario');
  XLSX.utils.book_append_sheet(l, hoja(me), 'Mercancias');
  XLSX.utils.book_append_sheet(l, hoja({ A1: { v: 'Descripcion del error' } }), 'Error');
  XLSX.utils.book_append_sheet(l, hoja({ A1: { v: 'Regimen' }, B1: { v: 'Descripcion' }, A2: { v: 'IMD' }, B2: { v: 'Importacion definitiva' }, A3: { v: 'EXD' }, B3: { v: 'Exportacion definitiva' } }), 'Informacion Agente Aduanal');
  return l;
}

const aBytes = (l: XLSX.WorkBook): Uint8Array => new Uint8Array(XLSX.write(l, { type: 'array', bookType: 'xlsx', cellStyles: true }) as ArrayBuffer);

/** La plantilla «normal» vacía: 4 hojas, rótulos, notas, comentarios y encabezados; ningún valor. */
export function plantillaNormalRealEnBlanco(): Uint8Array {
  return aBytes(libro(celdasRemitenteEnBlanco(), celdasMercanciasEnBlanco()));
}

/** Valores inventados de la variante «llenada» (coordenada → valor), la misma forma que el formato de entrada A. */
export const VALORES_LLENA: { remitente: Record<string, string | number>; destino: Record<string, string | number>; mercancias: Array<Record<string, string | number>> } = {
  remitente: {
    B5: 'EXD', B6: 'REF-SINT-001', B7: '000123', B8: 'CAJA-SINT-01',
    C11: 'Embarcador Sintetico SA', C12: rfcValido('AAA010101XXX'), C14: 'Calle Uno', C15: '10', C16: '2', C17: '0001', C18: 'Colonia Uno', C19: '44100', // grep-limpio:ok
    C20: '01', C21: 'Localidad Uno', C22: '039', C23: 'Municipio Uno', C24: 'JAL', C25: 'Jalisco', C26: 'MEX',
  },
  destino: {
    A50: 1, B50: 874.11, C50: 'Destino Sintetico LLC', D50: '58-7654321', E50: 'Street Two', F50: '20', J50: '78040', L50: 'Ciudad Dos', // grep-limpio:ok
    O50: 'NLE', P50: 'Nuevo León', Q50: 'USA', R50: 'Contacto Prueba', S50: '2899900001', T50: 'contacto@example.test', // teléfono sintético: marca 28999 // grep-limpio:ok
  },
  mercancias: [
    { A: 1, B: '43211500', C: 'Equipo de computo', D: 20, E: 'H87', F: 'Pieza', I: 14130, J: '8471500100', K: '24 16 3456 4000123', L: 'NO', M: 'N/A', N: '03' }, // grep-limpio:ok
    { A: 1, B: '24131500', C: 'Botellas vacias', D: 5, E: 'XBX', F: 'Caja', G: '4G', H: 'Caja de carton', I: 80.5, L: 'SI', M: '1203', N: '01' },
  ],
};

/** La misma plantilla ya llenada con `VALORES_LLENA`. */
export function plantillaNormalRealLlena(): Uint8Array {
  const rd = celdasRemitenteEnBlanco();
  const me = celdasMercanciasEnBlanco();
  for (const [k, v] of Object.entries(VALORES_LLENA.remitente)) rd[k] = { v };
  for (const [k, v] of Object.entries(VALORES_LLENA.destino)) rd[k] = { v };
  VALORES_LLENA.mercancias.forEach((m, i) => { for (const [col, v] of Object.entries(m)) me[`${col}${22 + i}`] = { v }; });
  return aBytes(libro(rd, me));
}
