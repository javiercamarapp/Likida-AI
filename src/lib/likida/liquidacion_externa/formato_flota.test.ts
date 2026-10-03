import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { PDFDocument } from 'pdf-lib';
import { matrizDeArchivoCatalogo } from '../peajes/archivo';
import { derivarFormatoDeMatriz, validarFormato, FormatoInvalido, FORMATO_BASE, type FormatoFlota } from './formato_flota';
import { generarExcelFormato, generarPdfFormato, type DatosFormato } from './render_formato';

// ═══════════════════════════════════════════════════════════════════════════
// EL FORMATO DE LA FLOTA: de un Excel de muestra a la plantilla, y de la
// plantilla al PDF y al Excel que recibe el operador.
//
// La muestra es SINTÉTICA (una flota inventada); se construye con la misma
// librería de hojas con la que se leería el archivo real. Cuando llegue el
// formato verdadero del cliente (BLOQUEO EXTERNO), se agrega como fixture y
// se calibra el diccionario de encabezados: una línea por sinónimo nuevo.
// ═══════════════════════════════════════════════════════════════════════════

function excelDeMuestra(filas: unknown[][]): Uint8Array {
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filas), 'Hoja1');
  return new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

const MUESTRA: unknown[][] = [
  ['LIQUIDACIÓN SEMANAL DE OPERADORES'],
  [],
  ['Operador:', 'Juan Pérez'],
  ['Folio liquidación', 'L-100'],
  ['Periodo:', '01/09/2026 al 07/09/2026'],
  [],
  ['Cve.', 'Concepto', 'Percepciones', 'Deducciones', 'Observaciones'],
  ['P010', 'Sueldo base', 3500, '', ''],
  ['D010', 'Anticipo', '', 1000.25, ''],
  [],
  ['', 'Neto a pagar', 2499.75],
];

const DATOS: DatosFormato = {
  claveExterna: 'L-100', sistemaOrigen: 'SAP', operadorNombre: 'Juan Pérez', razonSocial: 'Transportes Ejemplo SA',
  viajes: ['VJ-1', 'VJ-2'], desde: '2026-09-01', hasta: '2026-09-07',
  conceptos: [
    { clave: 'P010', descripcion: 'Sueldo base', tipo: 'percepcion', monto: 3500 },
    { clave: 'D010', descripcion: 'Anticipo', tipo: 'deduccion', monto: 1000.25 },
  ],
  total: 2499.75, moneda: 'MXN',
};

function derivar(filas = MUESTRA) {
  const m = matrizDeArchivoCatalogo('muestra.xlsx', excelDeMuestra(filas));
  if (!m.ok) throw new Error(m.motivo);
  return derivarFormatoDeMatriz(m.matriz);
}

describe('derivar el formato de un Excel de muestra', () => {
  it('reconoce título, datos de arriba, columnas, orden y la fila de total', () => {
    const r = derivar();
    if (!r.ok) throw new Error(r.motivo);
    expect(r.formato.titulo).toBe('LIQUIDACIÓN SEMANAL DE OPERADORES');
    expect(r.formato.columnas).toEqual([
      { encabezado: 'Cve.', campo: 'clave' },
      { encabezado: 'Concepto', campo: 'descripcion' },
      { encabezado: 'Percepciones', campo: 'percepcion' },
      { encabezado: 'Deducciones', campo: 'deduccion' },
    ]);
    expect(r.formato.datos).toEqual([
      { etiqueta: 'Operador', campo: 'operador' },
      { etiqueta: 'Folio liquidación', campo: 'claveExterna' },
      { etiqueta: 'Periodo', campo: 'periodo' },
    ]);
    expect(r.formato.total).toEqual({ mostrar: true, etiqueta: 'Neto a pagar' });
  });

  it('lo que no reconoce NO se inventa: queda en sinMapear', () => {
    const r = derivar();
    if (!r.ok) throw new Error(r.motivo);
    expect(r.sinMapear).toEqual(['Observaciones']);
  });

  it('una muestra sin fila de encabezados reconocible es un error con su motivo, no una plantilla vacía', () => {
    const r = derivar([['hola'], ['mundo', 1]]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/fila de encabezados/);
  });

  it('un encabezado repetido se advierte y se queda la primera columna', () => {
    const r = derivar([['Concepto', 'Importe', 'Monto'], ['x', 1, 1]]);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.formato.columnas.map((c) => c.campo)).toEqual(['descripcion', 'monto']);
    expect(r.advertencias.join(' ')).toMatch(/repite/);
  });

  it('lo derivado pasa la validación estricta', () => {
    const r = derivar();
    if (!r.ok) throw new Error(r.motivo);
    expect(() => validarFormato(r.formato)).not.toThrow();
  });
});

describe('validar un formato', () => {
  const ok = () => structuredClone(FORMATO_BASE) as unknown as Record<string, unknown>;
  it('acepta el formato base', () => { expect(validarFormato(ok()).columnas.length).toBe(4); });
  it('rechaza un campo fuera del catálogo, diciendo cuál', () => {
    const f = ok(); (f.columnas as Array<Record<string, unknown>>)[0].campo = 'tenant_id';
    expect(() => validarFormato(f)).toThrow(FormatoInvalido);
  });
  it('rechaza llaves desconocidas (nada se acepta en silencio)', () => {
    expect(() => validarFormato({ ...ok(), tenant: 'x' })).toThrow(/no existen/);
  });
  it('rechaza dos columnas con el mismo campo y una tabla sin cifra', () => {
    const dup = ok(); (dup.columnas as unknown[]).push({ encabezado: 'Otra', campo: 'clave' });
    expect(() => validarFormato(dup)).toThrow(/dos columnas/);
    const sinCifra = ok(); sinCifra.columnas = [{ encabezado: 'Concepto', campo: 'descripcion' }];
    expect(() => validarFormato(sinCifra)).toThrow(/cifra/);
  });
  it('rechaza un encabezado largo en vez de recortarlo', () => {
    const f = ok(); (f.columnas as Array<Record<string, unknown>>)[0].encabezado = 'x'.repeat(81);
    expect(() => validarFormato(f)).toThrow(/hasta 80/);
  });
});

