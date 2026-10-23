import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';
import { crearDbFalsa, type DbFalsa } from '../peajes/db_falsa.test.util';
import { generarLibroIave, generarFilasIave, ENCABEZADOS_IAVE } from '../peajes/fixtures/generar_desglose_iave';

// ═══════════════════════════════════════════════════════════════════════════
// EL ARCHIVO DECENAL «TAL CUAL» del proveedor (forma sintética, ver el generador):
// cabeceras con espacios, fecha serial + hora fracción, 5 columnas sin encabezado,
// «Tarjeta IDMX» como TAG, «No. economico» como unidad, «Clase», importe al 100% y
// facturado, y una hoja secundaria que REPITE filas de la principal.
// ═══════════════════════════════════════════════════════════════════════════

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../agentes/corridas', () => ({ registrarCorrida: vi.fn(async () => {}) }));

const { parsearArchivoDesglose, importarDesglose, conciliarDesglose, MAX_LINEAS_DESGLOSE } = await import('./desglose_peaje');

const T = 'tenant-1';
beforeEach(() => { db = crearDbFalsa({}); });

describe('el parser reconoce el archivo del proveedor sin acomodarlo', () => {
  it('lee un corte de 9 000 filas y COINCIDEN los totales del generador', async () => {
    const { buffer, esperado } = generarLibroIave({ filas: 9000, extemporaneos: 40 });
    const r = await parsearArchivoDesglose('01 A 10 DE MARZO.xlsx', buffer);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineas).toHaveLength(esperado.cruces);
    expect(r.lineas.reduce((s, l) => s + l.monto, 0)).toBe(esperado.monto);
    const porClase: Record<string, number> = {};
    for (const l of r.lineas) porClase[String(l.clase)] = (porClase[String(l.clase)] ?? 0) + 1;
    expect(porClase).toEqual(esperado.porClase);
    expect(new Set(r.lineas.map((l) => l.unidad)).size).toBe(esperado.unidades);
    // medida real, no nula: sí hay clases distintas de 5 y de 1
    expect(Object.keys(porClase).length).toBeGreaterThan(4);
  });

  it('TAG = «Tarjeta IDMX», unidad = «No. economico», clase, fecha serial + hora fracción', async () => {
    const { buffer } = generarLibroIave({ filas: 50, inicio: '2026-03-01', extemporaneos: 0 });
    const r = await parsearArchivoDesglose('x.xlsx', buffer);
    if (!r.ok) throw new Error(r.motivo);
    const l = r.lineas[0];
    expect(l.tag).toMatch(/^IMDM9\d{7}\.\.$/);
    expect(l.unidad).toBeTruthy();
    expect(typeof l.clase).toBe('number');
    expect(l.fecha).toMatch(/^2026-03-(0[1-9]|10)$/);
    expect(l.hora).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    // el nombre de la caseta viene relleno con espacios a ancho fijo: se recorta
    expect(l.caseta).toBe(l.caseta?.trim());
    expect(l.caseta).not.toMatch(/\s{2,}/);
    expect(r.calidad.columnas.find((c) => c.campo === 'tag')?.encabezado).toBe('Tarjeta IDMX');
    expect(r.calidad.columnas.find((c) => c.campo === 'unidad')?.encabezado).toBe('No. economico');
    expect(r.calidad.columnas.find((c) => c.campo === 'clase')?.encabezado).toBe('Clase');
  });

  it('SOLO la hoja principal: la secundaria repetida NO duplica cruces, y se dice', async () => {
    const con = generarLibroIave({ filas: 300, hojaSecundaria: true });
    const sin = generarLibroIave({ filas: 300, hojaSecundaria: false });
    const a = await parsearArchivoDesglose('a.xlsx', con.buffer);
    const b = await parsearArchivoDesglose('b.xlsx', sin.buffer);
    if (!a.ok || !b.ok) throw new Error('no se leyó');
    expect(a.lineas).toHaveLength(300);
    expect(a.lineas.length).toBe(b.lineas.length);
    expect(a.lineas.reduce((s, l) => s + l.monto, 0)).toBe(con.esperado.monto);
    expect(a.calidad.hojaLeida).toBe('g00I99001.801');
    expect(a.calidad.hojasIgnoradas).toEqual(['Hoja1']);
    expect(a.avisos.join(' ')).toMatch(/solo la primera/);
    expect(a.avisos.join(' ')).toMatch(/duplicaría/);
  });

  it('las columnas SIN encabezado con datos se ignoran SIN perderlas en silencio (aviso + calidad)', async () => {
    const { buffer } = generarLibroIave({ filas: 100 });
    const r = await parsearArchivoDesglose('x.xlsx', buffer);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.calidad.sinEncabezadoConDatos).toEqual(['O', 'P', 'Q', 'R', 'S']);
    expect(r.avisos.join(' ')).toMatch(/5 columnas sin encabezado/);
    // las columnas con nombre que no se usan también se dicen
    expect(r.calidad.noReconocidas).toContain('Clave de Red');
    // y NO se confunden con campos: ninguna línea trae esos datos
    expect(Object.keys(r.lineas[0]).sort()).toEqual(['caseta', 'clase', 'fecha', 'hora', 'indice', 'monto', 'tag', 'unidad']);
  });

  it('el «No. de periodo» del archivo queda en el reporte de calidad', async () => {
    const { buffer } = generarLibroIave({ filas: 30, noPeriodo: 812 });
    const r = await parsearArchivoDesglose('x.xlsx', buffer);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.calidad.noPeriodo).toBe('812');
  });

  it('un archivo SIN columna de TAG no deja TAG null en silencio: avisa y lo anota en la calidad', async () => {
    const { filas } = generarFilasIave({ filas: 20 });
    const sinTag = filas.map((f, i) => (i === 0 ? f.map((c) => (String(c).trim() === 'Tarjeta IDMX' ? 'Referencia interna' : c)) : f));
    const hoja = XLSX.utils.aoa_to_sheet(sinTag);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Hoja principal');
    const r = await parsearArchivoDesglose('x.xlsx', Buffer.from(XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' })));
    if (!r.ok) throw new Error(r.motivo);
    expect(r.lineas.every((l) => l.tag === null)).toBe(true);
    expect(r.calidad.columnasFaltantes).toContain('tag');
    expect(r.calidad.lineasSinTag).toBe(20);
    expect(r.avisos.join(' ')).toMatch(/columna de TAG/);
  });

  it('unidad o clase vacías en algunas líneas: nulos CONTADOS y avisados, no escondidos', async () => {
    const { filas } = generarFilasIave({ filas: 40, extemporaneos: 0 });
    filas[1][6] = '';          // unidad vacía
    filas[2][6] = '   ';       // unidad en blanco
    filas[3][9] = '';          // clase vacía
    filas[4][9] = 'abc';       // clase ilegible
    filas[5][9] = 12.5;        // clase no entera
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filas), 'p');
    const r = await parsearArchivoDesglose('x.xlsx', Buffer.from(XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' })));
    if (!r.ok) throw new Error(r.motivo);
    expect(r.calidad.lineasSinUnidad).toBe(2);
    expect(r.calidad.lineasSinClase).toBe(3);
    expect(r.lineas.filter((l) => l.clase === null)).toHaveLength(3);
    const av = r.avisos.join(' ');
    expect(av).toMatch(/2 líneas vienen sin unidad/);
    expect(av).toMatch(/3 líneas vienen sin clase legible/);
  });

  it('usa el importe FACTURADO como monto y guarda el «al 100%» solo cuando difiere', async () => {
    const { filas } = generarFilasIave({ filas: 10, extemporaneos: 0 });
    filas[1][12] = 500; filas[1][13] = 450; // al 100% distinto del facturado
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filas), 'p');
    const r = await parsearArchivoDesglose('x.xlsx', Buffer.from(XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' })));
    if (!r.ok) throw new Error(r.motivo);
    const l = r.lineas.find((x) => x.importe100 !== undefined);
    expect(l).toMatchObject({ monto: 450, importe100: 500 });
    expect(r.lineas.filter((x) => x.importe100 !== undefined)).toHaveLength(1);
    expect(r.calidad.lineasImporteDistinto).toBe(1);
  });

  it('las cabeceras con espacios al inicio y al final se reconocen igual', () => {
    expect(ENCABEZADOS_IAVE.some((h) => h !== h.trim())).toBe(true);
  });
});

