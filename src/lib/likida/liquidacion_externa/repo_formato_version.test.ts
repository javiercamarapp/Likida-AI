import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-S14-10: el formato de la flota y los teléfonos de la copia / del aviso «No coincide» se guardaban leyendo-y-escribiendo sin
// control de versión: dos guardados simultáneos (subir muestra + guardar ajustes) y gana el último, perdiendo en silencio a quién
// le llegan las cifras. Ahora el guardado lleva la versión (`actualizado_en`) que la persona leyó y una escritura sobre una fila
// que ya cambió se RECHAZA con un mensaje que dice qué hacer.

type Op = [string, ...unknown[]];
interface Llamada { tabla: string; ops: Op[] }
const llamadas: Llamada[] = [];
let respuestas: Array<{ data?: unknown; error?: { message: string; code?: string } | null }> = [];

function constructor(tabla: string) {
  const ll: Llamada = { tabla, ops: [] };
  llamadas.push(ll);
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq']) b[m] = (...a: unknown[]) => { ll.ops.push([m, ...a]); return b; };
  const resolver = () => respuestas.shift() ?? { data: [], error: null };
  b.maybeSingle = async () => { ll.ops.push(['maybeSingle']); return resolver(); };
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(resolver()).then(res, rej);
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: constructor }) }));
vi.mock('../presupuesto', async (orig) => ({ ...(await orig<typeof import('../presupuesto')>()), acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const repo = await import('./repo');
const { DatoInvalido } = await import('../errores');
const { FORMATO_BASE } = await import('./formato_flota');

const CONFIG = { formato: FORMATO_BASE, nombreMuestra: 'muestra.xlsx', copiaTelefonos: ['5255'], discrepanciaTelefonos: [] };
const tieneEq = (l: Llamada, col: string, v: unknown) => l.ops.some((o) => o[0] === 'eq' && o[1] === col && o[2] === v);
const hay = (l: Llamada, verbo: string) => l.ops.some((o) => o[0] === verbo);

beforeEach(() => { llamadas.length = 0; respuestas = []; });

describe('leerVersionFormato', () => {
  it('devuelve actualizado_en de la fila de ESTA flota; null si no hay fila o la tabla no existe; lanza ante otro error', async () => {
    respuestas = [{ data: { actualizado_en: '2026-10-24T10:00:00.000Z' }, error: null }];
    expect(await repo.leerVersionFormato('t-1')).toBe('2026-10-24T10:00:00.000Z');
    expect(tieneEq(llamadas[0], 'tenant_id', 't-1')).toBe(true);
    respuestas = [{ data: null, error: null }];
    expect(await repo.leerVersionFormato('t-1')).toBeNull();
    respuestas = [{ data: null, error: { code: '42P01', message: 'relation does not exist' } }];
    expect(await repo.leerVersionFormato('t-1')).toBeNull();
    respuestas = [{ data: null, error: { code: 'XX000', message: 'boom' } }];
    await expect(repo.leerVersionFormato('t-1')).rejects.toThrow(/boom/);
  });
});

describe('guardarFormatoFlota con control de versión', () => {
  it('con versión: actualiza SOLO si la fila sigue en esa versión (y de esta flota)', async () => {
    respuestas = [{ data: [{ tenant_id: 't-1' }], error: null }];
    await repo.guardarFormatoFlota('t-1', CONFIG, 'dueño', '2026-10-24T10:00:00.000Z');
    expect(hay(llamadas[0], 'update')).toBe(true);
    expect(tieneEq(llamadas[0], 'tenant_id', 't-1')).toBe(true);
    expect(tieneEq(llamadas[0], 'actualizado_en', '2026-10-24T10:00:00.000Z')).toBe(true);
  });

  it('con versión y la fila ya cambió (0 filas): RECHAZA con un mensaje que dice qué hacer, sin pisar nada', async () => {
    respuestas = [{ data: [], error: null }];
    const e = await repo.guardarFormatoFlota('t-1', CONFIG, 'dueño', '2026-10-24T10:00:00.000Z').catch((x) => x);
    expect(e).toBeInstanceOf(DatoInvalido);
    expect((e as Error).message).toMatch(/otra persona|ya cambió/i);
    expect(llamadas).toHaveLength(1);
    expect(hay(llamadas[0], 'upsert')).toBe(false);
  });

  it('versión nula (no había fila): inserta; si entre tanto otra persona la creó (23505) RECHAZA', async () => {
    respuestas = [{ data: null, error: null }];
    await repo.guardarFormatoFlota('t-1', CONFIG, 'dueño', null);
    expect(hay(llamadas[0], 'insert')).toBe(true);
    respuestas = [{ data: null, error: { code: '23505', message: 'duplicate key' } }];
    await expect(repo.guardarFormatoFlota('t-1', CONFIG, 'dueño', null)).rejects.toBeInstanceOf(DatoInvalido);
  });

  it('sin versión (otros llamadores) se comporta como siempre: upsert', async () => {
    respuestas = [{ data: null, error: null }];
    await repo.guardarFormatoFlota('t-1', CONFIG, 'dueño');
    expect(hay(llamadas[0], 'upsert')).toBe(true);
  });

  it('un error de base distinto sigue siendo un error de sistema (no se disfraza de conflicto)', async () => {
    respuestas = [{ data: null, error: { code: 'XX000', message: 'boom' } }];
    const e = await repo.guardarFormatoFlota('t-1', CONFIG, 'dueño', 'V').catch((x) => x);
    expect(e).not.toBeInstanceOf(DatoInvalido);
    expect((e as Error).message).toMatch(/boom/);
  });
});
