/* eslint-disable security/detect-non-literal-fs-filename -- prueba que lee/escribe rutas del propio repo o de un directorio temporal; ninguna ruta ni patrón viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import * as fs from 'node:fs';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { generarDesgloseXlsx, fechaLarga, type DatosDesglose } from './desglose_xlsx';
import { DESGLOSE_SINTETICO, type DesgloseFixture } from './desglose.fixture';

function datosDe(f: DesgloseFixture): DatosDesglose {
  return {
    operador: f.operador.nombre, unidad: f.unidad, bitacora: f.bitacora, desde: f.desde, hasta: f.hasta, dias: f.dias,
    percepciones: f.percepciones.map((r) => ({ concepto: r.descripcion, monto: r.monto })),
    deducciones: f.deducciones.map((r) => ({ concepto: r.descripcion, monto: r.monto, ...(r.vale ? { vale: r.vale } : {}) })),
    totalPercepciones: f.esperado.percepciones, totalDeducciones: f.esperado.deducciones, neto: f.esperado.neto,
  };
}
const leer = (b: Uint8Array) => XLSX.read(b, { type: 'array' });
const hoja = (b: Uint8Array) => leer(b).Sheets['Desglose'];
const val = (h: XLSX.WorkSheet, ref: string) => h[ref]?.v;

/** Extrae una parte del zip (entradas deflate) para inspeccionar el XML. */
function parte(bytes: Uint8Array, nombre: string): string {
  const buf = Buffer.from(bytes);
  let o = 0;
  while (buf.readUInt32LE(o) === 0x04034b50) {
    const metodo = buf.readUInt16LE(o + 8), csz = buf.readUInt32LE(o + 18), n = buf.readUInt16LE(o + 26), x = buf.readUInt16LE(o + 28);
    const nom = buf.toString('utf8', o + 30, o + 30 + n), ini = o + 30 + n + x;
    if (nom === nombre) return (metodo === 8 ? inflateRawSync(buf.subarray(ini, ini + csz)) : buf.subarray(ini, ini + csz)).toString('utf8');
    o = ini + csz;
  }
  throw new Error(`parte ${nombre} no encontrada`);
}

