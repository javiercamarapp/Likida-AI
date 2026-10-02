import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// /admin/techo-ia — la lógica: validar lo que escribe el superadmin, mostrar el techo que de verdad se
// aplica (el de `topeDiarioDelTenant`), no inventar un gasto cuando no se pudo medir, y que fijar el techo
// pase por la RPC de la base (rango validado allí también), deje bitácora y olvide la caché.
// ═══════════════════════════════════════════════════════════════════════════

const tenants = { data: [] as unknown[], error: null as { message: string } | null };
const rpcs: Array<{ nombre: string; args: Record<string, unknown> }> = [];
let rpcRespuesta: { data: unknown; error: { message: string } | null } = { data: { ok: true, antes: null, despues: 25 }, error: null };
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      Object.assign(b, { select: () => b, not: () => b, order: () => b, limit: () => b, then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(tenants).then(res, rej) });
      return b;
    },
    rpc: (nombre: string, args: Record<string, unknown>) => { rpcs.push({ nombre, args }); return Promise.resolve(rpcRespuesta); },
  }),
}));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: <T,>(p: T) => p }));

const topes = new Map<string, { topeUsd: number; origen: 'tenant' | 'plan' | 'piso' }>();
const olvidar = vi.fn();
vi.mock('@/lib/llm/budget', () => ({
  LLAVE_PRESUPUESTO_LLM_TENANT: 'presupuestoLlmUsdDia',
  olvidarTopesDeTenant: () => olvidar(),
  pisoTopeTenantUsd: () => 5,
  topeDiarioDelTenant: async (id: string) => topes.get(id) ?? { topeUsd: 5, origen: 'piso' },
}));

let proposito: { filas: Array<{ tenantId: string; liquidadoUsd: number; reservadoVivoUsd: number }> } | Error = { filas: [] };
vi.mock('@/lib/admin/consumo', () => ({
  getPresupuestoPorProposito: async () => { if (proposito instanceof Error) throw proposito; return proposito; },
}));

const anotar = vi.fn(async (_e: unknown, _o?: unknown) => true);
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: (e: unknown, o?: unknown) => anotar(e, o) }));

const { validarTechoUsd, declaradoDe, getTechosIa, fijarTechoIa, MAX_FLOTAS_TECHO } = await import('./techo_ia');

const T1 = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  tenants.data = []; tenants.error = null; rpcs.length = 0; topes.clear(); olvidar.mockClear(); anotar.mockClear();
  rpcRespuesta = { data: { ok: true, antes: null, despues: 25 }, error: null };
  proposito = { filas: [] };
});

describe('validarTechoUsd', () => {
  it.each([['25', 25], ['25.5', 25.5], ['$1,000', 1000], ['0.10', 0.1], [' 12 ', 12]])('acepta %s', (crudo, esperado) => {
    expect(validarTechoUsd(crudo)).toEqual({ ok: true, usd: esperado });
  });

  it('vacío o ausente QUITA la declaración (usd null)', () => {
    expect(validarTechoUsd('')).toEqual({ ok: true, usd: null });
    expect(validarTechoUsd('   ')).toEqual({ ok: true, usd: null });
    expect(validarTechoUsd(null)).toEqual({ ok: true, usd: null });
    expect(validarTechoUsd(undefined)).toEqual({ ok: true, usd: null });
  });

  it.each(['0', '0.05', '1000.01', '1e9', '-5', 'abc', '12.345', '5 dólares'])('rechaza %s con un motivo, sin recortarlo en silencio', (crudo) => {
    const r = validarTechoUsd(crudo);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(20);
  });
});

describe('declaradoDe', () => {
  it('solo un número positivo de la llave cuenta', () => {
    expect(declaradoDe({ presupuestoLlmUsdDia: 40 })).toBe(40);
    expect(declaradoDe({ presupuestoLlmUsdDia: '40' })).toBeNull();
    expect(declaradoDe({ presupuestoLlmUsdDia: 0 })).toBeNull();
    expect(declaradoDe({})).toBeNull();
    expect(declaradoDe(null)).toBeNull();
  });
});

