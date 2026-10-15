import { beforeEach, describe, expect, it, vi } from 'vitest';

// El acceso a datos del aviso contra un CLIENTE GRABADOR de Supabase: no hay base, pero se ve qué se le pregunta y con
// qué filtros. Se fija: aislamiento por tenant en TODA llamada, errores que lanzan, la tabla sin migrar traducida y la
// idempotencia (23505) leída como «duplicado».

interface Llamada { tabla: string; op: string; filtros: Array<[string, string, unknown]>; valores?: unknown; rango?: [number, number]; columnas?: string }
let llamadas: Llamada[] = [];
let respuesta: (l: Llamada) => { data: unknown; error: { message: string; code?: string } | null } = () => ({ data: [], error: null });

function constructor(tabla: string) {
  const l: Llamada = { tabla, op: 'select', filtros: [] };
  const b: Record<string, unknown> = {};
  const encadenar = (nombre: string) => (...a: unknown[]) => {
    if (['eq', 'in', 'gte', 'lte'].includes(nombre)) l.filtros.push([nombre, String(a[0]), a[1]]);
    if (nombre === 'range') l.rango = [Number(a[0]), Number(a[1])];
    if (nombre === 'select') l.columnas = String(a[0]);
    return b;
  };
  for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'range']) b[m] = encadenar(m);
  b.insert = (v: unknown) => { l.op = 'insert'; l.valores = v; return b; };
  b.maybeSingle = () => { llamadas.push(l); const r = respuesta(l); return Promise.resolve({ ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data }); };
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => { llamadas.push(l); return Promise.resolve(respuesta(l)).then(ok, ko); };
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => constructor(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { crearRepoAviso, AvisoSinMigrar } = await import('./repo');
import type { NuevoAviso } from './repo';

const T1 = '11111111-1111-4111-8111-111111111111';
const FILA = '22222222-2222-4222-8222-222222222222';

const nuevo: NuevoAviso = {
  filaId: FILA, clienteId: null, version: 1, huella: 'a'.repeat(64), estado: 'sin_destinatario', canal: 'ejecutivo_copia',
  texto: 'x', datos: { via: 'proxy' }, motivo: 'm',
};

const tieneTenant = (l: Llamada): boolean => {
  if (l.filtros.some(([o, c, v]) => o === 'eq' && c === 'tenant_id' && v === T1)) return true;
  const v = l.valores;
  const filas = Array.isArray(v) ? v : v ? [v] : [];
  return filas.length > 0 && filas.every((f) => (f as Record<string, unknown>).tenant_id === T1);
};

beforeEach(() => { llamadas = []; respuesta = () => ({ data: [], error: null }); });

describe('AISLAMIENTO: toda llamada del repo lleva el tenant', () => {
  it('cada método filtra o escribe con tenant_id', async () => {
    const repo = crearRepoAviso();
    await repo.leerConfig(T1);
    await repo.filasVisibles(T1, '2026-10-05', '2026-10-07', 0, 500);
    await repo.avisosDeFilas(T1, [FILA]);
    await repo.insertarAviso(T1, nuevo);
    expect(llamadas.map((l) => `${l.tabla}:${l.op}`)).toEqual([
      'vigia_aviso_config:select', 'programa_despacho_fila:select', 'vigia_aviso:select', 'vigia_aviso:insert',
    ]);
    for (const l of llamadas) expect(tieneTenant(l), `${l.tabla}:${l.op} sin tenant_id`).toBe(true);
  });

  it('las filas se piden solo visibles, en el rango, paginadas y sin select *', async () => {
    await crearRepoAviso().filasVisibles(T1, '2026-10-05', '2026-10-07', 500, 500);
    const l = llamadas[0];
    expect(l.filtros).toEqual(expect.arrayContaining([['eq', 'visible', true], ['gte', 'fecha', '2026-10-05'], ['lte', 'fecha', '2026-10-07']]));
    expect(l.rango).toEqual([500, 999]);
    expect(l.columnas).not.toContain('*');
  });

  it('los ids de las filas se consultan en tandas acotadas', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `id-${i}`);
    await crearRepoAviso().avisosDeFilas(T1, ids);
    expect(llamadas).toHaveLength(3);
    expect(llamadas.every((l) => (l.filtros.find(([o]) => o === 'in')?.[2] as unknown[]).length <= 200)).toBe(true);
  });
});

