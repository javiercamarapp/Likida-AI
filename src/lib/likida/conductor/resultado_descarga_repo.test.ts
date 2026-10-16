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

beforeEach(() => { registros.length = 0; respuestas = []; });

describe('T-A5-46 · la bitácora del resultado de la descarga (repo real, base simulada)', () => {
  it('leerEventosResultadoDescarga filtra por flota, viajes, evento y clase, y devuelve los renglones en orden', async () => {
    respuestas = [{ data: [
      { id: 1, viaje_id: 'v1', viaje_hito_id: 'h1', evento: 'validacion', detalle: { clase: 'resultado_descarga', estado: 'preguntado', ciclo: 1 }, created_at: '2026-10-02T18:00:00.000Z' },
      { id: 2, viaje_id: 'v1', viaje_hito_id: 'h1', evento: 'validacion', detalle: { clase: 'resultado_descarga', estado: 'respondido', opcion: 'completa', ciclo: 1 }, created_at: '2026-10-02T18:05:00.000Z' },
    ], error: null }];
    const evs = await repo.leerEventosResultadoDescarga('t1', ['v1']);
    expect(evs.map((e) => e.id)).toEqual([1, 2]);
    expect(evs[1]).toMatchObject({ viajeId: 'v1', hitoId: 'h1', evento: 'validacion', creadoEn: '2026-10-02T18:05:00.000Z' });
    expect(registros[0].tabla).toBe('viaje_hito_evento');
    const ops = registros[0].ops;
    expect(ops).toContainEqual(['eq', 'tenant_id', 't1']);
    expect(ops).toContainEqual(['in', 'viaje_id', ['v1']]);
    expect(ops).toContainEqual(['eq', 'evento', 'validacion']);
    expect(ops).toContainEqual(['eq', 'detalle->>clase', 'resultado_descarga']);
  });

  it('sin viajes no consulta nada, y un error de la base se lanza (no se disfraza de «sin eventos»)', async () => {
    expect(await repo.leerEventosResultadoDescarga('t1', [])).toEqual([]);
    expect(registros).toHaveLength(0);
    respuestas = [{ error: { message: 'connection reset', code: '08006' } }];
    await expect(repo.leerEventosResultadoDescarga('t1', ['v1'])).rejects.toBeTruthy();
  });
});
