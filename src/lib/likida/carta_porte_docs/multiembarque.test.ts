import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { detectarFormato, prepararContenido, type ContenidoDoc } from './contenido';
import { firmaDe, tablasDe, type Mapeo, type Perfil } from './perfiles';
import { aCsv, derivarHijos, evaluarDivision, MAX_EMBARQUES, nombreDeHijo, planearDivision } from './multiembarque';
import { csvAtlas, ENCABEZADOS_ATLAS, excelAtlas, filaAtlas, EMBARQUE_ATLAS } from './documentos_sinteticos.fixture';

async function contenido(bytes: Uint8Array): Promise<ContenidoDoc> {
  const d = detectarFormato(bytes);
  if (!d.ok) throw new Error(d.motivo);
  return prepararContenido(bytes, d.clase);
}

const fila = (folio: string, producto = 'Botellas de vidrio vacías', pesoKg = '8,400') => filaAtlas({ ...EMBARQUE_ATLAS, folio, producto, pesoKg });
const colMapeos = (...m: Array<[string, string, boolean?]>): Mapeo[] => m.map(([campo, encabezado, mercancia]) => ({ campo, mercancia: !!mercancia, fuente: { tipo: 'columna', encabezado } }));
const perfilCon = (c: ContenidoDoc, mapeos: Mapeo[]): Perfil => ({
  id: 'p', clave: 'p', nombre: 'P', clienteId: null, formato: c.formato, firma: firmaDe(c), versionActiva: 1, activa: { version: 1, mapeos, ejemplos: [] },
});

