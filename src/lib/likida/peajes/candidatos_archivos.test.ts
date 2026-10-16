import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('el reporte no toca la base'); } }));

const { revisarCobros } = await import('./reglas_cobro');
const { evaluarContraTarifa } = await import('./reglas_tarifa');
const { normalizarTag } = await import('./formatos');
const {
  armarCandidatos, candidatosAExcel, candidatosACsv, resumirCandidatos, ENCABEZADOS_CANDIDATOS, CATEGORIAS_ARCHIVO, ETIQUETA_CATEGORIA_ARCHIVO,
} = await import('./candidatos_archivos');
const { parsearArchivoDesglose } = await import('../intake/desglose_peaje');
import type { LineaCobro } from './reglas_cobro';
import type { TarifaExistente } from './tarifario_archivo';

// Todo SINTÉTICO: casetas, TAGs y unidades inventados, sin relación con ninguna flota.
const CASETA = 'Caseta Ejemplo Norte';
const l = (indice: number, p: Partial<LineaCobro> = {}): LineaCobro => ({
  indice, fecha: '2026-03-05', hora: '10:00:00', caseta: CASETA, tag: `IMDM0000000${indice}`, unidad: `10${indice}`, clase: 5, monto: 100, ...p,
});
const tarifa = (p: Partial<TarifaExistente> = {}): TarifaExistente => ({
  casetaNorm: 'caseta ejemplo norte', clase: 5, importe: 100, vigenteDesde: '2026-01-01', vigenteHasta: null, origen: 'proveedor', confirmada: true, confirmadaPor: 'f', ...p,
});

// 0: clase 9 (400) · 1: extemporáneo (250) · 2 y 3: duplicado exacto · 4: cobra 130 con tarifa 100 (clase 5) · 5: TAG de baja · 6: caseta prohibida · 7: limpia · 8: unidad en taller (T-A2-36)
const lineas: LineaCobro[] = [
  l(0, { clase: 9, monto: 400 }),
  l(1, { fecha: '2026-02-27', monto: 100, tag: 'IMDM1', unidad: '201' }),
  l(2, { tag: 'IMDM2', unidad: '202', hora: '11:00:00' }),
  l(3, { tag: 'IMDM2', unidad: '202', hora: '11:00:00' }),
  l(4, { monto: 130, caseta: 'Caseta Ejemplo Sur', tag: 'IMDM4', unidad: '204' }),
  l(5, { tag: 'IMDM5', unidad: '205', caseta: 'Caseta Ejemplo Este', fecha: '2026-03-08' }),
  l(6, { tag: 'IMDM6', unidad: '206', caseta: 'Caseta Prohibida Uno' }),
  l(7, { tag: 'IMDM7', unidad: '207', caseta: 'Caseta Ejemplo Oeste' }),
  l(8, { tag: 'IMDM8', unidad: '208', caseta: 'Caseta Ejemplo Oeste', fecha: '2026-03-04' }),
];
const reglas = {
  periodoDesde: '2026-03-01',
  tagsBaja: new Map([[normalizarTag('IMDM5') as string, '2026-03-01']]),
  casetasNoCruzar: new Set(['caseta prohibida uno']),
  inmovilizadasPorTag: new Map([[normalizarTag('IMDM8') as string, [{ desde: '2026-03-03', hasta: '2026-03-05', motivo: 'taller' as const }]]]),
};
const tarifas = [tarifa(), tarifa({ casetaNorm: 'caseta ejemplo sur' }), tarifa({ casetaNorm: 'caseta ejemplo oeste', confirmada: false, origen: 'inferida', confirmadaPor: null })];

function reporte(o: { lineas?: LineaCobro[]; excluir?: Set<never> | Set<string>; tarifas?: TarifaExistente[] } = {}) {
  const ls = o.lineas ?? lineas;
  const revision = revisarCobros(ls, reglas);
  const evaluadas = evaluarContraTarifa(ls, o.tarifas ?? tarifas);
  return armarCandidatos({
    proveedor: 'Proveedor Ejemplo', archivoNombre: '01 A 10 DE MARZO.xlsx', periodoDesde: '2026-03-01', periodoHasta: '2026-03-10',
    revision, evaluadas, excluir: o.excluir as never,
  });
}

const leer = (u: Uint8Array) => XLSX.read(Buffer.from(u), { type: 'buffer' });

