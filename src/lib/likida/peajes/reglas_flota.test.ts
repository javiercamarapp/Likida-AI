import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';
import { validarReglasFlota, parsearListaClases } from './reglas_cobro_config';

// A2 ola 1 · reglas de clase por flota (0936): clases del utilitario y la clase 1 como tarifa por pasada.

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const R = await import('./repo');

const T = 'tenant-1';
const OTRO = 'tenant-2';

describe('parsearListaClases / validarReglasFlota (puro)', () => {
  it('lee «1, 2», «1 y 2», «2;1» y vacío', () => {
    expect(parsearListaClases('1, 2')).toEqual([1, 2]);
    expect(parsearListaClases('1 y 2')).toEqual([1, 2]);
    expect(parsearListaClases('2;1;2')).toEqual([1, 2]);
    expect(parsearListaClases('  ')).toEqual([]);
  });
  it('algo que no es un entero de 1 a 12 es null (no se adivina)', () => {
    expect(parsearListaClases('uno')).toBeNull();
    expect(parsearListaClases('0')).toBeNull();
    expect(parsearListaClases('13')).toBeNull();
    expect(parsearListaClases('1.5')).toBeNull();
  });
  it('valida el modo de la clase 1', () => {
    expect(validarReglasFlota({ clasesUtilitario: '1, 2', clase1: 'declaradas' })).toEqual({ ok: true, valor: { clasesUtilitario: [1, 2], clase1: 'declaradas' } });
    expect(validarReglasFlota({ clasesUtilitario: '', clase1: 'quizas' })).toMatchObject({ ok: false });
    expect(validarReglasFlota({ clasesUtilitario: 'x', clase1: 'todas' })).toMatchObject({ ok: false, motivo: expect.stringMatching(/números de 1 a 12/) });
  });
});

describe('leerReglasFlota / guardarReglasFlota', () => {
  beforeEach(() => { db = crearDbFalsa({}); });

  it('sin fila: los defaults seguros (utilitarios sin evaluar, clase 1 como pasada)', async () => {
    expect(await R.leerReglasFlota(T)).toEqual({ clasesUtilitario: [], clase1: 'todas' });
  });
  it('guarda y vuelve a leer; repetir es seguro; no toca a otra flota', async () => {
    expect(await R.guardarReglasFlota(T, { clasesUtilitario: '2, 1', clase1: 'declaradas' })).toMatchObject({ ok: true });
    expect(await R.guardarReglasFlota(T, { clasesUtilitario: '2, 1', clase1: 'declaradas' })).toMatchObject({ ok: true });
    expect(await R.leerReglasFlota(T)).toEqual({ clasesUtilitario: [1, 2], clase1: 'declaradas' });
    expect(await R.leerReglasFlota(OTRO)).toEqual({ clasesUtilitario: [], clase1: 'todas' });
    expect(db.tablas.peaje_regla_flota).toHaveLength(1);
  });
  it('un valor inválido no se guarda', async () => {
    const r = await R.guardarReglasFlota(T, { clasesUtilitario: '99', clase1: 'todas' });
    expect(r).toMatchObject({ ok: false });
    expect(db.tablas.peaje_regla_flota ?? []).toHaveLength(0);
  });
  it('un error de base al leer lanza (no se confunde con «sin configurar»)', async () => {
    db.fallar('peaje_regla_flota.select', 'boom');
    await expect(R.leerReglasFlota(T)).rejects.toThrow(/leerReglasFlota/);
  });
});

describe('reglasDesdeConfig: casetas por pasada del catálogo y modo de la clase 1', () => {
  it('una caseta por pasada suma la clase 1 a lo que ya tuviera permitido', () => {
    const casetas = [{ id: 'c', nombre: 'Plaza A', nombreNorm: 'plaza a', lat: null, lng: null, clasesPermitidas: [6], noCruzar: false, nota: null, crucesVistos: 0, ultimaVez: null }];
    const reglas = R.reglasDesdeConfig(casetas, [], null, [], new Map(), [], new Map(), { clase1: 'declaradas', casetasPorPasada: new Set(['plaza a', 'plaza b']) });
    expect(reglas.excepcionesClase?.get('plaza a')).toEqual([6, 1]);
    expect(reglas.excepcionesClase?.get('plaza b')).toEqual([1]);
    expect(reglas.clase1).toBe('declaradas');
  });
});
