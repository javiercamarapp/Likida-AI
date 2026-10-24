import { beforeEach, describe, expect, it, vi } from 'vitest';

// El acceso a datos del programa contra un CLIENTE GRABADOR de Supabase: no hay base, pero se ve
// exactamente qué se le pregunta y con qué filtros. Se fija: aislamiento por tenant en TODA llamada,
// lotes acotados, errores que lanzan y la tabla sin migrar traducida a un error llano.

interface Llamada { tabla: string; op: string; filtros: Array<[string, string, unknown]>; valores?: unknown; opciones?: unknown; rango?: [number, number]; columnas?: string }
let llamadas: Llamada[] = [];
let respuesta: (l: Llamada) => { data: unknown; error: { message: string; code?: string } | null } = () => ({ data: [], error: null });

function constructor(tabla: string) {
  const l: Llamada = { tabla, op: 'select', filtros: [] };
  const b: Record<string, unknown> = {};
  const encadenar = (nombre: string) => (...a: unknown[]) => {
    if (['eq', 'neq', 'in', 'is', 'gte', 'lte'].includes(nombre)) l.filtros.push([nombre, String(a[0]), a[1]]);
    if (nombre === 'range') l.rango = [Number(a[0]), Number(a[1])];
    if (nombre === 'select') l.columnas = String(a[0]);
    return b;
  };
  for (const m of ['select', 'eq', 'neq', 'in', 'is', 'gte', 'lte', 'order', 'limit', 'range']) b[m] = encadenar(m);
  b.insert = (v: unknown) => { l.op = 'insert'; l.valores = v; return b; };
  b.update = (v: unknown) => { l.op = 'update'; l.valores = v; return b; };
  b.delete = () => { l.op = 'delete'; return b; };
  b.upsert = (v: unknown, o: unknown) => { l.op = 'upsert'; l.valores = v; l.opciones = o; return b; };
  b.maybeSingle = () => { llamadas.push(l); const r = respuesta(l); return Promise.resolve({ ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data }); };
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => { llamadas.push(l); return Promise.resolve(respuesta(l)).then(ok, ko); };
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => constructor(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { crearRepoPrograma, ProgramaSinMigrar, LOTE_ESCRITURA } = await import('./repo');
import type { FilaParaGuardar } from './repo';

const T1 = '11111111-1111-4111-8111-111111111111';
const CARGA = '33333333-3333-4333-8333-333333333333';

const filaPara = (n: number): FilaParaGuardar => ({
  cargaId: CARGA, terminal: 'GDL', fecha: '2026-10-05', tipo: 'EXPORTACION', bloque: null, num: n, claveNatural: `2026-10-05|EXPORTACION||${n}`,
  cliente: 'CLI', consignatario: 'CON', linea: 'LNX', caja: `ZC${n}`, unidad: `TC${n}`, citaEn: '2026-10-05T08:00:00-06:00', citaTexto: null,
  transito: 'patio_nld', ccp: 'listo', comentarios: null, huella: 'h'.repeat(32), vistaEn: '2026-10-05T12:00:00.000Z',
});

const tieneTenant = (l: Llamada): boolean => {
  if (l.filtros.some(([o, c, v]) => o === 'eq' && c === 'tenant_id' && v === T1)) return true;
  const v = l.valores;
  const filas = Array.isArray(v) ? v : v ? [v] : [];
  return filas.length > 0 && filas.every((f) => (f as Record<string, unknown>).tenant_id === T1);
};

const NUEVA_CARGA = { terminal: 'GDL', origen: 'subida' as const, archivoSha256: 'a'.repeat(64), filasLeidas: 3, filasValidas: 2, avisos: [{ codigo: 'x', cuantas: 1 }] };

beforeEach(() => { llamadas = []; respuesta = () => ({ data: [], error: null }); });

describe('AISLAMIENTO: toda llamada del repo lleva el tenant', () => {
  it('cada método filtra o escribe con tenant_id', async () => {
    const repo = crearRepoPrograma();
    respuesta = (l) => (l.op === 'insert' && l.tabla === 'programa_despacho_carga' ? { data: [{ id: CARGA }], error: null } : { data: [], error: null });
    await repo.registrarCarga(T1, NUEVA_CARGA);
    await repo.descartarCarga(T1, CARGA);
    await repo.reabrirCargaSiNoEsUltima(T1, 'GDL', 'b'.repeat(64));
    await repo.restaurarCarga(T1, CARGA, '2026-10-01T00:00:00.000Z');
    await repo.filasEnRango(T1, 'GDL', '2026-10-05', '2026-10-31');
    await repo.insertarFilas(T1, [filaPara(1)]);
    await repo.actualizarFilas(T1, [filaPara(2)]);
    await repo.registrarCambios(T1, [{ filaId: CARGA, campo: 'unidad', antes: 'A', despues: 'B', cargaId: CARGA }]);
    await repo.ocultarFilas(T1, [CARGA], CARGA);
    expect(llamadas.map((l) => `${l.tabla}:${l.op}`)).toEqual([
      'programa_despacho_carga:insert', 'programa_despacho_carga:delete', 'programa_despacho_carga:select', 'programa_despacho_carga:update', 'programa_despacho_fila:select',
      'programa_despacho_fila:upsert', 'programa_despacho_fila:upsert', 'programa_despacho_cambio:insert', 'programa_despacho_fila:update',
    ]);
    for (const l of llamadas) expect(tieneTenant(l), `${l.tabla}:${l.op} sin tenant_id`).toBe(true);
  });

  it('la lectura de filas filtra además por terminal y rango de fechas, pagina y nunca pide todas las columnas', async () => {
    await crearRepoPrograma().filasEnRango(T1, 'GDL', '2026-10-05', '2026-10-31');
    const l = llamadas[0];
    expect(l.filtros).toEqual(expect.arrayContaining([
      ['eq', 'terminal', 'GDL'], ['gte', 'fecha', '2026-10-05'], ['lte', 'fecha', '2026-10-31'],
    ]));
    expect(l.rango).toEqual([0, 999]);
    expect(l.columnas).not.toContain('*');
  });

  it('borrar la carga y ocultar filas están acotados por id Y por tenant', async () => {
    const repo = crearRepoPrograma();
    await repo.descartarCarga(T1, CARGA);
    await repo.ocultarFilas(T1, ['f1', 'f2'], CARGA);
    expect(llamadas[0].filtros).toEqual(expect.arrayContaining([['eq', 'tenant_id', T1], ['eq', 'id', CARGA]]));
    expect(llamadas[1].filtros).toEqual(expect.arrayContaining([['eq', 'tenant_id', T1], ['in', 'id', ['f1', 'f2']]]));
    expect(llamadas[1].valores).toEqual({ visible: false, carga_ultima_id: CARGA });
  });
});

describe('lotes acotados', () => {
  it('1 200 filas se escriben en lotes de ≤ 500', async () => {
    const repo = crearRepoPrograma();
    await repo.insertarFilas(T1, Array.from({ length: 1200 }, (_, i) => filaPara(i)));
    expect(llamadas.map((l) => (l.valores as unknown[]).length)).toEqual([LOTE_ESCRITURA, LOTE_ESCRITURA, 200]);
  });

  it('1 200 cambios se escriben en lotes de ≤ 500', async () => {
    const repo = crearRepoPrograma();
    await repo.registrarCambios(T1, Array.from({ length: 1200 }, (_, i) => ({ filaId: CARGA, campo: 'unidad', antes: String(i), despues: 'x', cargaId: CARGA })));
    expect(llamadas.map((l) => (l.valores as unknown[]).length)).toEqual([500, 500, 200]);
  });

  it('ocultar 450 filas va en tandas de 200 ids', async () => {
    await crearRepoPrograma().ocultarFilas(T1, Array.from({ length: 450 }, (_, i) => `f${i}`), CARGA);
    expect(llamadas.map((l) => (l.filtros.find(([o, c]) => o === 'in' && c === 'id')?.[2] as string[]).length)).toEqual([200, 200, 50]);
  });

  it('sin filas no hay llamadas', async () => {
    const repo = crearRepoPrograma();
    await repo.insertarFilas(T1, []);
    await repo.actualizarFilas(T1, []);
    await repo.registrarCambios(T1, []);
    await repo.ocultarFilas(T1, [], CARGA);
    expect(llamadas).toHaveLength(0);
  });
});

describe('escritura de filas', () => {
  it('las nuevas llevan primera_vez; las existentes NO la tocan; ambas upsert por la identidad (tenant, terminal, clave)', async () => {
    const repo = crearRepoPrograma();
    await repo.insertarFilas(T1, [filaPara(1)]);
    await repo.actualizarFilas(T1, [filaPara(1)]);
    const [ins, act] = llamadas;
    expect((ins.valores as Array<Record<string, unknown>>)[0].primera_vez).toBe('2026-10-05T12:00:00.000Z');
    expect('primera_vez' in (act.valores as Array<Record<string, unknown>>)[0]).toBe(false);
    expect(ins.opciones).toEqual({ onConflict: 'tenant_id,terminal,clave_natural' });
    expect(act.opciones).toEqual({ onConflict: 'tenant_id,terminal,clave_natural' });
    expect((act.valores as Array<Record<string, unknown>>)[0]).toMatchObject({ visible: true, carga_ultima_id: CARGA, caja: 'ZC1', unidad: 'TC1' });
  });
});

describe('registrarCarga', () => {
  it('devuelve el id de la carga nueva', async () => {
    respuesta = () => ({ data: [{ id: CARGA }], error: null });
    expect(await crearRepoPrograma().registrarCarga(T1, NUEVA_CARGA)).toEqual({ id: CARGA });
    expect(llamadas[0].valores).toMatchObject({ tenant_id: T1, terminal: 'GDL', archivo_sha256: 'a'.repeat(64), filas_leidas: 3, filas_validas: 2 });
  });

  it('la llave única (23505) significa «ya estaba cargado»: null, no error', async () => {
    respuesta = () => ({ data: null, error: { message: 'duplicate key', code: '23505' } });
    expect(await crearRepoPrograma().registrarCarga(T1, NUEVA_CARGA)).toBeNull();
  });
});

describe('reabrirCargaSiNoEsUltima (A37-A4-01)', () => {
  const OTRA = 'b'.repeat(64);
  it('si el sha es el de la última carga → null y no escribe', async () => {
    respuesta = () => ({ data: [{ id: CARGA, archivo_sha256: OTRA }], error: null });
    expect(await crearRepoPrograma().reabrirCargaSiNoEsUltima(T1, 'GDL', OTRA)).toBeNull();
    expect(llamadas.some((l) => l.op === 'update')).toBe(false);
  });

  it('si entró otro archivo después → marca la carga vieja como la más reciente y devuelve su fecha anterior', async () => {
    respuesta = (l) => {
      if (l.op === 'update') return { data: null, error: null };
      const porSha = l.filtros.some(([, c]) => c === 'archivo_sha256');
      return porSha ? { data: [{ id: CARGA, created_at: '2026-10-01T00:00:00+00:00' }], error: null }
        : { data: [{ id: 'otra', archivo_sha256: 'c'.repeat(64) }], error: null };
    };
    expect(await crearRepoPrograma().reabrirCargaSiNoEsUltima(T1, 'GDL', OTRA)).toEqual({ id: CARGA, creadaAnterior: '2026-10-01T00:00:00+00:00' });
    const u = llamadas.find((l) => l.op === 'update');
    expect(u?.filtros).toContainEqual(['eq', 'tenant_id', T1]);
    expect(u?.filtros).toContainEqual(['eq', 'id', CARGA]);
  });
});

describe('errores', () => {
  it('un error de la base LANZA, nunca se lee como «no hay nada»', async () => {
    respuesta = () => ({ data: null, error: { message: 'boom', code: 'XX000' } });
    await expect(crearRepoPrograma().filasEnRango(T1, 'GDL', '2026-10-05', '2026-10-06')).rejects.toThrow(/boom/);
    await expect(crearRepoPrograma().insertarFilas(T1, [filaPara(1)])).rejects.toThrow(/insertar_filas: boom/);
    await expect(crearRepoPrograma().registrarCarga(T1, NUEVA_CARGA)).rejects.toThrow(/boom/);
  });

  it.each(['42P01', 'PGRST205'])('tabla sin migrar (%s) → ProgramaSinMigrar con mensaje llano, en lectura y escritura', async (code) => {
    respuesta = () => ({ data: null, error: { message: 'relation does not exist', code } });
    const repo = crearRepoPrograma();
    await expect(repo.filasEnRango(T1, 'GDL', '2026-10-05', '2026-10-06')).rejects.toBeInstanceOf(ProgramaSinMigrar);
    await expect(repo.registrarCarga(T1, NUEVA_CARGA)).rejects.toThrow(/0795/);
    await expect(repo.ocultarFilas(T1, ['f'], CARGA)).rejects.toBeInstanceOf(ProgramaSinMigrar);
  });
});

describe('A37-S59-05 · estado de la carga (0894)', () => {
  beforeEach(() => { llamadas = []; respuesta = () => ({ data: [], error: null }); });
  it('cargaPrevia filtra por flota, terminal y sha, y reporta si está sellada', async () => {
    respuesta = () => ({ data: [{ id: CARGA, created_at: new Date(Date.now() - 30 * 60_000).toISOString(), completada_en: null }], error: null });
    const c = await crearRepoPrograma().cargaPrevia!(T1, 'GDL', 'a'.repeat(64));
    expect(c).toMatchObject({ id: CARGA, completa: false });
    expect(c!.antiguedadMin).toBeGreaterThan(29);
    expect(tieneTenant(llamadas[0])).toBe(true);
    expect(llamadas[0].filtros).toEqual(expect.arrayContaining([['eq', 'terminal', 'GDL'], ['eq', 'archivo_sha256', 'a'.repeat(64)]]));
  });
  it('sin la 0894 (columna inexistente) la carga se asume completa: se comporta como antes', async () => {
    respuesta = () => ({ data: null, error: { message: 'column does not exist', code: '42703' } });
    expect(await crearRepoPrograma().cargaPrevia!(T1, 'GDL', 'a'.repeat(64))).toBeNull();
    await expect(crearRepoPrograma().completarCarga!(T1, CARGA)).resolves.toBeUndefined();
  });
  it('completarCarga sella con la hora y solo esa carga de esa flota', async () => {
    await crearRepoPrograma().completarCarga!(T1, CARGA);
    expect(llamadas[0].op).toBe('update');
    expect(llamadas[0].valores).toMatchObject({ completada_en: expect.any(String) });
    expect(tieneTenant(llamadas[0])).toBe(true);
    expect(llamadas[0].filtros).toEqual(expect.arrayContaining([['eq', 'id', CARGA]]));
  });
  it('cambiosDeCarga lee los de ESA carga y los reporta como fila|campo|despues', async () => {
    respuesta = (l) => ({ data: l.rango && l.rango[0] > 0 ? [] : [{ fila_id: 'f1', campo: 'unidad', despues: 'TC9' }], error: null });
    const s = await crearRepoPrograma().cambiosDeCarga!(T1, CARGA);
    expect([...s]).toEqual(['f1|unidad|TC9']);
    expect(llamadas[0].filtros).toEqual(expect.arrayContaining([['eq', 'carga_id', CARGA]]));
  });
});