describe('importarDesglose: tope, periodo oficial y calidad guardada', () => {
  it('el tope es de 60 000 y un corte MENSUAL (≈ 30 000) entra completo, por lotes', async () => {
    expect(MAX_LINEAS_DESGLOSE).toBeGreaterThanOrEqual(60_000);
    const { buffer } = generarLibroIave({ filas: 30_000, extemporaneos: 100, hojaSecundaria: false });
    const r = await importarDesglose(T, { nombre: '01 A 10 DE MARZO.xlsx', buffer });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.totalLineas).toBe(30_000);
    expect(db.tablas.desglose_peaje_linea).toHaveLength(30_000);
    // los insertos fueron POR LOTES, no uno por línea
    const inserts = db.llamadas.filter((l) => l.tabla === 'desglose_peaje_linea' && l.op === 'insert');
    expect(inserts.length).toBeGreaterThan(1);
    expect(inserts.length).toBeLessThanOrEqual(Math.ceil(30_000 / 1000) + 1);
  }, 60_000);

  it('más de 60 000 líneas se rechaza diciendo el tope, sin guardar nada', async () => {
    const filas = ['Fecha,Caseta,Importe'].concat(Array.from({ length: MAX_LINEAS_DESGLOSE + 1 }, () => '05/03/2026,Caseta Ejemplo Norte,10.00')).join('\n');
    const r = await importarDesglose(T, { nombre: 'enorme.csv', buffer: Buffer.from(filas) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/tope.*60000/);
    expect(db.tablas.desglose_peaje ?? []).toHaveLength(0);
  }, 60_000);

  it('un .xlsx con 100 000 filas (muy por encima del tope) NO se materializa completo: la lectura se acota con sheetRows, no tras parsear la hoja entera', async () => {
    const FILAS_REALES = 100_000;
    const filas: Array<Array<string | number>> = [['Fecha', 'Caseta', 'Importe']];
    for (let i = 0; i < FILAS_REALES; i++) filas.push(['05/03/2026', 'Caseta Ejemplo Norte', 10]);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filas), 'Hoja1');
    const buffer = Buffer.from(XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }));

    const t0 = Date.now();
    const leido = await parsearArchivoDesglose('enorme.xlsx', buffer);
    const ms = Date.now() - t0;
    if (!leido.ok) throw new Error(leido.motivo);
    // La prueba directa de que NO se materializó el archivo entero: el resultado se
    // detuvo muy por debajo de las 100 000 líneas reales (acotado por `sheetRows`,
    // no por un `.slice()` después de parsear la hoja completa).
    expect(leido.lineas.length).toBeLessThan(FILAS_REALES - 20_000);
    expect(leido.calidad.lecturaAcotada).toBe(true);
    // Y es rápido: si se hubiera descomprimido/parseado la hoja entera (100 000 filas ×
    // 19 celdas en el peor caso real), tardaría muchísimo más que leer ~60 000 acotadas.
    expect(ms).toBeLessThan(10_000);

    const r = await importarDesglose(T, { nombre: 'enorme.xlsx', buffer });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toMatch(/tope.*60000/);
      // El conteo es un PISO (la lectura se acotó): nunca se afirma la cifra real sin
      // haberla medido — misma doctrina que `archivo.ts` con «X o más filas».
      expect(r.motivo).toMatch(/o más/);
    }
    expect(db.tablas.desglose_peaje ?? []).toHaveLength(0);
  }, 30_000);

  it('guarda clase, unidad del archivo, periodo oficial (del nombre), No. de periodo y la calidad', async () => {
    const { buffer } = generarLibroIave({ filas: 200, inicio: '2026-03-01', noPeriodo: 805, extemporaneos: 5 });
    const r = await importarDesglose(T, { nombre: '01 A 10 DE MARZO.xlsx', buffer });
    if (!r.ok) throw new Error(r.motivo);
    const d = db.tablas.desglose_peaje[0];
    expect(d).toMatchObject({ periodo_oficial_desde: '2026-03-01', periodo_oficial_hasta: '2026-03-10', periodo_origen: 'nombre_archivo', no_periodo: '805' });
    // el periodo MEDIDO se ensancha con los extemporáneos; el oficial no
    expect((d.periodo_desde as string) < '2026-03-01').toBe(true);
    expect((d.calidad as { hojasIgnoradas: string[] }).hojasIgnoradas).toEqual(['Hoja1']);
    const l = db.tablas.desglose_peaje_linea[0];
    expect(l).toMatchObject({ tenant_id: T, desglose_id: d.id });
    expect(typeof l.clase).toBe('number');
    expect(l.unidad_archivo).toBeTruthy();
    expect(db.tablas.desglose_peaje_linea.every((x) => x.clase !== null && x.unidad_archivo !== null)).toBe(true);
  });

  it('el periodo DECLARADO manda sobre el nombre', async () => {
    const { buffer } = generarLibroIave({ filas: 30, inicio: '2026-03-01', extemporaneos: 0 });
    const r = await importarDesglose(T, { nombre: '01 A 10 DE MARZO.xlsx', buffer, periodo: { desde: '2026-03-02', hasta: '2026-03-09' } });
    if (!r.ok) throw new Error(r.motivo);
    expect(db.tablas.desglose_peaje[0]).toMatchObject({ periodo_oficial_desde: '2026-03-02', periodo_oficial_hasta: '2026-03-09', periodo_origen: 'declarado' });
  });

  it('sin periodo (nombre opaco, nada declarado): NO se inventa y se avisa que la regla no se aplicará', async () => {
    const { buffer } = generarLibroIave({ filas: 30 });
    const r = await importarDesglose(T, { nombre: 'estado_de_cuenta.xlsx', buffer });
    if (!r.ok) throw new Error(r.motivo);
    expect(db.tablas.desglose_peaje[0].periodo_oficial_desde).toBeNull();
    expect(db.tablas.desglose_peaje[0].periodo_origen).toBeNull();
    expect(r.avisos.join(' ')).toMatch(/extemporáneos no se aplica/);
  });

  it('los nombres de casetas del archivo alimentan el catálogo por nombre (una fila por caseta, sin coordenadas inventadas)', async () => {
    const { buffer } = generarLibroIave({ filas: 400 });
    const r = await importarDesglose(T, { nombre: '01 A 10 DE MARZO.xlsx', buffer });
    if (!r.ok) throw new Error(r.motivo);
    const nombres = db.tablas.peaje_caseta_nombre;
    expect(nombres).toHaveLength(8);
    expect(nombres.every((n) => n.lat === undefined || n.lat === null)).toBe(true);
    expect(nombres.every((n) => n.tenant_id === T)).toBe(true);
  });

  it('re-importar NO pisa una regla ya declarada sobre la caseta', async () => {
    const { buffer } = generarLibroIave({ filas: 400 });
    await importarDesglose(T, { nombre: '01 A 10 DE MARZO.xlsx', buffer });
    db.tablas.peaje_caseta_nombre.find((n) => n.nombre_norm === 'caseta pasada uno')!.clases_permitidas = [1];
    await importarDesglose(T, { nombre: '11 A 20 DE MARZO.xlsx', buffer });
    expect(db.tablas.peaje_caseta_nombre.find((n) => n.nombre_norm === 'caseta pasada uno')!.clases_permitidas).toEqual([1]);
    expect(db.tablas.peaje_caseta_nombre).toHaveLength(8);
  });
});