describe('lectura de la configuración', () => {
  it('sin fila → null (apagado)', async () => {
    expect(await crearRepoAviso().leerConfig(T1)).toBeNull();
  });

  it('traduce la fila y cae a lo conservador ante valores raros', async () => {
    respuesta = () => ({
      data: [{ habilitado: true, modo: 'raro', canal_default: 'raro', ccp_listos: ['listo', 3], exigir_transito: true, secciones: null, horas_antes_cita: 3, zona: '' }],
      error: null,
    });
    expect(await crearRepoAviso().leerConfig(T1)).toEqual({
      habilitado: true, modo: 'confirmar', canalDefault: 'ejecutivo_copia', ccpListos: ['listo'], exigirTransito: true,
      secciones: [], horasAntesCita: 3, zona: 'America/Mexico_City',
    });
  });

  it('un habilitado que no es exactamente true cuenta como apagado', async () => {
    respuesta = () => ({ data: [{ habilitado: 'true' }], error: null });
    expect((await crearRepoAviso().leerConfig(T1))?.habilitado).toBe(false);
  });
});

describe('errores y tabla sin migrar', () => {
  it('un error de la base LANZA en lectura, nunca se lee como «no hay nada»', async () => {
    respuesta = () => ({ data: null, error: { message: 'timeout' } });
    await expect(crearRepoAviso().filasVisibles(T1, 'a', 'b', 0, 10)).rejects.toThrow('aviso.filas_visibles: timeout');
    await expect(crearRepoAviso().avisosDeFilas(T1, [FILA])).rejects.toThrow('aviso.avisos_de_filas');
    await expect(crearRepoAviso().leerConfig(T1)).rejects.toThrow('aviso.leer_config');
  });

  it('42P01 y PGRST205 se traducen a AvisoSinMigrar', async () => {
    for (const code of ['42P01', 'PGRST205']) {
      respuesta = () => ({ data: null, error: { message: 'no existe', code } });
      await expect(crearRepoAviso().leerConfig(T1)).rejects.toBeInstanceOf(AvisoSinMigrar);
      await expect(crearRepoAviso().insertarAviso(T1, nuevo)).rejects.toBeInstanceOf(AvisoSinMigrar);
    }
  });
});

describe('insertarAviso', () => {
  it('creado cuando entra', async () => {
    expect(await crearRepoAviso().insertarAviso(T1, nuevo)).toBe('creado');
    const v = llamadas[0].valores as Record<string, unknown>;
    expect(v).toMatchObject({ tenant_id: T1, fila_id: FILA, version: 1, estado: 'sin_destinatario', aprobado_en: null });
  });

  it('23505 (misma huella o misma versión) es duplicado, no error', async () => {
    respuesta = () => ({ data: null, error: { message: 'duplicate key', code: '23505' } });
    expect(await crearRepoAviso().insertarAviso(T1, nuevo)).toBe('duplicado');
  });

  it('otro error de escritura lanza', async () => {
    respuesta = () => ({ data: null, error: { message: 'violates check', code: '23514' } });
    await expect(crearRepoAviso().insertarAviso(T1, nuevo)).rejects.toThrow('aviso.insertar');
  });

  it('un aviso aprobado lleva aprobado_en (lo exige el CHECK de la 0797)', async () => {
    await crearRepoAviso().insertarAviso(T1, { ...nuevo, estado: 'aprobado', aprobadoEn: '2026-10-05T14:00:00.000Z' });
    expect((llamadas[0].valores as Record<string, unknown>).aprobado_en).toBe('2026-10-05T14:00:00.000Z');
  });
});

describe('pendientesConfirmacion (T-A4-42)', () => {
  it('pide solo los pendientes de ESA flota, acotados, y solo fecha de nacimiento y cita (sin texto ni select *)', async () => {
    respuesta = () => ({ data: [{ creado_en: '2026-10-05T10:00:00Z', cita: '2026-10-05T20:00:00Z' }, { creado_en: '2026-10-05T11:00:00Z', cita: null }], error: null });
    const r = await crearRepoAviso().pendientesConfirmacion!(T1, 500);
    expect(r).toEqual([{ creadoEn: '2026-10-05T10:00:00Z', cita: '2026-10-05T20:00:00Z' }, { creadoEn: '2026-10-05T11:00:00Z', cita: null }]);
    const l = llamadas[0];
    expect(l.tabla).toBe('vigia_aviso');
    expect(l.filtros).toEqual(expect.arrayContaining([['eq', 'tenant_id', T1], ['eq', 'estado', 'pendiente_confirmacion']]));
    expect(l.rango).toEqual([0, 499]);
    expect(l.columnas).not.toMatch(/\*|texto|cliente|datos\b(?!->)/);
  });
  it('un error de la base lanza, no devuelve una cola vacía', async () => {
    respuesta = () => ({ data: null, error: { message: 'caída' } });
    await expect(crearRepoAviso().pendientesConfirmacion!(T1, 10)).rejects.toThrow('aviso.pendientes_confirmacion');
  });
});
