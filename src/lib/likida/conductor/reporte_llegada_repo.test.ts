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
const hito = { id: 'h1', tenantId: 't1', viajeId: 'v1', tipo: 'llegada_descarga' as const };
const arg = (r: Registro, op: string) => r.ops.find(([o]) => o === op)?.[1] as Record<string, unknown>;

beforeEach(() => { registros.length = 0; respuestas = []; });

describe('T-A5-43 · la bitácora del reporte de llegada (repo real, base simulada)', () => {
  it('guardarEventoReporte inserta un renglón `validacion` con la clase del reporte, del hito y la flota correctos', async () => {
    expect(await repo.guardarEventoReporte(hito, { tipo: 'rampa', estado: 'si', numero: '7', ciclo: 1 })).toBe(true);
    expect(registros[0].tabla).toBe('viaje_hito_evento');
    expect(arg(registros[0], 'insert')).toEqual({
      tenant_id: 't1', viaje_id: 'v1', viaje_hito_id: 'h1', tipo_hito: 'llegada_descarga', evento: 'validacion',
      detalle: { clase: 'reporte_llegada', tipo: 'rampa', estado: 'si', numero: '7', ciclo: 1 },
    });
  });

  it('un error de la base (por valor o lanzado) es `false`: nunca se disfraza de «guardado»', async () => {
    respuestas = [{ error: { message: 'connection reset', code: '08006' } }];
    expect(await repo.guardarEventoReporte(hito, { tipo: 'pregunta', paso: 'contacto', ciclo: 1 })).toBe(false);
  });

  it('leerEventosReporte filtra por flota, viajes, evento y clase, y devuelve los renglones en orden', async () => {
    respuestas = [{ data: [
      { id: 1, viaje_id: 'v1', viaje_hito_id: 'h1', detalle: { clase: 'reporte_llegada', tipo: 'pregunta', paso: 'contacto', ciclo: 1 }, created_at: '2026-10-02T18:00:00.000Z' },
      { id: 2, viaje_id: 'v1', viaje_hito_id: 'h1', detalle: { clase: 'reporte_llegada', tipo: 'rampa', estado: 'no', ciclo: 1 }, created_at: '2026-10-02T18:05:00.000Z' },
    ], error: null }];
    const evs = await repo.leerEventosReporte('t1', ['v1']);
    expect(evs.map((e) => e.id)).toEqual([1, 2]);
    expect(evs[1]).toMatchObject({ viajeId: 'v1', hitoId: 'h1', creadoEn: '2026-10-02T18:05:00.000Z' });
    const ops = registros[0].ops;
    expect(ops).toContainEqual(['eq', 'tenant_id', 't1']);
    expect(ops).toContainEqual(['in', 'viaje_id', ['v1']]);
    expect(ops).toContainEqual(['eq', 'evento', 'validacion']);
    expect(ops).toContainEqual(['eq', 'detalle->>clase', 'reporte_llegada']);
  });

  it('sin viajes no lee; una base caída lanza (no es «nadie preguntó nada»)', async () => {
    expect(await repo.leerEventosReporte('t1', [])).toEqual([]);
    expect(registros).toHaveLength(0);
    respuestas = [{ error: { message: 'timeout', code: '57014' } }];
    await expect(repo.leerEventosReporte('t1', ['v1'])).rejects.toThrow(/conductor.reporte_eventos/);
  });
});
