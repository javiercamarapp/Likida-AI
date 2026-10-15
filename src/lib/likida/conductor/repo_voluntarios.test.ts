import { beforeEach, describe, expect, it, vi } from 'vitest';

// T-A5-03: las primitivas de `repo.ts` para los voluntarios: acotadas por flota y con el error de «falta la 0800» en palabras.
const llamadas: Array<{ op: string; args: unknown[] }> = [];
const respuesta: { data: unknown; error: { code?: string; message: string } | null; count?: number } = { data: null, error: null };

function cadena(nombre: string): unknown {
  const p: Record<string, unknown> = {};
  const fn = (op: string) => (...args: unknown[]) => { llamadas.push({ op: `${nombre}.${op}`, args }); return p; };
  for (const op of ['select', 'eq', 'update', 'or', 'order', 'limit']) p[op] = fn(op);
  p.maybeSingle = async () => { llamadas.push({ op: `${nombre}.maybeSingle`, args: [] }); return respuesta; };
  p.then = (res: (v: unknown) => unknown) => Promise.resolve(respuesta).then(res);
  return p;
}
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => cadena(t),
    rpc: async (f: string, a: unknown) => { llamadas.push({ op: `rpc.${f}`, args: [a] }); return respuesta; },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { buscarCandidatosVoluntarios, leerOperadorPiloto, leerTopeVoluntarios, marcarVoluntario, retirarVoluntario } from './repo';

describe('repo: voluntarios del piloto', () => {
  beforeEach(() => { llamadas.length = 0; respuesta.data = null; respuesta.error = null; respuesta.count = undefined; });

  it('retirarVoluntario llama a la función atómica de la 0800 con la flota y el operador, y devuelve cuántos viajes soltó', async () => {
    respuesta.data = 3;
    expect(await retirarVoluntario('t1', 'op1')).toBe(3);
    expect(llamadas).toEqual([{ op: 'rpc.retirar_voluntario', args: [{ p_tenant: 't1', p_operador: 'op1' }] }]);
  });

  it('marcarVoluntario filtra por flota, operador, activo y «aún no voluntario», y dice si cambió algo', async () => {
    respuesta.data = [{ id: 'op1' }];
    expect(await marcarVoluntario('t1', 'op1', 'u1', new Date('2026-10-14T12:00:00Z'))).toBe(true);
    const eqs = llamadas.filter((l) => l.op === 'operador.eq').map((l) => l.args);
    expect(eqs).toEqual([['tenant_id', 't1'], ['id', 'op1'], ['activo', true], ['agente_voluntario', false]]);
    expect(llamadas.find((l) => l.op === 'operador.update')!.args[0]).toMatchObject({ agente_voluntario: true, agente_voluntario_por: 'u1', agente_voluntario_desde: '2026-10-14T12:00:00.000Z' });
    respuesta.data = [];
    expect(await marcarVoluntario('t1', 'op1', null, new Date())).toBe(false);
  });

  it('las lecturas acotan por flota (otra flota no se ve)', async () => {
    respuesta.data = null;
    expect(await leerOperadorPiloto('t1', 'op1')).toBeNull();
    expect(llamadas.filter((l) => l.op === 'operador.eq').map((l) => l.args[0])).toContain('tenant_id');
    llamadas.length = 0;
    respuesta.data = [];
    await buscarCandidatosVoluntarios('t1', 'Juan %,(x)');
    expect(llamadas.find((l) => l.op === 'operador.eq')!.args).toEqual(['tenant_id', 't1']);
    // El texto de búsqueda no puede meter operadores de PostgREST (comas, paréntesis, comodines).
    expect(String(llamadas.find((l) => l.op === 'operador.or')!.args[0])).toBe('nombre.ilike.%Juan x%,telefono.ilike.%Juan x%');
  });

  it('el tope: 6 si la flota aún no tiene fila; el valor guardado si lo tiene', async () => {
    respuesta.data = null;
    expect(await leerTopeVoluntarios('t1')).toBe(6);
    respuesta.data = { piloto_max_voluntarios: 4 };
    expect(await leerTopeVoluntarios('t1')).toBe(4);
  });

  it('base sin la 0800: el error lo dice en palabras', async () => {
    respuesta.error = { code: '42703', message: 'column operador.agente_voluntario does not exist' };
    await expect(listarOCuenta()).rejects.toThrow('necesita la migración 0800');
    respuesta.error = { code: 'PGRST202', message: 'Could not find the function public.retirar_voluntario' };
    await expect(retirarVoluntario('t1', 'op1')).rejects.toThrow('necesita la migración 0800');
  });
});

async function listarOCuenta() { return leerOperadorPiloto('t1', 'op1'); }