describe('conciliarDesglose a escala: anota por lotes, no una consulta por línea', () => {
  it('un desglose de 12 000 líneas se anota con pocas consultas y cuadra la cuenta', async () => {
    const { buffer } = generarLibroIave({ filas: 12_000, extemporaneos: 0, hojaSecundaria: false });
    const imp = await importarDesglose(T, { nombre: '01 A 10 DE MARZO.xlsx', buffer });
    if (!imp.ok) throw new Error(imp.motivo);
    const antes = db.llamadas.length;
    const r = await conciliarDesglose(T, imp.desgloseId);
    expect(r.total).toBe(12_000);
    expect(r.noEscritas).toBe(0);
    expect(r.cuadra + r.noCuadra + r.sinContraparte).toBe(12_000);
    const updates = db.llamadas.slice(antes).filter((l) => l.tabla === 'desglose_peaje_linea' && l.op === 'upsert');
    // escritura por lotes de 500 (REN-34-1): 12 000/500 = 24 upserts, no 12 000
    expect(updates.length).toBeLessThan(400);
    expect(updates.length).toBeGreaterThan(0);
    // toda fila escrita lleva el tenant_id de la flota
    expect(updates.every((u) => (u.payload as Array<{ tenant_id?: unknown }>).every((f) => f.tenant_id === T))).toBe(true);
    // y quedaron escritas de verdad
    expect(db.tablas.desglose_peaje_linea.every((l) => l.estatus === 'sin_contraparte')).toBe(true);
  }, 120_000);

  it('un grupo que falla se cuenta como no escrito, no se pierde en silencio', async () => {
    const { buffer } = generarLibroIave({ filas: 500, extemporaneos: 0, hojaSecundaria: false });
    const imp = await importarDesglose(T, { nombre: '01 A 10 DE MARZO.xlsx', buffer });
    if (!imp.ok) throw new Error(imp.motivo);
    db.fallar('desglose_peaje_linea.upsert', 'base caída');
    const r = await conciliarDesglose(T, imp.desgloseId);
    expect(r.noEscritas).toBe(500);
    expect(r.cuadra + r.noCuadra + r.sinContraparte).toBe(0);
  });
});
