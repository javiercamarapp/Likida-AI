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
