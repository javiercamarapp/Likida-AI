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
const hito = { id: 'h1', tenantId: 't1', viajeId: 'v1', tipo: 'salida_carga' as const };
const arg = (r: Registro, op: string) => r.ops.find(([o]) => o === op)?.[1] as Record<string, unknown>;

beforeEach(() => { registros.length = 0; respuestas = []; });

describe('T-A5-39 · la bitácora de detención sin aviso (repo real, base simulada)', () => {
  it('guardarEventoDetencion inserta un renglón `validacion` con la clase de la detención, del hito y la flota correctos', async () => {
    expect(await repo.guardarEventoDetencion(hito, { tipo: 'pregunta', ordinal: 2 })).toBe(true);
    expect(registros[0].tabla).toBe('viaje_hito_evento');
    expect(arg(registros[0], 'insert')).toEqual({
      tenant_id: 't1', viaje_id: 'v1', viaje_hito_id: 'h1', tipo_hito: 'salida_carga', evento: 'validacion',
      detalle: { clase: 'deteccion_parada', tipo: 'pregunta', ordinal: 2 },
    });
  });

  it('un error de la base es `false`: nunca se disfraza de «guardado»', async () => {
    respuestas = [{ error: { message: 'connection reset', code: '08006' } }];
    expect(await repo.guardarEventoDetencion(hito, { tipo: 'pregunta', ordinal: 1 })).toBe(false);
  });

  it('leerEventosDetencion filtra por flota, viajes, evento y clase, y devuelve los renglones en orden', async () => {
    respuestas = [{ data: [
      { id: 1, viaje_id: 'v1', viaje_hito_id: 'h1', detalle: { clase: 'deteccion_parada', tipo: 'pregunta' }, created_at: '2026-10-02T18:00:00.000Z' },
      { id: 2, viaje_id: 'v1', viaje_hito_id: 'h1', detalle: { clase: 'deteccion_parada', tipo: 'cierre', motivo: 'movimiento' }, created_at: '2026-10-02T19:00:00.000Z' },
    ], error: null }];
    const evs = await repo.leerEventosDetencion('t1', ['v1']);
    expect(evs.map((e) => e.id)).toEqual([1, 2]);
    expect(evs[1]).toMatchObject({ viajeId: 'v1', hitoId: 'h1', creadoEn: '2026-10-02T19:00:00.000Z' });
    const ops = registros[0].ops;
    expect(ops).toContainEqual(['eq', 'tenant_id', 't1']);
    expect(ops).toContainEqual(['in', 'viaje_id', ['v1']]);
    expect(ops).toContainEqual(['eq', 'evento', 'validacion']);
    expect(ops).toContainEqual(['eq', 'detalle->>clase', 'deteccion_parada']);
  });

  it('A37-S36-01: con más de 200 viajes NO manda todos los ids en una URL: tandas de ≤200, y la bitácora vuelve ordenada por id', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `v${i}`);
    const fila = (id: number, v: string) => ({ id, viaje_id: v, viaje_hito_id: 'h', detalle: { clase: 'deteccion_parada', tipo: 'pregunta' }, created_at: '2026-10-02T18:00:00.000Z' });
    // por tanda: una página con datos y luego la vacía que la cierra
    respuestas = [
      { data: [fila(5, 'v0')], error: null }, { data: [], error: null },
      { data: [fila(2, 'v250')], error: null }, { data: [], error: null },
      { data: [fila(9, 'v449')], error: null }, { data: [], error: null },
    ];
    const evs = await repo.leerEventosDetencion('t1', ids);
    const tamanos = registros.map((r) => (r.ops.find(([o, c]) => o === 'in' && c === 'viaje_id') as [string, string, string[]])[2].length);
    expect(Math.max(...tamanos)).toBeLessThanOrEqual(200);
    expect(tamanos.filter((n) => n > 0).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(450);
    expect(evs.map((e) => e.id)).toEqual([2, 5, 9]);
  });

  it('sin viajes no lee; una base caída lanza (no es «nadie preguntó nada»)', async () => {
    expect(await repo.leerEventosDetencion('t1', [])).toEqual([]);
    expect(registros).toHaveLength(0);
    respuestas = [{ error: { message: 'timeout', code: '57014' } }];
    await expect(repo.leerEventosDetencion('t1', ['v1'])).rejects.toThrow(/conductor.detencion_eventos/);
  });
});

describe('T-A5-39 · las paradas recientes (repo real, base simulada)', () => {
  const DESDE = new Date('2026-10-02T17:45:00.000Z');
  it('pide las abiertas y las cerradas desde `desde`, de esa flota y esos viajes, y las devuelve tipadas', async () => {
    respuestas = [{ data: [
      { id: 'p1', tenant_id: 't1', viaje_id: 'v1', inicio: '2026-10-02T17:00:00.000Z', fin: null, motivo: 'pernocta', origen: 'chofer' },
      { id: 'p2', tenant_id: 't1', viaje_id: 'v2', inicio: '2026-10-02T17:10:00.000Z', fin: '2026-10-02T17:50:00.000Z', motivo: 'trafico', origen: 'chofer' },
      { id: 'p3', tenant_id: 't1', viaje_id: 'v3', inicio: '2026-10-02T17:10:00.000Z', fin: null, motivo: 'inventado', origen: 'chofer' },
    ], error: null }];
    const ps = await repo.leerParadasRecientes('t1', ['v1', 'v2', 'v3'], DESDE);
    expect(ps.map((p) => [p.viajeId, p.motivo, p.fin])).toEqual([['v1', 'pernocta', null], ['v2', 'trafico', '2026-10-02T17:50:00.000Z']]); // el motivo fuera del vocabulario no entra
    const ops = registros[0].ops;
    expect(registros[0].tabla).toBe('viaje_parada');
    expect(ops).toContainEqual(['eq', 'tenant_id', 't1']);
    expect(ops).toContainEqual(['in', 'viaje_id', ['v1', 'v2', 'v3']]);
    expect(ops).toContainEqual(['or', `fin.is.null,fin.gte.${DESDE.toISOString()}`]);
  });

  it('sin viajes no lee; una base sin la 0806 es «ninguna parada»; otro error lanza', async () => {
    expect(await repo.leerParadasRecientes('t1', [], DESDE)).toEqual([]);
    expect(registros).toHaveLength(0);
    respuestas = [{ error: { message: 'relation "viaje_parada" does not exist', code: '42P01' } }];
    expect(await repo.leerParadasRecientes('t1', ['v1'], DESDE)).toEqual([]);
    respuestas = [{ error: { message: 'timeout', code: '57014' } }];
    await expect(repo.leerParadasRecientes('t1', ['v1'], DESDE)).rejects.toThrow(/conductor.parada_recientes/);
  });
});
