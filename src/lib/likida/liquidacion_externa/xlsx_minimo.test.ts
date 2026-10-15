import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import * as XLSX from 'xlsx';
import { crearLibro, escaparXml, letraColumna, type OpcionesLibro } from './xlsx_minimo';
import { inflateRawSync } from 'node:zlib';
import { validarXmlEntrante } from '../buzon/xml_seguro';

// ═══════════════════════════════════════════════════════════════════════════
// ESCRITOR XLSX MÍNIMO: valores (nunca fórmulas), estilos, determinista.
// Fixtures 100 % sintéticos.
// ═══════════════════════════════════════════════════════════════════════════

const estilos: NonNullable<OpcionesLibro['estilos']> = {
  cab: { fuente: { negrita: true, color: 'FFFFFF', tam: 12 }, relleno: '404040', alineacion: { h: 'center', v: 'center' }, borde: { izq: 'thin', der: 'thin', arr: 'thin', aba: 'thin' } },
  monto: { formato: 'contable', borde: { aba: 'dotted' } },
  texto: { formato: 'texto', alineacion: { ajustar: true } },
};

function ejemplo(): OpcionesLibro {
  const celdas: OpcionesLibro['celdas'][number][] = [
    { fila: 1, col: 1, valor: 'Percepción', estilo: 'cab' },
    { fila: 1, col: 2, valor: '', estilo: 'cab' },
    { fila: 1, col: 4, valor: 'Deducción', estilo: 'cab' },
  ];
  for (let f = 2; f <= 12; f++) {
    celdas.push({ fila: f, col: 1, valor: f * 100.5, estilo: 'monto' });
    celdas.push({ fila: f, col: 2, valor: `Concepto ${f}`, estilo: 'texto' });
  }
  for (let c = 3; c <= 8; c++) celdas.push({ fila: 12, col: c, valor: c });
  return {
    hoja: 'Desglose', celdas, estilos,
    combinaciones: [{ filaDesde: 1, colDesde: 1, filaHasta: 1, colHasta: 2 }, { filaDesde: 1, colDesde: 4, filaHasta: 1, colHasta: 6 }],
    anchos: { 1: 16, 2: 30, 4: 12 }, alturas: { 1: 24 },
    orientacion: 'landscape', ajustarAnchoPagina: true,
  };
}

/** Lector de zip mínimo de la prueba (el lector seguro del buzón omite archivos «.rels» por empezar con punto). */
function descomprimir(b: Uint8Array): Record<string, string> {
  const buf = Buffer.from(b);
  const eocd = buf.length - 22;
  expect(buf.readUInt32LE(eocd)).toBe(0x06054b50);
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < total; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const metodo = buf.readUInt16LE(p + 10);
    const tam = buf.readUInt32LE(p + 20);
    const n = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const com = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.subarray(p + 46, p + 46 + n).toString('utf8');
    // el encabezado local debe llevar el MISMO nombre
    const nl = buf.readUInt16LE(local + 26);
    expect(buf.subarray(local + 30, local + 30 + nl).toString('utf8')).toBe(nombre);
    const ini = local + 30 + nl + buf.readUInt16LE(local + 28);
    const datos = buf.subarray(ini, ini + tam);
    out[nombre] = (metodo === 8 ? inflateRawSync(datos) : datos).toString('utf8');
    p += 46 + n + extra + com;
  }
  return out;
}
const partes = (b: Uint8Array) => {
  const crudo = descomprimir(b);
  return Object.fromEntries(Object.entries(crudo).map(([k, v]) => [k.split('/').pop()!, v]));
};

