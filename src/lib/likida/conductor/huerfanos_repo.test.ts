import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

type Respuesta = { data?: unknown; error?: { message: string; code?: string } | null };
interface Registro { tabla: string; ops: Array<[string, ...unknown[]]> }
const registros: Registro[] = [];
const rpcs: Array<{ nombre: string; args: unknown }> = [];
let respuestas: Respuesta[] = [];
/** Respuesta por tabla (se sirve una sola vez; después, vacío): para lecturas paginadas con `traerTodo`. */
let porTabla: Record<string, Respuesta> = {};

/** Un constructor de consultas de mentira: registra cada llamada encadenada y responde con lo que se haya encolado. */
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const reg: Registro = { tabla, ops: [] };
      registros.push(reg);
      const proxy: unknown = new Proxy({}, {
        get: (_t, prop: string) => {
          if (prop === 'then') {
            return (res: (r: Respuesta) => unknown) => {
              if (porTabla[tabla]) { const r = porTabla[tabla]; delete porTabla[tabla]; return res(r); }
              return res(respuestas.shift() ?? { data: [], error: null });
            };
          }
          return (...args: unknown[]) => { if (prop !== 'abortSignal') reg.ops.push([prop, ...args]); return proxy; };
        },
      });
      return proxy;
    },
    rpc: (nombre: string, args: unknown) => {
      rpcs.push({ nombre, args });
      const constructor: Record<string, unknown> = {
        abortSignal: () => constructor,
        then: (res: (r: Respuesta) => unknown) => res(respuestas.shift() ?? { data: 0, error: null }),
      };
      return constructor;
    },
  }),
}));

const repo = await import('./repo');
const trabajo = await import('./trabajo');
const AHORA = new Date('2026-10-02T14:30:00.000Z');
const filtros = (r: Registro) => r.ops.filter(([o]) => ['eq', 'is', 'lt', 'in', 'gte', 'not'].includes(o)).map(([o, ...a]) => `${o}:${a.map(String).join(',')}`);
const U = [{ tenantId: 't1', unidadId: 'u1' }];

beforeEach(() => { registros.length = 0; rpcs.length = 0; respuestas = []; porTabla = {}; });

describe('leerFlotasConHuerfanos — la casilla nace apagada', () => {
  it('lee solo las flotas con el Conductor activo Y la casilla encendida', async () => {
    respuestas = [{ data: [{ tenant_id: 't1' }, { tenant_id: 't2' }], error: null }];
    expect(await repo.leerFlotasConHuerfanos()).toEqual(['t1', 't2']);
    expect(registros[0].tabla).toBe('agente_conductor_config');
    expect(filtros(registros[0])).toEqual(expect.arrayContaining(['eq:activo,true', 'eq:registrar_geocerca_huerfana,true']));
  });

  it('una base SIN la 0820 se lee como «ninguna flota»: el barrido no hace nada (no es un fallo)', async () => {
    respuestas = [{ error: { message: 'column agente_conductor_config.registrar_geocerca_huerfana does not exist', code: '42703' } }];
    expect(await repo.leerFlotasConHuerfanos()).toEqual([]);
  });

  it('otro error de la base SÍ lanza (no se opera a ciegas)', async () => {
    respuestas = [{ error: { message: 'conexión rota', code: '08006' } }];
    await expect(repo.leerFlotasConHuerfanos()).rejects.toThrow(/conexión rota/);
  });
});