describe('las hojas', () => {
  it('una hoja por categoría con candidatos, en el orden de la ficha, más Resumen y Léeme', () => {
    const r = reporte();
    const libro = leer(candidatosAExcel(r));
    const cats = [...new Set(r.filas.map((f) => f.categoria))];
    expect(cats.sort()).toEqual([...CATEGORIAS_ARCHIVO].sort());
    expect(libro.SheetNames).toEqual([...CATEGORIAS_ARCHIVO.map((c) => ETIQUETA_CATEGORIA_ARCHIVO[c]), 'Resumen', 'Léeme']);
  });

  it('cada hoja trae las columnas del archivo original y lo del reclamo, y NO la interpretación interna', () => {
    const libro = leer(candidatosAExcel(reporte()));
    for (const nombre of libro.SheetNames.slice(0, 6)) {
      const filas = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[nombre], { header: 1 });
      expect(filas[0]).toEqual([...ENCABEZADOS_CANDIDATOS]);
    }
    const todo = JSON.stringify(libro.SheetNames.map((n) => XLSX.utils.sheet_to_json(libro.Sheets[n], { header: 1 }))).toLowerCase();
    expect(todo).not.toMatch(/confianza|gps|evidencia/);
  });

  it('el estado es «Candidato» salvo la diferencia contra una tarifa CONFIRMADA', () => {
    const r = reporte();
    const sobre = r.filas.filter((f) => f.categoria === 'importe_sobre_tarifa');
    expect(sobre).toHaveLength(1);
    expect(sobre[0]).toMatchObject({ indice: 4, importe: 130, importeEsperado: 100, claseEsperada: 5, montoReclamar: 30, estado: 'indebido confirmado' });
    expect(r.filas.filter((f) => f.categoria !== 'importe_sobre_tarifa').every((f) => f.estado === 'candidato')).toBe(true);

    const inferida = reporte({ tarifas: [tarifa({ casetaNorm: 'caseta ejemplo sur', confirmada: false, origen: 'inferida', confirmadaPor: null })] });
    expect(inferida.filas.find((f) => f.categoria === 'importe_sobre_tarifa')?.estado).toBe('candidato');
  });

  it('los montos suman igual que el resumen, y una línea en dos categorías no se cuenta dos veces', () => {
    const r = reporte();
    const s = resumirCandidatos(r);
    for (const c of CATEGORIAS_ARCHIVO) {
      const suma = Math.round(r.filas.filter((f) => f.categoria === c).reduce((a, f) => a + (f.montoReclamar ?? 0), 0) * 100) / 100;
      expect(s.porCategoria[c].monto).toBe(suma);
      expect(s.porCategoria[c].n).toBe(r.filas.filter((f) => f.categoria === c).length);
    }
    // la línea 0 es clase 9 Y la 1 es extemporánea; ninguna se repite aquí, pero 2 y 3 sí son 2 renglones de 2 líneas
    const porLinea = new Map<number, number>();
    for (const f of r.filas) porLinea.set(f.indice, Math.max(porLinea.get(f.indice) ?? 0, f.montoReclamar ?? 0));
    expect(s.montoTotal).toBe(Math.round([...porLinea.values()].reduce((a, b) => a + b, 0) * 100) / 100);
    expect(s.lineasDistintas).toBe(porLinea.size);

    const libro = leer(candidatosAExcel(r));
    const res = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets.Resumen, { header: 1 }).flat().join('|');
    expect(res).toContain(String(s.montoTotal));
    expect(res).toMatch(/Candidato: validar con el proveedor/);
  });

  it('una línea que cae en dos categorías cuenta el monto mayor una sola vez en el total', () => {
    // clase 9 Y extemporánea: dos renglones, una línea
    const dos = [l(0, { clase: 9, monto: 400, fecha: '2026-02-27' })];
    const r = reporte({ lineas: dos, tarifas: [] });
    expect(r.filas.map((f) => f.categoria).sort()).toEqual(['clase_fuera_de_3_5', 'extemporaneo']);
    const s = resumirCandidatos(r);
    expect(s.lineasDistintas).toBe(1);
    expect(s.montoTotal).toBe(400);
    expect(s.porCategoria.clase_fuera_de_3_5.sinMonto).toBe(1); // sin tarifa no hay monto de clase
  });

  it('el motivo es una frase y el monto de un candidato de clase sin tarifa queda vacío, no en cero', () => {
    const r = reporte({ tarifas: [] });
    const c = r.filas.find((f) => f.categoria === 'clase_fuera_de_3_5')!;
    expect(c.montoReclamar).toBeNull();
    expect(c.motivo.length).toBeGreaterThan(10);
    expect(c.motivo).not.toMatch(/\n/);
    expect(resumirCandidatos(r).sinMonto).toBeGreaterThan(0);
  });
});