describe('generarDesgloseXlsx (fixture sintético)', () => {
  const bytes = generarDesgloseXlsx(datosDe(DESGLOSE_SINTETICO));
  const h = hoja(bytes);
  // Sin marca: fila 1 = Operador; grupo en fila 6, cabeceras 7, cuerpo desde la 8.
  it('encabezado: operador, fechas largas y días', () => {
    expect(val(h, 'A1')).toBe('Operador:');
    expect(val(h, 'B1')).toBe('Operador Ejemplo Uno');
    expect(val(h, 'B3')).toBe('viernes, 9 de octubre de 2026');
    expect(val(h, 'B4')).toBe('miércoles, 14 de octubre de 2026');
    expect(val(h, 'G4')).toBe('6 días');
    expect(val(h, 'B2')).toBe('0001');
    expect(val(h, 'D2')).toBe('B-0001');
  });
  it('cabeceras de bloque y de columna', () => {
    expect(val(h, 'A6')).toBe('Percepción');
    expect(val(h, 'C6')).toBe('Deducción');
    expect([val(h, 'A7'), val(h, 'B7'), val(h, 'C7'), val(h, 'D7'), val(h, 'E7')]).toEqual(['Monto', 'Concepto', 'Monto', 'Concepto', 'No Vale']);
  });
  it('percepción #1 y deducción #3 con No Vale como texto', () => {
    expect(val(h, 'A8')).toBe(4000);
    expect(val(h, 'B8')).toBe('Sueldo');
    expect(val(h, 'E10')).toBe('100001');
    expect(typeof val(h, 'E10')).toBe('string');
    expect(val(h, 'D10')).toBe('Anticipo Ciudad Ejemplo');
    expect(val(h, 'C10')).toBe(1000);
  });
  it('totales y neto = los de la fuente, como número', () => {
    expect(val(h, 'A20')).toBe(9850.5);
    expect(val(h, 'C20')).toBe(5000.5);
    expect(val(h, 'G7')).toBe(4850);
    expect(val(h, 'G6')).toBe('Total');
  });
  it('0 fórmulas y hoja Desglose, horizontal ajustada a una página', () => {
    expect(leer(bytes).SheetNames).toEqual(['Desglose']);
    const x = parte(bytes, 'xl/worksheets/sheet1.xml');
    expect(x.includes('<f>') || x.includes('<f ')).toBe(false);
    expect(x).toContain('orientation="landscape"');
    expect(x).toContain('fitToPage="1"');
  });
  it('mínimo 12 filas de cuerpo; con 14 conceptos se amplía a 14', () => {
    const f = datosDe(DESGLOSE_SINTETICO);
    expect(val(h, 'A19')).toBeUndefined(); // 8 + 12 = fila 20 es el total; la 19 es la última del cuerpo (vacía)
    const muchos: DatosDesglose = { ...f, percepciones: Array.from({ length: 14 }, (_, i) => ({ concepto: `C${i}`, monto: 1 })), totalPercepciones: 14 };
    const h2 = hoja(generarDesgloseXlsx(muchos));
    expect(val(h2, 'B21')).toBe('C13');
    expect(val(h2, 'A22')).toBe(14);
  });
  it('ningún texto contiene Likida ni razón social; sin marca por defecto', () => {
    const ss = JSON.stringify(XLSX.utils.sheet_to_json(h, { header: 1 }));
    expect(ss).not.toMatch(/likida/i);
    const todo = ['xl/worksheets/sheet1.xml', 'xl/workbook.xml'].map((p) => parte(bytes, p)).join('');
    expect(todo).not.toMatch(/likida/i);
    expect(val(h, 'A1')).toBe('Operador:');
  });
  it('determinista: mismos datos, mismos bytes', () => {
    const otra = generarDesgloseXlsx(datosDe(DESGLOSE_SINTETICO));
    expect(Buffer.from(otra).equals(Buffer.from(bytes))).toBe(true);
  });
  it('renglón de viaje activo aparece como «Pago de viaje 5 500.50»', () => {
    const f = datosDe(DESGLOSE_SINTETICO);
    const conViaje: DatosDesglose = { ...f, percepciones: [{ concepto: 'Pago de viaje', monto: 5500.5 }, ...f.percepciones.slice(2)] };
    const h2 = hoja(generarDesgloseXlsx(conViaje));
    expect(val(h2, 'B8')).toBe('Pago de viaje');
    expect(val(h2, 'A8')).toBe(5500.5);
  });
  it('sin totales de la fuente se suman en centavos (sin error de coma flotante)', () => {
    const h2 = hoja(generarDesgloseXlsx({ operador: 'X', desde: '2026-10-09', hasta: '2026-10-09', percepciones: [{ concepto: 'a', monto: 0.1 }, { concepto: 'b', monto: 0.2 }], deducciones: [] }));
    expect(val(h2, 'A20')).toBe(0.3);
    expect(val(h2, 'G7')).toBe(0.3);
    expect(val(h2, 'G4')).toBe('1 días');
  });
  it('días por defecto hasta−desde+1', () => {
    const f = { ...datosDe(DESGLOSE_SINTETICO), dias: undefined };
    expect(val(hoja(generarDesgloseXlsx(f)), 'G4')).toBe('6 días');
  });
  it('texto con = queda literal y marca opcional se escribe solo si se pasa', () => {
    const h2 = hoja(generarDesgloseXlsx({ operador: '=CMD()', desde: '2026-10-09', hasta: '2026-10-09', percepciones: [], deducciones: [], marca: 'Marca Prueba' }));
    expect(val(h2, 'A1')).toBe('Marca Prueba');
    expect(val(h2, 'B2')).toBe('=CMD()');
    expect(h2['B2'].f).toBeUndefined();
  });
  it('escrito a tmp pesa < 10 KB y se abre con XLSX.readFile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'desglose-'));
    try {
      const p = join(dir, 'desglose.xlsx');
      XLSX.set_fs(fs);
      writeFileSync(p, bytes);
      const escrito = readFileSync(p);
      expect(escrito.length).toBeLessThan(10_240);
      expect(XLSX.readFile(p).SheetNames).toEqual(['Desglose']);
      expect(escrito.length).toBe(bytes.length);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('fechaLarga', () => {
  it('los 7 días de la semana (2026-10-04 domingo … 10-10 sábado)', () => {
    const esperado = ['domingo, 4', 'lunes, 5', 'martes, 6', 'miércoles, 7', 'jueves, 8', 'viernes, 9', 'sábado, 10'];
    esperado.forEach((e, i) => expect(fechaLarga(`2026-10-${String(4 + i).padStart(2, '0')}`)).toBe(`${e} de octubre de 2026`));
  });
  it('los 12 meses', () => {
    const m = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    m.forEach((n, i) => expect(fechaLarga(`2026-${String(i + 1).padStart(2, '0')}-15`)).toContain(` de ${n} de 2026`));
  });
  it('rechaza fechas mal formadas o inexistentes', () => {
    expect(() => fechaLarga('2026-02-30')).toThrow();
    expect(() => fechaLarga('9/10/2026')).toThrow();
  });
});

// Local-only: cifras reales fuera del repo (env LIKIDA_DESGLOSE_REAL_JSON), con el tipo DesgloseFixture.
const REAL = process.env.LIKIDA_DESGLOSE_REAL_JSON;
describe.skipIf(!REAL)('local-only: desglose real', () => {
  it('sale con los totales esperados', () => {
    const f = JSON.parse(readFileSync(REAL as string, 'utf8')) as DesgloseFixture;
    const h = hoja(generarDesgloseXlsx(datosDe(f)));
    const filas = Math.max(12, f.percepciones.length, f.deducciones.length);
    expect(val(h, `A${8 + filas}`)).toBe(f.esperado.percepciones);
    expect(val(h, `C${8 + filas}`)).toBe(f.esperado.deducciones);
    expect(val(h, 'G7')).toBe(f.esperado.neto);
    expect(val(h, 'G4')).toBe(`${f.dias} días`);
    expect(val(h, 'B3')).toBe(fechaLarga(f.desde));
  });
});