describe('guardarEventosHuerfanos — persistir sin duplicar y sin coordenadas', () => {
  const E = { tenantId: 't1', unidadId: 'u1', geocercaId: 's1', tipo: 'entrada' as const, en: new Date('2026-10-02T14:05:00.000Z'), distanciaM: 42, despachoRef: 'D-1' };

  it('inserta con upsert que IGNORA duplicados (misma flota, unidad, sitio, sentido y hora) y devuelve cuántos eran nuevos', async () => {
    respuestas = [{ data: [{ id: 'a' }], error: null }];
    expect(await repo.guardarEventosHuerfanos([E, { ...E, tipo: 'salida' }])).toBe(1);
    expect(registros[0].tabla).toBe('evento_geocerca_huerfano');
    const upsert = registros[0].ops.find(([o]) => o === 'upsert')!;
    expect(upsert[2]).toMatchObject({ onConflict: 'tenant_id,unidad_id,geocerca_id,tipo,en', ignoreDuplicates: true });
    const filas = upsert[1] as Array<Record<string, unknown>>;
    expect(filas[0]).toMatchObject({ tenant_id: 't1', unidad_id: 'u1', geocerca_id: 's1', tipo: 'entrada', en: E.en.toISOString(), distancia_m: 42, despacho_ref: 'D-1' });
    expect(Object.keys(filas[0]).some((k) => /lat|lng/.test(k))).toBe(false);
  });

  it('sin eventos no toca la base; un error de la base LANZA (no finge que guardó)', async () => {
    expect(await repo.guardarEventosHuerfanos([])).toBe(0);
    expect(registros).toHaveLength(0);
    respuestas = [{ error: { message: 'conexión rota' } }];
    await expect(repo.guardarEventosHuerfanos([E])).rejects.toThrow(/conexión rota/);
  });
});

describe('leer los huérfanos pendientes y los últimos cruces — siempre acotados por flota', () => {
  it('pendientes: solo los NO reconciliados de la flota y unidades pedidas, de la retención en adelante, del más viejo al más nuevo', async () => {
    respuestas = [{ data: [
      { id: 'e1', tenant_id: 't1', unidad_id: 'u1', geocerca_id: 's1', tipo: 'entrada', en: '2026-10-02T12:00:00.000Z', distancia_m: 30, despacho_ref: 'D-1' },
      { id: 'e2', tenant_id: 't1', unidad_id: 'uOtra', geocerca_id: 's1', tipo: 'salida', en: '2026-10-02T13:00:00.000Z', distancia_m: null, despacho_ref: null },
    ], error: null }];
    const r = await repo.leerEventosHuerfanosPendientes(U, 500, AHORA);
    expect(r).toEqual([{ id: 'e1', tenantId: 't1', unidadId: 'u1', geocercaId: 's1', tipo: 'entrada', en: new Date('2026-10-02T12:00:00.000Z'), distanciaM: 30, despachoRef: 'D-1' }]);
    expect(filtros(registros[0])).toEqual(expect.arrayContaining(['in:tenant_id,t1', 'in:unidad_id,u1', 'is:reconciliado_en,null', `gte:en,${new Date(AHORA.getTime() - 30 * 86_400_000).toISOString()}`]));
  });

  it('pendientes: sin unidades no consulta; una base sin la 0820 = ninguno', async () => {
    expect(await repo.leerEventosHuerfanosPendientes([], 10, AHORA)).toEqual([]);
    expect(registros).toHaveLength(0);
    respuestas = [{ error: { message: 'relation "public.evento_geocerca_huerfano" does not exist', code: '42P01' } }];
    expect(await repo.leerEventosHuerfanosPendientes(U, 10, AHORA)).toEqual([]);
  });

  it('últimos cruces: el más reciente por sitio manda (lo primero leído, que viene del más nuevo al más viejo)', async () => {
    respuestas = [{ data: [
      { tenant_id: 't1', unidad_id: 'u1', geocerca_id: 's1', tipo: 'salida', en: '2026-10-02T13:00:00.000Z' },
      { tenant_id: 't1', unidad_id: 'u1', geocerca_id: 's1', tipo: 'entrada', en: '2026-10-02T12:00:00.000Z' },
      { tenant_id: 't1', unidad_id: 'u1', geocerca_id: 's2', tipo: 'entrada', en: '2026-10-02T11:00:00.000Z' },
      { tenant_id: 't9', unidad_id: 'u1', geocerca_id: 's1', tipo: 'entrada', en: '2026-10-02T10:00:00.000Z' },
    ], error: null }];
    const m = await repo.leerUltimosCrucesHuerfanos(U, AHORA);
    expect(m.get('t1|u1')?.get('s1')).toEqual({ tipo: 'salida', en: new Date('2026-10-02T13:00:00.000Z') });
    expect(m.get('t1|u1')?.get('s2')?.tipo).toBe('entrada');
    expect(m.has('t9|u1')).toBe(false);
    expect(filtros(registros[0])).toEqual(expect.arrayContaining(['in:tenant_id,t1', 'in:unidad_id,u1']));
  });

  it('marcar reconciliado: solo los de esa flota que siguen sin reconciliar (marcar dos veces es inocuo)', async () => {
    await repo.marcarEventosHuerfanosReconciliados('t1', ['e1', 'e2'], 'v1', AHORA);
    expect(registros[0].ops.find(([o]) => o === 'update')![1]).toEqual({ reconciliado_en: AHORA.toISOString(), viaje_id: 'v1' });
    expect(filtros(registros[0])).toEqual(expect.arrayContaining(['eq:tenant_id,t1', 'in:id,e1,e2', 'is:reconciliado_en,null']));
    registros.length = 0;
    await repo.marcarEventosHuerfanosReconciliados('t1', [], 'v1', AHORA);
    expect(registros).toHaveLength(0);
    respuestas = [{ error: { message: 'conexión rota' } }];
    await expect(repo.marcarEventosHuerfanosReconciliados('t1', ['e1'], 'v1', AHORA)).rejects.toThrow(/conexión rota/);
  });
});