describe('planearDivision: cuántos embarques trae un archivo', () => {
  it('un Excel con tres folios (uno con dos renglones) son TRES embarques, en el orden del archivo', async () => {
    const c = await contenido(excelAtlas([fila('ATL-1'), fila('ATL-1', 'Tapas', '600'), fila('ATL-2', 'Cajas'), fila('ATL-3', 'Etiquetas')]));
    const plan = planearDivision(c, null)!;
    expect(plan.embarques.map((e) => [e.indice, e.clave, e.filas.length])).toEqual([[1, 'ATL-1', 2], [2, 'ATL-2', 1], [3, 'ATL-3', 1]]);
    expect(plan.origenColumna).toBe('cabecera');
    expect(plan.columnaFolio).toBe('Folio Embarque');
    expect(plan.encabezados).toEqual(ENCABEZADOS_ATLAS);
  });

  it('un solo folio (aunque tenga varios renglones) NO se parte', async () => {
    const c = await contenido(excelAtlas([fila('ATL-1'), fila('ATL-1', 'Tapas')]));
    expect(planearDivision(c, null)).toBeNull();
    expect(evaluarDivision(c, null)).toEqual({ plan: null, exceso: null, variasHojas: null });
  });

  it('el mismo folio escrito con otra mayúscula o espacios sobrantes es el MISMO embarque', async () => {
    const c = await contenido(excelAtlas([fila('ATL-1'), fila(' atl-1 ', 'Tapas'), fila('ATL-2')]));
    expect(planearDivision(c, null)!.embarques.map((e) => [e.clave, e.filas.length])).toEqual([['ATL-1', 2], ['ATL-2', 1]]);
  });

  it('los folios no contiguos se juntan en su embarque (el orden lo da la primera aparición)', async () => {
    const c = await contenido(excelAtlas([fila('B-1'), fila('A-1'), fila('B-1', 'Tapas')]));
    const plan = planearDivision(c, null)!;
    expect(plan.embarques.map((e) => [e.clave, e.filas.length])).toEqual([['B-1', 2], ['A-1', 1]]);
  });

  it('una celda de folio vacía hereda el folio de la fila de arriba (celdas combinadas)', async () => {
    const c = await contenido(excelAtlas([fila('ATL-1'), fila('', 'Tapas'), fila('ATL-2')]));
    expect(planearDivision(c, null)!.embarques.map((e) => [e.clave, e.filas.length])).toEqual([['ATL-1', 2], ['ATL-2', 1]]);
  });

  it('filas con datos ANTES del primer folio se asignan al primer embarque y se AVISA', async () => {
    const c = await contenido(excelAtlas([fila('', 'Pallets'), fila('ATL-1'), fila('ATL-2')]));
    const plan = planearDivision(c, null)!;
    expect(plan.embarques[0].filas).toHaveLength(2);
    expect(plan.avisos.join(' ')).toMatch(/1 fila venía sin folio antes del primero.*«ATL-1»/);
  });

  it('la fila de TOTAL no es de ningún embarque (no se cuela al último)', async () => {
    const c = await contenido(excelAtlas([fila('ATL-1'), fila('ATL-2')], { extras: [['TOTAL', '', '', '', '', '', '', '', '', '', '', '', '2,400', '', '16,800', '', '']] }));
    const plan = planearDivision(c, null)!;
    expect(plan.embarques.map((e) => e.filas.length)).toEqual([1, 1]);
    expect(plan.embarques.flatMap((e) => e.filas).some((f) => /total/i.test(f[0]))).toBe(false);
  });

  it('un CSV con varios folios también se parte', async () => {
    const c = await contenido(csvAtlas([fila('ATL-1'), fila('ATL-2')]));
    expect(c.formato).toBe('csv');
    expect(planearDivision(c, null)!.embarques).toHaveLength(2);
  });

  it('sin una cabecera de folio INEQUÍVOCA no se adivina: «Pedido» puede traer un valor por renglón', async () => {
    const c = await contenido(Buffer.from('Pedido,Producto,Peso\nP-1,Cajas,10\nP-2,Tapas,20\nP-3,Sellos,5'));
    expect(planearDivision(c, null)).toBeNull();
  });

  it('con perfil: la columna del folio es la que el perfil mapea, aunque se llame «Pedido»', async () => {
    const c = await contenido(Buffer.from('Pedido,Producto,Peso\nP-1,Cajas,10\nP-2,Tapas,20\nP-2,Sellos,5'));
    const p = perfilCon(c, colMapeos(['folio_cliente', 'Pedido'], ['descripcion', 'Producto', true]));
    const plan = planearDivision(c, p)!;
    expect(plan.origenColumna).toBe('perfil');
    expect(plan.embarques.map((e) => [e.clave, e.filas.length])).toEqual([['P-1', 1], ['P-2', 2]]);
  });

  it('con perfil cuya columna de folio ya no está en el archivo: no hay nada que agrupar', async () => {
    const c = await contenido(excelAtlas([fila('ATL-1'), fila('ATL-2')]));
    const p = perfilCon(c, colMapeos(['folio_cliente', 'Columna Que Ya No Existe']));
    expect(planearDivision(c, p)).toBeNull();
  });

  it('un PDF o un correo no se parten (solo tablas)', async () => {
    const c = await contenido(Buffer.from('De: a@b.example\nAsunto: x\n\nFolio: A-1\nFolio: A-2 y más texto para que sea correo legible.'));
    expect(planearDivision(c, null)).toBeNull();
  });

  // M2 (ronda 15): los hijos son CSV de UNA tabla; partir un libro con datos en otras hojas se las quitaría a cada embarque sin avisar.
  const libro = (extra: Array<[string, string[][]]>): Buffer => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([ENCABEZADOS_ATLAS, fila('ATL-1'), fila('ATL-2')]), 'Embarques');
    for (const [nombre, aoa] of extra) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), nombre);
    return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  };

  it('un libro con datos en OTRA hoja no se parte y lo dice (variasHojas), en vez de quitarle esas hojas a cada embarque', async () => {
    const c = await contenido(libro([['Detalle', [['folio', 'nota'], ['ATL-1', 'frágil']]], ['Resumen', [['total', '2']]]]));
    expect(evaluarDivision(c, null)).toEqual({ plan: null, exceso: null, variasHojas: { hojaDelFolio: 'Embarques', otras: ['Detalle', 'Resumen'], embarques: 2 } });
  });

  it('las hojas VACÍAS no cuentan: el libro se parte igual', async () => {
    const c = await contenido(libro([['Vacía', [[]]]]));
    expect(evaluarDivision(c, null).plan?.embarques).toHaveLength(2);
    expect(evaluarDivision(c, null).variasHojas).toBeNull();
  });

  it('más de 100 embarques NO se parte y lo dice (exceso), en vez de crear cientos de documentos', async () => {
    const filas = Array.from({ length: MAX_EMBARQUES + 1 }, (_, i) => fila(`ATL-${i + 1}`));
    const c = await contenido(excelAtlas(filas));
    expect(evaluarDivision(c, null)).toEqual({ plan: null, exceso: MAX_EMBARQUES + 1, variasHojas: null });
  });
});

