import { describe, it, expect, vi } from 'vitest';
import { crearDbFalsa, type DbFalsa } from '../peajes/db_falsa.test.util';

// A2 ola 1: el `Icident` (número de despacho del TMS) que trae el CSV del API del cliente se guarda en la línea.

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../agentes/corridas', () => ({ registrarCorrida: vi.fn(async () => {}) }));

const { importarDesglose, detectarColumnas, parsearDesgloseHoja } = await import('./desglose_peaje');

const T = 'tenant-1';

describe('detectarColumnas: la columna Icident', () => {
  it('«Icident» se reconoce como columna opcional y no se confunde con otra', () => {
    const r = detectarColumnas(['Fecha', 'Caseta', 'Importe', 'TAG', 'Icident']);
    expect(r).toEqual({ ok: true, columnas: { fecha: 0, caseta: 1, monto: 2, tag: 3, icident: 4 } });
  });
  it('sin la columna el resultado no cambia (archivo decenal de hoy)', () => {
    const r = detectarColumnas(['Fecha', 'Caseta', 'Importe', 'TAG']);
    expect(r).toEqual({ ok: true, columnas: { fecha: 0, caseta: 1, monto: 2, tag: 3 } });
  });
  it('«No. de despacho» también vale', () => {
    const r = detectarColumnas(['Fecha', 'Caseta', 'Importe', 'No. de despacho']);
    expect(r.ok && r.columnas.icident).toBe(3);
  });
});

describe('el CSV que arma el conector del TMS (sincronizar.ts → peajes)', () => {
  it('Fecha,Hora,Caseta,Importe,TAG,Unidad,Clase,Icident se lee completo, con el Icident de cada cobro', async () => {
    db = crearDbFalsa({});
    const csv = 'Fecha,Hora,Caseta,Importe,TAG,Unidad,Clase,Icident\n2026-09-03,08:15:00,Caseta Ejemplo Norte,189.00,IMDM10000001,101,5,D-1\n2026-09-03,09:40:00,Caseta Ejemplo Sur,100.00,IMDM10000001,101,5,\n';
    const r = await importarDesglose(T, { nombre: 'tms-peajes-2026-09-01-2026-09-10.csv', buffer: Buffer.from(csv), proveedor: 'tms' });
    if (!r.ok) throw new Error(r.motivo);
    const [a, b] = db.tablas.desglose_peaje_linea;
    expect(a).toMatchObject({ icident: 'D-1', unidad_archivo: '101', clase: 5, hora: '08:15:00' });
    expect(b).toMatchObject({ icident: null });
    expect(db.tablas.desglose_peaje[0]).toMatchObject({ periodo_oficial_desde: '2026-09-01', periodo_origen: 'nombre_archivo' });
  });
});

describe('parsearDesgloseHoja: Icident por línea', () => {
  const HOJA = [
    ['Fecha', 'Caseta', 'Importe', 'Icident'],
    ['05/08/2026', 'Caseta Ejemplo Norte', '189.00', ' 12345 '],
    ['06/08/2026', 'Caseta Ejemplo Sur', '100.00', ''],
  ];
  it('lo recorta; la celda vacía queda en null (no se inventa)', () => {
    const r = parsearDesgloseHoja(HOJA);
    if (!r.ok) throw new Error('parseo falló');
    expect(r.lineas[0].icident).toBe('12345');
    expect(r.lineas[1].icident).toBeNull();
    expect(r.calidad.columnas.find((c) => c.encabezado === 'Icident')?.campo).toBe('icident');
  });
  it('un archivo sin la columna deja la clave AUSENTE', () => {
    const r = parsearDesgloseHoja([['Fecha', 'Caseta', 'Importe'], ['05/08/2026', 'Caseta Ejemplo Norte', '189.00']]);
    if (!r.ok) throw new Error('parseo falló');
    expect('icident' in r.lineas[0]).toBe(false);
  });
});

describe('importarDesglose: guarda el Icident', () => {
  const csv = 'Fecha;Plaza;Importe;Icident\n05/08/2026;Caseta Ejemplo Norte;189,50;98765\n06/08/2026;Caseta Ejemplo Sur;100,00;\n';
  it('escribe icident en desglose_peaje_linea (null si la celda venía vacía)', async () => {
    db = crearDbFalsa({});
    const r = await importarDesglose(T, { nombre: 'api.csv', buffer: Buffer.from(csv) });
    expect(r.ok).toBe(true);
    const [a, b] = db.tablas.desglose_peaje_linea;
    expect(a).toMatchObject({ icident: '98765', tenant_id: T });
    expect(b).toMatchObject({ icident: null });
  });
  it('un archivo sin la columna no manda la clave (compatible con la base sin la 0935)', async () => {
    db = crearDbFalsa({});
    const r = await importarDesglose(T, { nombre: 'pase.csv', buffer: Buffer.from('Fecha;Plaza;Importe\n05/08/2026;Caseta Ejemplo Norte;189,50\n') });
    expect(r.ok).toBe(true);
    expect('icident' in db.tablas.desglose_peaje_linea[0]).toBe(false);
  });
});