describe('getTechosIa', () => {
  it('muestra el techo que APLICA (con su origen) y el gasto de hoy = liquidado + reservado, por flota', async () => {
    tenants.data = [
      { id: 'a', nombre: 'Flota A', config: { presupuestoLlmUsdDia: 40 } },
      { id: 'b', nombre: 'Flota B', config: null },
    ];
    topes.set('a', { topeUsd: 40, origen: 'tenant' });
    topes.set('b', { topeUsd: 138.6, origen: 'plan' });
    proposito = { filas: [
      { tenantId: 'a', liquidadoUsd: 10, reservadoVivoUsd: 2 }, { tenantId: 'a', liquidadoUsd: 6, reservadoVivoUsd: 0 },
    ] };
    const r = await getTechosIa();
    expect(r.filas).toEqual([
      { tenantId: 'a', nombre: 'Flota A', topeUsd: 40, origen: 'tenant', declaradoUsd: 40, usadoHoyUsd: 18, pctUsado: 45 },
      { tenantId: 'b', nombre: 'Flota B', topeUsd: 138.6, origen: 'plan', declaradoUsd: null, usadoHoyUsd: 0, pctUsado: 0 },
    ]);
    expect(r.pisoUsd).toBe(5);
    expect(r.gastoIlegible).toBe(false);
  });

  it('si el gasto no se pudo leer, dice «sin medir» (null) y NO un cero; el techo sí se muestra', async () => {
    tenants.data = [{ id: 'a', nombre: 'Flota A', config: null }];
    proposito = new Error('0244 sin aplicar');
    const r = await getTechosIa();
    expect(r.gastoIlegible).toBe(true);
    expect(r.filas[0]).toMatchObject({ usadoHoyUsd: null, pctUsado: null, topeUsd: 5 });
  });

  it('el porcentaje se topa en 100 aunque el gasto rebase el techo', async () => {
    tenants.data = [{ id: 'a', nombre: 'A', config: null }];
    proposito = { filas: [{ tenantId: 'a', liquidadoUsd: 50, reservadoVivoUsd: 0 }] };
    expect((await getTechosIa()).filas[0].pctUsado).toBe(100);
  });

  it('lista de flotas ilegible LANZA (no se pinta «ninguna flota»)', async () => {
    tenants.error = { message: 'caída' };
    await expect(getTechosIa()).rejects.toThrow('caída');
  });

  it('marca truncado cuando hay más flotas que el tope de la pantalla', async () => {
    tenants.data = Array.from({ length: MAX_FLOTAS_TECHO + 1 }, (_, i) => ({ id: `t${i}`, nombre: `F${i}`, config: null }));
    const r = await getTechosIa();
    expect(r.truncado).toBe(true);
    expect(r.filas).toHaveLength(MAX_FLOTAS_TECHO);
  });
});

describe('fijarTechoIa', () => {
  it('fija por la RPC 0682, olvida la caché y anota la bitácora con antes y después (sin PII)', async () => {
    rpcRespuesta = { data: { ok: true, antes: 10, despues: 25 }, error: null };
    const r = await fijarTechoIa(T1, 25, { id: 'u-1' });
    expect(r).toEqual({ ok: true, antes: 10, despues: 25 });
    expect(rpcs).toEqual([{ nombre: 'fijar_techo_ia_tenant', args: { p_tenant: T1, p_usd: 25 } }]);
    expect(olvidar).toHaveBeenCalledTimes(1);
    expect(anotar).toHaveBeenCalledTimes(1);
    expect(anotar.mock.calls[0][0]).toMatchObject({ tenantId: T1, accion: 'techo_ia.fijado', entidad: 'tenant', actor: { id: 'u-1' }, detalle: { antesUsd: 10, despuesUsd: 25 } });
  });

  it('null quita la declaración y la bitácora lo dice', async () => {
    rpcRespuesta = { data: { ok: true, antes: 25, despues: null }, error: null };
    const r = await fijarTechoIa(T1, null, { id: 'u-1' });
    expect(r).toEqual({ ok: true, antes: 25, despues: null });
    expect(rpcs[0].args.p_usd).toBeNull();
    expect(anotar.mock.calls[0][0]).toMatchObject({ accion: 'techo_ia.quitado' });
  });

  it('un monto fuera de rango NO llega a la base', async () => {
    const r = await fijarTechoIa(T1, 5000, { id: 'u-1' });
    expect(r.ok).toBe(false);
    expect(rpcs).toHaveLength(0);
    expect(anotar).not.toHaveBeenCalled();
  });

  it('un id de flota que no parece uuid NO llega a la base', async () => {
    expect((await fijarTechoIa("x'; drop table tenant;--", 25, { id: 'u' })).ok).toBe(false);
    expect(rpcs).toHaveLength(0);
  });

  it('error de la RPC o flota inexistente: lo dice, no olvida la caché ni anota un cambio que no ocurrió', async () => {
    rpcRespuesta = { data: null, error: { message: 'boom' } };
    expect(await fijarTechoIa(T1, 25, { id: 'u' })).toEqual({ ok: false, error: 'No se pudo guardar el techo: boom' });
    rpcRespuesta = { data: { ok: false, motivo: 'flota_inexistente' }, error: null };
    expect(await fijarTechoIa(T1, 25, { id: 'u' })).toEqual({ ok: false, error: 'Esa flota ya no existe.' });
    expect(olvidar).not.toHaveBeenCalled();
    expect(anotar).not.toHaveBeenCalled();
  });
});