describe('leerUnidadesSinViajeAbierto — solo las unidades que pueden dejar un cruce huérfano', () => {
  it('quita las unidades con un viaje abierto y aceptado, anclado a las flotas pedidas', async () => {
    porTabla = {
      unidad: { data: [{ id: 'u1', tenant_id: 't1' }, { id: 'u2', tenant_id: 't1' }, { id: 'u3', tenant_id: 't1' }], error: null },
      viaje: { data: [{ tenant_id: 't1', unidad_id: 'u2' }], error: null },
    };
    const r = await trabajo.leerUnidadesSinViajeAbierto(['t1'], 400, AHORA);
    expect(r).toEqual([{ tenantId: 't1', unidadId: 'u1' }, { tenantId: 't1', unidadId: 'u3' }]);
    const deUnidad = registros.find((x) => x.tabla === 'unidad')!;
    const deViaje = registros.find((x) => x.tabla === 'viaje')!;
    expect(filtros(deUnidad)).toEqual(expect.arrayContaining(['in:tenant_id,t1', 'eq:activo,true']));
    expect(filtros(deViaje)).toEqual(expect.arrayContaining(['in:tenant_id,t1', 'eq:estatus,abierto', 'not:aceptado_en,is,null']));
  });

  it('respeta el tope y sin flotas no consulta', async () => {
    porTabla = { unidad: { data: [{ id: 'u1', tenant_id: 't1' }, { id: 'u2', tenant_id: 't1' }], error: null } };
    expect(await trabajo.leerUnidadesSinViajeAbierto(['t1'], 1, AHORA)).toHaveLength(1);
    registros.length = 0;
    expect(await trabajo.leerUnidadesSinViajeAbierto([], 10, AHORA)).toEqual([]);
    expect(registros).toHaveLength(0);
  });
});

describe('el mantenimiento diario purga los huérfanos vencidos (retención de 30 días)', () => {
  it('llama a purgar_eventos_geocerca_huerfanos con 30 días y reporta cuántos borró', async () => {
    respuestas = [{ data: 1, error: null }, { data: 2, error: null }, { data: 3, error: null }, { data: 4, error: null }];
    const r = await repo.correrMantenimientoConductor();
    expect(rpcs.find((x) => x.nombre === 'purgar_eventos_geocerca_huerfanos')?.args).toEqual({ p_dias: 30 });
    expect(r.purgar_eventos_geocerca_huerfanos).toBe(4);
  });

  it('una base sin la 0820 (la función no existe) no es un fallo: 0', async () => {
    respuestas = [{ data: 1, error: null }, { data: 2, error: null }, { data: 3, error: null }, { error: { message: 'Could not find the function public.purgar_eventos_geocerca_huerfanos(p_dias) in the schema cache', code: 'PGRST202' } }];
    const r = await repo.correrMantenimientoConductor();
    expect(r.purgar_eventos_geocerca_huerfanos).toBe(0);
  });

  it('otro error de la base queda a la vista, sin esconderse', async () => {
    respuestas = [{ data: 1, error: null }, { data: 2, error: null }, { data: 3, error: null }, { error: { message: 'conexión rota', code: '08006' } }];
    const r = await repo.correrMantenimientoConductor();
    expect(String(r.purgar_eventos_geocerca_huerfanos)).toContain('conexión rota');
  });
});
