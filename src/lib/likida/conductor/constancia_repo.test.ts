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
const { armarConstancia } = await import('./constancia');
const filtros = (r: Registro) => r.ops.filter(([o]) => ['eq', 'in', 'gte', 'lt'].includes(o)).map(([o, ...a]) => `${o}:${a.map(String).join(',')}`);
const DESDE = new Date('2026-10-01T06:00:00.000Z');
const HASTA = new Date('2026-10-08T06:00:00.000Z');

beforeEach(() => { registros.length = 0; respuestas = []; });

describe('leerDatosConstancia (T-A5-67) — lectura acotada por flota y periodo', () => {
  it('lee los viajes del periodo y SUS hitos, siempre filtrando por tenant, y arma la constancia', async () => {
    respuestas = [
      { data: [{ id: 'v1', folio: 'F-1', estatus: 'liquidado', operador_id: 'o1', created_at: '2026-10-03T12:00:00.000Z', operador: { nombre: 'Operador Uno' } }], error: null },
      { data: [{ id: 'h1', tenant_id: 't1', viaje_id: 'v1', tipo: 'llegada_carga', estado: 'recibido', ciclo: 1, fuente: 'boton', mensaje_en: '2026-10-03T15:30:00.000Z', recibido_en: '2026-10-03T15:30:01.000Z' }], error: null },
    ];
    const d = await repo.leerDatosConstancia('t1', DESDE, HASTA);
    expect(registros.map((r) => r.tabla)).toEqual(['viaje', 'viaje_hito']);
    expect(filtros(registros[0])).toEqual(expect.arrayContaining(['eq:tenant_id,t1', `gte:created_at,${DESDE.toISOString()}`, `lt:created_at,${HASTA.toISOString()}`]));
    expect(filtros(registros[1])).toEqual(expect.arrayContaining(['eq:tenant_id,t1', 'in:viaje_id,v1']));
    expect(d.viajes[0]).toMatchObject({ id: 'v1', operadorNombre: 'Operador Uno', estatus: 'liquidado' });
    const c = armarConstancia({ tenantId: 't1', periodo: { desde: DESDE.toISOString(), hasta: HASTA.toISOString() }, viajes: d.viajes, hitos: d.hitos });
    expect(c.operadores[0]).toMatchObject({ operadorNombre: 'Operador Uno', reportados: 1, esperados: 1, estado: 'completo' });
    expect(c.operadores[0].reportes[0].origen).toBe('botón');
  });

  it('periodo sin viajes: no consulta hitos y devuelve vacío', async () => {
    const d = await repo.leerDatosConstancia('t1', DESDE, HASTA);
    expect(registros.map((r) => r.tabla)).toEqual(['viaje']);
    expect(d).toEqual({ viajes: [], hitos: [], hayMas: false });
  });

  it('un error de la base se propaga (la página lo dice; no se pinta un vacío que parezca dato)', async () => {
    respuestas = [{ data: null, error: { message: 'boom' } }];
    await expect(repo.leerDatosConstancia('t1', DESDE, HASTA)).rejects.toThrow();
  });
});