describe('derivarHijos: el archivo de cada embarque', () => {
  it('son deterministas: el mismo Excel da los mismos bytes y las mismas huellas', async () => {
    const bytes = excelAtlas([fila('ATL-1'), fila('ATL-2')]);
    const a = derivarHijos(planearDivision(await contenido(bytes), null)!, 'plan.xlsx');
    const b = derivarHijos(planearDivision(await contenido(bytes), null)!, 'plan.xlsx');
    expect(a.map((h) => h.sha256)).toEqual(b.map((h) => h.sha256));
    expect(a[0].sha256).not.toBe(a[1].sha256);
    expect(a[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cada hijo se vuelve a leer como UNA tabla de un solo embarque, con la misma cabecera y SUS filas', async () => {
    const c = await contenido(excelAtlas([fila('ATL-1'), fila('ATL-1', 'Tapas', '600'), fila('ATL-2', 'Cajas')]));
    const hijos = derivarHijos(planearDivision(c, null)!, 'plan.xlsx');
    expect(hijos.map((h) => [h.indice, h.clave, h.filas])).toEqual([[1, 'ATL-1', 2], [2, 'ATL-2', 1]]);
    for (const h of hijos) {
      const d = detectarFormato(h.bytes);
      expect(d).toMatchObject({ ok: true, clase: 'csv' });
      const releido = await prepararContenido(h.bytes, 'csv');
      const t = tablasDe(releido)[0];
      expect(t.encabezados).toEqual(ENCABEZADOS_ATLAS);
      expect(t.filas).toHaveLength(h.filas);
      expect(new Set(t.filas.map((f) => f[0]))).toEqual(new Set([h.clave]));
      // Un hijo ya no se parte otra vez (un solo folio).
      expect(planearDivision(releido, null)).toBeNull();
    }
  });

  it('las cifras con coma («8,400») sobreviven entrecomilladas', async () => {
    const c = await contenido(excelAtlas([fila('ATL-1', 'Botellas', '8,400'), fila('ATL-2')]));
    const h = derivarHijos(planearDivision(c, null)!, 'plan.xlsx')[0];
    expect(new TextDecoder().decode(h.bytes)).toContain('"8,400"');
    expect(tablasDe(await prepararContenido(h.bytes, 'csv'))[0].filas[0][14]).toBe('8,400');
  });

  it('el CSV neutraliza el inicio de fórmula y aplana saltos de línea (no rompe el lector por líneas)', () => {
    const csv = aCsv(['Folio', 'Nota'], [['A-1', '=HYPERLINK("x")'], ['A-2', 'línea 1\nlínea 2'], ['A-3', '-5'], ['A-4', '-ABC']]);
    const lineas = csv.trimEnd().split('\n');
    expect(lineas).toHaveLength(5);
    expect(lineas[1]).toBe('A-1,"\'=HYPERLINK(""x"")"');
    expect(lineas[2]).toBe('A-2,línea 1 línea 2');
    expect(lineas[3]).toBe('A-3,-5'); // un número negativo NO es una fórmula
    expect(lineas[4]).toBe("A-4,'-ABC");
  });

  it('el nombre del hijo lleva el folio, sin rutas ni controles, y cabe', () => {
    expect(nombreDeHijo('plan del día.xlsx', 'ATL-1')).toBe('plan del día · embarque ATL-1.csv');
    expect(nombreDeHijo('x.xlsx', '../../etc\u0000/pa\nsswd')).not.toMatch(/[/\\\u0000\n]/);
    expect(nombreDeHijo('a'.repeat(400) + '.xlsx', 'F'.repeat(90)).length).toBeLessThanOrEqual(200);
  });
});
