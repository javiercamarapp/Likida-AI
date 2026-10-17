import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

type Respuesta = { data?: unknown; error?: { message: string; code?: string } | null };
interface Registro { tabla: string; ops: Array<[string, ...unknown[]]> }
const registros: Registro[] = [];
let respuestas: Respuesta[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const reg: Registro = { tabla, ops: [] };
      registros.push(reg);
      const proxy: unknown = new Proxy({}, {
        get: (_t, prop: string) => {
          if (prop === 'then') return (res: (r: Respuesta) => unknown) => res(respuestas.shift() ?? { data: [], error: null });
          return (...args: unknown[]) => { if (prop !== 'abortSignal') reg.ops.push([prop, ...args]); return proxy; };
        },
      });
      return proxy;
    },
  }),
}));

const repo = await import('./repo');
const AHORA = new Date('2026-10-02T14:30:00.000Z');
const arg = (r: Registro, op: string) => r.ops.find(([o]) => o === op)?.[1] as Record<string, unknown>;
const fila = (extra: Record<string, unknown> = {}) => ({
  id: 'p1', tenant_id: 't1', viaje_id: 'v1', inicio: '2026-10-02T14:00:00.000Z', fin: null, motivo: 'trafico', origen: 'chofer', ...extra,
});

beforeEach(() => { registros.length = 0; respuestas = []; });

describe('abrirParada', () => {
  it('inserta con la flota, el viaje, el motivo, el inicio y el origen chofer', async () => {
    expect(await repo.abrirParada('t1', 'v1', 'descanso', AHORA)).toBe('ok');
    expect(registros[0].tabla).toBe('viaje_parada');
    expect(arg(registros[0], 'insert')).toEqual({ tenant_id: 't1', viaje_id: 'v1', motivo: 'descanso', inicio: AHORA.toISOString(), origen: 'chofer' });
  });

  it('el índice único (23505) es «duplicada», no un fallo', async () => {
    respuestas = [{ error: { message: 'duplicate key value violates unique constraint "viaje_parada_abierta_unica"', code: '23505' } }];
    expect(await repo.abrirParada('t1', 'v1', 'trafico', AHORA)).toBe('duplicada');
  });

  it('una base sin la 0806 es «sin_tabla»; cualquier otro error es «fallo»', async () => {
    respuestas = [{ error: { message: 'relation "public.viaje_parada" does not exist', code: '42P01' } }];
    expect(await repo.abrirParada('t1', 'v1', 'trafico', AHORA)).toBe('sin_tabla');
    respuestas = [{ error: { message: 'connection reset', code: '08006' } }];
    expect(await repo.abrirParada('t1', 'v1', 'trafico', AHORA)).toBe('fallo');
  });
});

describe('leerParadaAbierta', () => {
  it('filtra por flota y viaje y solo las abiertas', async () => {
    respuestas = [{ data: fila(), error: null }];
    const p = await repo.leerParadaAbierta('t1', 'v1');
    expect(p).toMatchObject({ id: 'p1', motivo: 'trafico', fin: null, origen: 'chofer' });
    const ops = registros[0].ops;
    expect(ops).toContainEqual(['eq', 'tenant_id', 't1']);
    expect(ops).toContainEqual(['eq', 'viaje_id', 'v1']);
    expect(ops).toContainEqual(['is', 'fin', null]);
  });

  it('sin fila → null; sin la 0806 → null; otro error lanza (una base caída no es «no hay parada»)', async () => {
    respuestas = [{ data: null, error: null }];
    expect(await repo.leerParadaAbierta('t1', 'v1')).toBeNull();
    respuestas = [{ error: { message: 'relation "viaje_parada" does not exist', code: '42P01' } }];
    expect(await repo.leerParadaAbierta('t1', 'v1')).toBeNull();
    respuestas = [{ error: { message: 'timeout', code: '57014' } }];
    await expect(repo.leerParadaAbierta('t1', 'v1')).rejects.toThrow(/conductor.parada_leer/);
  });

  it('un motivo fuera del vocabulario no se lee como parada', async () => {
    respuestas = [{ data: fila({ motivo: 'comida' }), error: null }];
    expect(await repo.leerParadaAbierta('t1', 'v1')).toBeNull();
  });
});

describe('cerrarParada', () => {
  it('UPDATE condicional (fin nulo) con fin y origen', async () => {
    respuestas = [{ data: fila(), error: null }, { data: [{ id: 'p1' }], error: null }];
    expect(await repo.cerrarParada('t1', 'v1', AHORA, 'chofer')).toBe('cerrada');
    const upd = registros[1];
    expect(arg(upd, 'update')).toEqual({ fin: AHORA.toISOString(), origen: 'chofer' });
    expect(upd.ops).toContainEqual(['eq', 'id', 'p1']);
    expect(upd.ops).toContainEqual(['eq', 'tenant_id', 't1']);
    expect(upd.ops).toContainEqual(['is', 'fin', null]);
  });

  it('el cierre del sistema lleva origen sistema y nunca queda antes del inicio (el CHECK fin >= inicio)', async () => {
    respuestas = [{ data: fila({ inicio: '2026-10-02T16:00:00.000Z' }), error: null }, { data: [{ id: 'p1' }], error: null }];
    expect(await repo.cerrarParada('t1', 'v1', AHORA, 'sistema')).toBe('cerrada');
    expect(arg(registros[1], 'update')).toEqual({ fin: '2026-10-02T16:00:00.000Z', origen: 'sistema' });
  });

  it('sin parada abierta no escribe; si otro la cerró primero (cero filas) es «sin_parada»', async () => {
    respuestas = [{ data: null, error: null }];
    expect(await repo.cerrarParada('t1', 'v1', AHORA, 'chofer')).toBe('sin_parada');
    expect(registros).toHaveLength(1);
    registros.length = 0;
    respuestas = [{ data: fila(), error: null }, { data: [], error: null }];
    expect(await repo.cerrarParada('t1', 'v1', AHORA, 'chofer')).toBe('sin_parada');
  });

  it('errores: la lectura caída y la escritura fallida son «fallo»; sin la 0806, «sin_tabla»', async () => {
    respuestas = [{ error: { message: 'timeout', code: '57014' } }];
    expect(await repo.cerrarParada('t1', 'v1', AHORA, 'chofer')).toBe('fallo');
    respuestas = [{ data: fila(), error: null }, { error: { message: 'connection reset', code: '08006' } }];
    expect(await repo.cerrarParada('t1', 'v1', AHORA, 'chofer')).toBe('fallo');
    respuestas = [{ data: fila(), error: null }, { error: { message: 'relation "viaje_parada" does not exist', code: '42P01' } }];
    expect(await repo.cerrarParada('t1', 'v1', AHORA, 'chofer')).toBe('sin_tabla');
  });
});