function formatoDerivado(): FormatoFlota {
  const r = derivar();
  if (!r.ok) throw new Error(r.motivo);
  return r.formato;
}

describe('el Excel que recibe el operador', () => {
  it('lleva el título, los datos, los encabezados de la flota, los renglones y el total del cliente como NÚMERO', () => {
    const bytes = generarExcelFormato(formatoDerivado(), DATOS);
    const libro = XLSX.read(bytes, { type: 'array' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const m = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, defval: null });
    expect(m[0][0]).toBe('LIQUIDACIÓN SEMANAL DE OPERADORES');
    expect(m[2].slice(0, 2)).toEqual(['Operador', 'Juan Pérez']);
    expect(m[3].slice(0, 2)).toEqual(['Folio liquidación', 'L-100']);
    expect(m[4][0]).toBe('Periodo');
    expect(String(m[4][1])).toMatch(/2026.* al .*2026/);
    const filaEnc = m.findIndex((f) => f[0] === 'Cve.');
    expect(m[filaEnc]).toEqual(['Cve.', 'Concepto', 'Percepciones', 'Deducciones']);
    expect(m[filaEnc + 1]).toEqual(['P010', 'Sueldo base', 3500, null]);
    expect(m[filaEnc + 2]).toEqual(['D010', 'Anticipo', null, 1000.25]);
    // El total: etiqueta de la flota y la cifra que mandó el cliente (en la última columna: no hay «Importe»).
    const filaTotal = m.find((f) => f[0] === 'Neto a pagar');
    expect(filaTotal).toBeTruthy();
    expect(filaTotal).toContain(2499.75);
  });

  it('es determinista', () => {
    const a = generarExcelFormato(formatoDerivado(), DATOS);
    const b = generarExcelFormato(formatoDerivado(), DATOS);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('un texto hostil se escribe como TEXTO, nunca como fórmula', () => {
    const hostil: DatosFormato = { ...DATOS, conceptos: [{ clave: '=1+1', descripcion: '=HYPERLINK("http://x","y")', tipo: 'percepcion', monto: 1 }], total: 1 };
    const libro = XLSX.read(generarExcelFormato(formatoDerivado(), hostil), { type: 'array' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    for (const [k, c] of Object.entries(hoja)) {
      if (k.startsWith('!')) continue;
      expect((c as XLSX.CellObject).f, `la celda ${k} no debe ser fórmula`).toBeUndefined();
    }
    const m = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, defval: null });
    expect(m.some((f) => f[1] === '=HYPERLINK("http://x","y")')).toBe(true);
  });

  it('sin fila de total cuando la flota la oculta', () => {
    const f = formatoDerivado(); f.total = { mostrar: false, etiqueta: 'Total' };
    const m = XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(generarExcelFormato(f, DATOS), { type: 'array' }).Sheets.Liquidación, { header: 1, defval: null });
    expect(m.find((x) => x[0] === 'Total' || x[0] === 'Neto a pagar')).toBeUndefined();
  });

  it('con una columna de importe, el total cae en ESA columna', () => {
    const f: FormatoFlota = validarFormato({ ...FORMATO_BASE, columnas: [{ encabezado: 'Concepto', campo: 'descripcion' }, { encabezado: 'Importe neto', campo: 'montoFirmado' }] });
    const m = XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(generarExcelFormato(f, DATOS), { type: 'array' }).Sheets.Liquidación, { header: 1, defval: null });
    expect(m.find((x) => x[0] === 'Anticipo')).toEqual(['Anticipo', -1000.25]);
    expect(m.find((x) => x[0] === 'Total a pagar')).toEqual(['Total a pagar', 2499.75]);
  });
});

describe('el PDF en el formato de la flota', () => {
  it('es un PDF válido y determinista', async () => {
    const a = await generarPdfFormato(formatoDerivado(), DATOS);
    const b = await generarPdfFormato(formatoDerivado(), DATOS);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const doc = await PDFDocument.load(a);
    expect(doc.getPageCount()).toBe(1);
    expect(Buffer.from(a).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('cambia con una cifra distinta (no ignora los datos)', async () => {
    const a = await generarPdfFormato(formatoDerivado(), DATOS);
    const b = await generarPdfFormato(formatoDerivado(), { ...DATOS, total: 2499.76 });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('pagina cuando hay muchos renglones y no truena con texto hostil o fuera de Latin-1', async () => {
    const muchos: DatosFormato = {
      ...DATOS,
      operadorNombre: 'Ñandú 😀 \u0007 Pérez',
      conceptos: Array.from({ length: 100 }, (_, i) => ({ clave: `P${i}`, descripcion: `Concepto ${i} ${'largo '.repeat(30)}→ 😀`, tipo: i % 2 ? 'deduccion' as const : 'percepcion' as const, monto: i + 0.5 })),
    };
    const doc = await PDFDocument.load(await generarPdfFormato(formatoDerivado(), muchos));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