describe('crearLibro', () => {
  it('relectura con SheetJS: celdas, merges, anchos y números = lo escrito', () => {
    const wb = XLSX.read(crearLibro(ejemplo()), { type: 'array', cellStyles: true });
    expect(wb.SheetNames).toEqual(['Desglose']);
    const ws = wb.Sheets['Desglose']!;
    expect(ws['A1']!.v).toBe('Percepción');
    expect(ws['D1']!.v).toBe('Deducción');
    expect(ws['A2']!.v).toBe(201);
    expect(ws['A2']!.t).toBe('n');
    expect(ws['B3']!.v).toBe('Concepto 3');
    expect(ws['A12']!.v).toBe(1206);
    expect(ws['H12']!.v).toBe(8);
    expect((ws['!merges'] ?? []).map((m) => XLSX.utils.encode_range(m)).sort()).toEqual(['A1:B1', 'D1:F1']);
    const cols = ws['!cols']!;
    // SheetJS convierte ancho<->píxeles con redondeo: aquí solo se exige cercanía; el valor exacto se fija en el XML.
    expect(Math.abs(cols[0]!.wch! - 16)).toBeLessThan(1);
    expect(Math.abs(cols[1]!.wch! - 30)).toBeLessThan(1);
    expect(Math.abs(cols[3]!.wch! - 12)).toBeLessThan(1);
    const xml = partes(crearLibro(ejemplo()))['sheet1.xml']!;
    expect(xml).toContain('<col min="1" max="1" width="16" customWidth="1"/>');
    expect(xml).toContain('<col min="2" max="2" width="30" customWidth="1"/>');
    expect(xml).toContain('<row r="1" ht="24" customHeight="1">');
    expect(ws['!ref']).toBe('A1:H12');
  });

  it('nunca escribe fórmulas: 0 etiquetas <f>', () => {
    const p = partes(crearLibro(ejemplo()));
    expect((p['sheet1.xml']!.match(/<f[ >]/g) ?? []).length).toBe(0);
    expect(p['sheet1.xml']).not.toContain('<f>');
    for (const [, v] of Object.entries(p)) expect(v).not.toContain('<f>');
  });

  it('texto con =CMD() y otros prefijos queda como texto literal (inlineStr)', () => {
    const peligrosos = ['=CMD()', '+SUMA(A1)', '-2+3', '@SUM(A1)', '=HYPERLINK("http://x","y")'];
    const celdas = peligrosos.map((valor, i) => ({ fila: i + 1, col: 1, valor }));
    const b = crearLibro({ hoja: 'H', celdas });
    const sheet = partes(b)['sheet1.xml']!;
    expect(sheet).not.toMatch(/<f[ >]/);
    expect(sheet.match(/t="inlineStr"/g)!.length).toBe(peligrosos.length);
    const ws = XLSX.read(b, { type: 'array' }).Sheets['H']!;
    peligrosos.forEach((p, i) => {
      expect(ws[`A${i + 1}`]!.t).toBe('s');
      expect(ws[`A${i + 1}`]!.v).toBe(p);
      expect(ws[`A${i + 1}`]!.f).toBeUndefined();
    });
  });

  it('styles.xml bien formado (parser seguro), con contable, relleno, bordes y sin DTD', () => {
    const p = partes(crearLibro(ejemplo()));
    for (const nombre of ['styles.xml', 'sheet1.xml', 'workbook.xml', '[Content_Types].xml', 'workbook.xml.rels', '.rels']) {
      const r = validarXmlEntrante(new Uint8Array(Buffer.from(p[nombre]!, 'utf8')));
      expect(r.ok, nombre).toBe(true);
    }
    const s = p['styles.xml']!;
    expect(s).toContain('numFmtId="164"');
    expect(s).toContain('#,##0.00');
    expect(s).toContain('patternType="solid"');
    expect(s).toContain('style="dotted"');
    expect(s).toContain('<b/>');
    // contadores coherentes
    const n = (tag: string) => Number(new RegExp(`<${tag} count="(\\d+)"`).exec(s)![1]);
    expect(n('fonts')).toBe((s.match(/<font>/g) ?? []).length);
    expect(n('fills')).toBe((s.match(/<fill>/g) ?? []).length);
    expect(n('borders')).toBe((s.match(/<border>/g) ?? []).length);
    expect(n('cellXfs')).toBe(1 + Object.keys(estilos).length);
  });

  it('configuración de impresión: horizontal, ajustada al ancho, centrada', () => {
    const sheet = partes(crearLibro(ejemplo()))['sheet1.xml']!;
    expect(sheet).toContain('<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>');
    expect(sheet).toContain('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
    expect(sheet).toContain('<printOptions horizontalCentered="1"/>');
    expect(sheet).toContain('<mergeCells count="2">');
  });

  it('área de impresión definida en workbook.xml', () => {
    const p = partes(crearLibro({ ...ejemplo(), areaImpresion: { filaDesde: 1, colDesde: 1, filaHasta: 14, colHasta: 8 } }));
    expect(p['workbook.xml']).toContain('_xlnm.Print_Area');
    expect(p['workbook.xml']).toContain('$A$1:$H$14');
  });

  it('determinista: mismo input => mismos bytes (sha256)', () => {
    const h = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
    expect(h(crearLibro(ejemplo()))).toBe(h(crearLibro(ejemplo())));
    const otro = ejemplo();
    otro.celdas = [...otro.celdas, { fila: 20, col: 1, valor: 'x' }];
    expect(h(crearLibro(otro))).not.toBe(h(crearLibro(ejemplo())));
  });

  it('sin metadatos de autor, macros ni hojas ocultas', () => {
    expect(Object.keys(descomprimir(crearLibro(ejemplo()))).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
    const p = partes(crearLibro(ejemplo()));
    const todo = Object.values(p).join('\n');
    expect(todo).not.toMatch(/creator|lastModifiedBy|vbaProject|state="hidden"|state="veryHidden"/i);
  });

  it('12 filas x 8 columnas pesan < 5 KB comprimido', () => {
    const celdas: OpcionesLibro['celdas'][number][] = [];
    for (let f = 1; f <= 12; f++) for (let c = 1; c <= 8; c++) celdas.push({ fila: f, col: c, valor: c % 2 ? f * c + 0.25 : `Texto ${f}-${c}`, estilo: c % 2 ? 'monto' : 'texto' });
    const b = crearLibro({ hoja: 'Desglose', celdas, estilos });
    expect(b.length).toBeLessThan(5 * 1024);
  });

  it('escapa & < > " \' y elimina caracteres de control', () => {
    expect(escaparXml(`a&b<c>d"e'f\u0000g\u0007h\ti\nj`)).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;fgh\ti\nj');
    const b = crearLibro({ hoja: 'H', celdas: [{ fila: 1, col: 1, valor: `<x a="1">&'\u0001Z` }] });
    const ws = XLSX.read(b, { type: 'array' }).Sheets['H']!;
    expect(ws['A1']!.v).toBe(`<x a="1">&'Z`);
  });

  it('nombre de hoja inválido se sanea (≤31, sin caracteres prohibidos)', () => {
    const wb = XLSX.read(crearLibro({ hoja: 'a/b:c?*[x]'.padEnd(50, 'z'), celdas: [{ fila: 1, col: 1, valor: 1 }] }), { type: 'array' });
    expect(wb.SheetNames[0]!.length).toBeLessThanOrEqual(31);
    expect(wb.SheetNames[0]).not.toMatch(/[\\/?*[\]:]/);
  });

  it('rechaza entradas inválidas: duplicadas, estilo inexistente, fuera de rango, no finito', () => {
    expect(() => crearLibro({ hoja: 'H', celdas: [{ fila: 1, col: 1, valor: 1 }, { fila: 1, col: 1, valor: 2 }] })).toThrow(/duplicada/);
    expect(() => crearLibro({ hoja: 'H', celdas: [{ fila: 1, col: 1, valor: 1, estilo: 'nada' }] })).toThrow(/estilo/);
    expect(() => crearLibro({ hoja: 'H', celdas: [{ fila: 0, col: 1, valor: 1 }] })).toThrow(/fila/);
    expect(() => crearLibro({ hoja: 'H', celdas: [{ fila: 1, col: 20000, valor: 1 }] })).toThrow(/columna/);
    expect(() => crearLibro({ hoja: 'H', celdas: [{ fila: 1, col: 1, valor: NaN }] })).toThrow(/no finito/);
    expect(() => crearLibro({ hoja: 'H', celdas: [], estilos: { x: { relleno: 'zzz' } } })).toThrow(/color/);
  });

  it('letraColumna', () => {
    expect([1, 26, 27, 52, 53, 702, 703].map(letraColumna)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']);
  });

  it('escribe a os.tmpdir() y relee con XLSX.readFile sin excepción', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xlsx-minimo-'));
    try {
      const ruta = join(dir, 'prueba.xlsx');
      writeFileSync(ruta, crearLibro(ejemplo()));
      XLSX.set_fs(fs);
      const wb = XLSX.readFile(ruta);
      expect(wb.SheetNames).toEqual(['Desglose']);
      expect(wb.Sheets['Desglose']!['A1']!.v).toBe('Percepción');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    void gzipSync;
  });
});