// ── A2 ola 1: el periodo se infiere cuando el nombre del archivo no lo dice ──
describe('importarDesglose: periodo inferido', () => {
  const filas = (mes: string, desde: number, n: number, noPeriodo: string) =>
    Array.from({ length: n }, (_, i) => `${String(desde + (i % 10)).padStart(2, '0')}/${mes}/2026;Caseta Ejemplo Norte;100,00;IMDM 1000000${i % 7};${noPeriodo}`);
  const csv = (lineas: string[]) => `Fecha;Plaza;Importe;No. TAG;No. de periodo\n${lineas.join('\n')}\n`;

  it('sin nombre con periodo y con una decena dominante: la infiere, la marca como inferida y lo avisa', async () => {
    db = crearDbFalsa({});
    const r = await importarDesglose(T, { nombre: 'reporte.csv', buffer: Buffer.from(csv(filas('09', 11, 40, '746'))) });
    if (!r.ok) throw new Error(r.motivo);
    expect(db.tablas.desglose_peaje[0]).toMatchObject({ periodo_oficial_desde: '2026-09-11', periodo_oficial_hasta: '2026-09-20', periodo_origen: 'decena_dominante', no_periodo: '746' });
    expect(r.avisos.join(' ')).toMatch(/lo inferí: 2026-09-11 a 2026-09-20/);
  });
  it('con otro archivo ancla de la flota (periodo por nombre y su «No. de periodo»): usa el número', async () => {
    db = crearDbFalsa({
      desglose_peaje: [{ id: 'ancla', tenant_id: T, anulado_en: null, periodo_origen: 'nombre_archivo', no_periodo: '745', periodo_oficial_desde: '2026-09-01', creado_en: '2026-09-12T00:00:00Z' }],
    });
    const r = await importarDesglose(T, { nombre: 'reporte.csv', buffer: Buffer.from(csv(filas('09', 11, 40, '746'))) });
    expect(r.ok).toBe(true);
    const nuevo = db.tablas.desglose_peaje.find((d) => d.id !== 'ancla');
    expect(nuevo).toMatchObject({ periodo_oficial_desde: '2026-09-11', periodo_origen: 'no_periodo' });
  });
  it('un ancla de OTRA flota o ya inferida no cuenta', async () => {
    db = crearDbFalsa({
      desglose_peaje: [
        { id: 'a1', tenant_id: 'otra', anulado_en: null, periodo_origen: 'nombre_archivo', no_periodo: '745', periodo_oficial_desde: '2026-01-01', creado_en: '2026-09-12T00:00:00Z' },
        { id: 'a2', tenant_id: T, anulado_en: null, periodo_origen: 'decena_dominante', no_periodo: '745', periodo_oficial_desde: '2026-01-01', creado_en: '2026-09-12T00:00:00Z' },
      ],
    });
    await importarDesglose(T, { nombre: 'reporte.csv', buffer: Buffer.from(csv(filas('09', 11, 40, '746'))) });
    const nuevo = db.tablas.desglose_peaje.find((d) => !['a1', 'a2'].includes(String(d.id)));
    expect(nuevo?.periodo_origen).toBe('decena_dominante'); // el ancla falsa (enero) habría dado enero y se rechaza por las fechas
  });
  it('el nombre manda sobre la inferencia, y un archivo repartido en todo el mes no se adivina', async () => {
    db = crearDbFalsa({});
    await importarDesglose(T, { nombre: '01 A 10 DE SEPT.csv', buffer: Buffer.from(csv(filas('09', 11, 40, '746'))) });
    expect(db.tablas.desglose_peaje[0]).toMatchObject({ periodo_origen: 'nombre_archivo', periodo_oficial_desde: '2026-09-01' });
    db = crearDbFalsa({});
    const mesCompleto = [...filas('09', 1, 14, '746'), ...filas('09', 11, 13, '746'), ...filas('09', 21, 13, '746')];
    const r = await importarDesglose(T, { nombre: 'mes.csv', buffer: Buffer.from(csv(mesCompleto)) });
    if (!r.ok) throw new Error(r.motivo);
    expect(db.tablas.desglose_peaje[0]).toMatchObject({ periodo_oficial_desde: null, periodo_origen: null });
    expect(r.avisos.join(' ')).toMatch(/No pude saber el periodo/);
  });
  it('si la 0935 aún no está aplicada (el CHECK no admite el origen inferido) el archivo entra SIN periodo y lo dice', async () => {
    db = crearDbFalsa({});
    const original = db.cliente.from;
    let primera = true;
    db.cliente.from = (t: string) => {
      const q = original(t) as Record<string, (...a: unknown[]) => unknown>;
      if (t !== 'desglose_peaje') return q;
      return new Proxy(q, {
        get: (obj, prop: string) => (prop === 'insert' && primera
          ? (fila: Record<string, unknown>) => {
            if (fila.periodo_origen === 'decena_dominante') {
              primera = false;
              return { select: () => ({ single: async () => ({ data: null, error: { message: 'new row violates check constraint "desglose_peaje_periodo_origen_dominio"' } }) }) };
            }
            return obj.insert(fila);
          }
          : obj[prop].bind(obj)),
      });
    };
    const r = await importarDesglose(T, { nombre: 'reporte.csv', buffer: Buffer.from(csv(filas('09', 11, 40, '746'))) });
    if (!r.ok) throw new Error(r.motivo);
    expect(db.tablas.desglose_peaje[0]).toMatchObject({ periodo_oficial_desde: null, periodo_origen: null });
    expect(r.avisos.join(' ')).toMatch(/No pude guardar el periodo inferido/);
  });
});
