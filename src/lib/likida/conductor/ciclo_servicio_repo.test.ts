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
const { SEMILLA_CICLOS } = await import('./ciclo_servicio');
const fila = (extra: Record<string, unknown> = {}) => ({ tenant_id: 't1', servicio: 'importacion', orden: 1, hito: 'confirmar', activo: true, ...extra });

beforeEach(() => { registros.length = 0; respuestas = []; });

describe('leerCicloServicio', () => {
  it('lee solo la flota pedida y devuelve las filas en camelCase', async () => {
    respuestas = [{ data: [fila(), fila({ orden: 2, hito: 'inicio_viaje', activo: false })], error: null }];
    const r = await repo.leerCicloServicio('t1');
    expect(registros[0].tabla).toBe('ciclo_servicio');
    expect(registros[0].ops).toContainEqual(['eq', 'tenant_id', 't1']);
    expect(r).toEqual([
      { tenantId: 't1', servicio: 'importacion', orden: 1, hito: 'confirmar', activo: true },
      { tenantId: 't1', servicio: 'importacion', orden: 2, hito: 'inicio_viaje', activo: false },
    ]);
  });

  it('descarta filas con servicio o hito fuera del vocabulario', async () => {
    respuestas = [{ data: [fila({ servicio: 'aereo' }), fila({ hito: 'inventado' }), fila({ orden: 0 }), fila()], error: null }];
    expect(await repo.leerCicloServicio('t1')).toHaveLength(1);
  });

  it('una base sin la 0807 devuelve [] (ciclo actual); otro error se lanza', async () => {
    respuestas = [{ error: { message: 'relation "public.ciclo_servicio" does not exist', code: '42P01' } }];
    expect(await repo.leerCicloServicio('t1')).toEqual([]);
    respuestas = [{ error: { message: 'connection reset', code: '08006' } }];
    await expect(repo.leerCicloServicio('t1')).rejects.toThrow(/ciclo_servicio_leer/);
  });
});

describe('sembrarCicloServicio', () => {
  it('inserta la semilla completa anclada a la flota, ignorando lo que ya existe', async () => {
    expect(await repo.sembrarCicloServicio('t9')).toBe('ok');
    const up = registros[0].ops.find(([o]) => o === 'upsert')!;
    const filas = up[1] as Array<{ tenant_id: string }>;
    expect(filas).toHaveLength(SEMILLA_CICLOS.length);
    expect(filas.every((f) => f.tenant_id === 't9')).toBe(true);
    expect(up[2]).toEqual({ onConflict: 'tenant_id,servicio,orden', ignoreDuplicates: true });
  });

  it('sin tabla es «sin_tabla»; otro error es «fallo»', async () => {
    respuestas = [{ error: { message: 'relation "public.ciclo_servicio" does not exist', code: '42P01' } }];
    expect(await repo.sembrarCicloServicio('t9')).toBe('sin_tabla');
    respuestas = [{ error: { message: 'connection reset', code: '08006' } }];
    expect(await repo.sembrarCicloServicio('t9')).toBe('fallo');
  });
});