describe('sin candidatos y exclusión de reclamados', () => {
  it('sin candidatos: libro con la hoja «Sin candidatos», el mensaje, Resumen y Léeme', () => {
    const r = reporte({ lineas: [l(0)], tarifas: [] });
    expect(r.filas).toHaveLength(0);
    const libro = leer(candidatosAExcel(r));
    expect(libro.SheetNames).toEqual(['Sin candidatos', 'Resumen', 'Léeme']);
    expect(XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets['Sin candidatos'], { header: 1 }).flat().join('|')).toMatch(/nada que reclamar/);
    expect(resumirCandidatos(r).montoTotal).toBe(0);
    expect(candidatosACsv(r)).toMatch(/nada que reclamar/);
  });

  it('excluir categorías ya reclamadas las quita y lo dice; si no queda nada, lo explica', () => {
    const r = reporte({ excluir: new Set(['extemporaneo', 'tag_dado_de_baja']) });
    expect(r.filas.some((f) => f.categoria === 'extemporaneo' || f.categoria === 'tag_dado_de_baja')).toBe(false);
    expect(r.categoriasExcluidas).toEqual(['extemporaneo', 'tag_dado_de_baja']);
    const libro = leer(candidatosAExcel(r));
    expect(libro.SheetNames).not.toContain('Cobro extemporáneo');
    expect(XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets.Resumen, { header: 1 }).flat().join('|')).toMatch(/ya tienen reclamo registrado: Cobro extemporáneo, TAG dado de baja/);

    const todo = reporte({ excluir: new Set(CATEGORIAS_ARCHIVO) });
    expect(todo.filas).toHaveLength(0);
    expect(XLSX.utils.sheet_to_json<unknown[]>(leer(candidatosAExcel(todo)).Sheets['Sin candidatos'], { header: 1 }).flat().join('|')).toMatch(/ya tienen un reclamo registrado/);
  });
});

describe('texto del proveedor, caracteres especiales y determinismo', () => {
  const raros = [l(0, { clase: 9, monto: 400, caseta: '=HYPERLINK("http://x")', tag: '+cmd|x', unidad: '@SUM(A1)' }), l(1, { clase: 9, caseta: 'Plaza "Ñandú", ángulo; <b>x</b>', unidad: 'T-1\nsalto' })];

  it('nada se escribe como fórmula', () => {
    const libro = leer(candidatosAExcel(reporte({ lineas: raros, tarifas: [] })));
    const hoja = libro.Sheets[libro.SheetNames[0]];
    expect(Object.values(hoja).some((c) => (c as XLSX.CellObject).f)).toBe(false);
    const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(hoja);
    expect(filas[0].Caseta).toBe(`'=HYPERLINK("http://x")`);
    expect(filas[0]['Tarjeta/TAG']).toBe("'+cmd|x");
    expect(filas[1].Caseta).toBe('Plaza "Ñandú", ángulo; <b>x</b>');
  });

  it('el CSV escapa comillas, comas, punto y coma y saltos, y lleva BOM', () => {
    const csv = candidatosACsv(reporte({ lineas: raros, tarifas: [] }));
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"Plaza ""Ñandú"", ángulo; <b>x</b>"');
    expect(csv).toContain('"T-1\nsalto"');
    expect(csv.slice(1).split('\r\n')[0]).toBe(['Categoría', ...ENCABEZADOS_CANDIDATOS].join(','));
  });

  it('el mismo contenido con las líneas barajadas da el mismo archivo', () => {
    // sin el par duplicado: cuál de los dos renglones iguales es «el repetido» depende del orden del archivo, a propósito
    const sinPar = lineas.filter((x) => x.indice !== 3);
    const a = candidatosAExcel(reporte({ lineas: sinPar }));
    const b = candidatosAExcel(reporte({ lineas: [...sinPar].reverse() }));
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    expect(candidatosACsv(reporte({ lineas: [...sinPar].reverse() }))).toBe(candidatosACsv(reporte({ lineas: sinPar })));
  });
});

describe('el archivo se abre con el lector tolerante de Likida (round-trip)', () => {
  it('la primera hoja del Excel se lee como un desglose: mismas líneas, importes y clases', async () => {
    const r = reporte();
    // La primera hoja es la de la categoría crítica (T-A2-36): la unidad inmovilizada va primero.
    expect(CATEGORIAS_ARCHIVO[0]).toBe('unidad_inmovilizada');
    const primera = r.filas.filter((f) => f.categoria === 'unidad_inmovilizada');
    const lectura = await parsearArchivoDesglose('candidatos.xlsx', Buffer.from(candidatosAExcel(r)));
    expect(lectura.ok).toBe(true);
    if (!lectura.ok) return;
    expect(lectura.lineas).toHaveLength(primera.length);
    expect(lectura.lineas[0]).toMatchObject({ fecha: '2026-03-04', caseta: 'Caseta Ejemplo Oeste', tag: 'IMDM8', monto: 100, clase: 5, unidad: '208' });
    expect(lectura.calidad.columnasFaltantes ?? []).toEqual([]);
  });
});
