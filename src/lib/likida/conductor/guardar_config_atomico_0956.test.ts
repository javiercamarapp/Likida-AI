import { describe, it, expect, vi, beforeEach } from 'vitest';

// MX-007 / API04-02 (migración 0956): config + contactos en UNA transacción (RPC), con el camino de varios pasos como respaldo
// cuando la función aún no existe en la base (42883 / PGRST202) — el código nuevo funciona contra la base sin migrar.

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

type Err = { message: string; code?: string } | null;
const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
const upserts: Array<Record<string, unknown>> = [];
const tablas: string[] = [];
let respuestasRpc: Array<{ error: Err }> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return Promise.resolve(respuestasRpc.shift() ?? { error: null });
    },
    from: (t: string) => {
      tablas.push(t);
      const lectura = { data: [], error: null };
      const b: Record<string, unknown> = {
        upsert: (fila: Record<string, unknown>) => { upserts.push(fila); return Promise.resolve({ error: null }); },
        select: () => b, eq: () => b, order: () => b, limit: () => Promise.resolve(lectura),
        insert: () => Promise.resolve({ error: null }),
        delete: () => ({ eq: () => ({ in: () => Promise.resolve({ error: null }) }) }),
        update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
      };
      return b;
    },
  }),
}));

const { guardarConfigConductor } = await import('./repo');
const { CONFIG_CONDUCTOR_DEFAULT } = await import('./config');

const CONTACTOS = [
  { terminalId: null, nivel: 2 as const, nombre: 'Jefe', telefono: '5215500000001' },
  { terminalId: '95600000-0000-4000-8000-0000000000a5', nivel: 1 as const, nombre: 'Patio', telefono: '5215500000002' },
];

beforeEach(() => { rpcs.length = 0; upserts.length = 0; tablas.length = 0; respuestasRpc = []; });

describe('guardarConfigConductor con contactos: una sola transacción (0956)', () => {
  it('llama a UNA RPC con la config completa y los contactos, y no toca las tablas por separado', async () => {
    const r = await guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT, topeDiarioChofer: 8 }, CONTACTOS);
    expect(r).toBe('ok');
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].fn).toBe('guardar_conductor_config_y_contactos');
    expect(rpcs[0].args).toMatchObject({ p_tenant: 't1', p_contactos: CONTACTOS });
    expect(rpcs[0].args.p_config).toMatchObject({ tenant_id: 't1', tope_diario_chofer: 8 });
    expect(upserts).toHaveLength(0);
    expect(tablas).toHaveLength(0);
  });

  it('una terminal ajena (23503 dentro de la RPC) es `terminal_ajena` y NO cae al camino por pasos', async () => {
    respuestasRpc = [{ error: { message: 'insert or update on table "conductor_contacto_trafico" violates foreign key constraint', code: '23503' } }];
    expect(await guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT }, CONTACTOS)).toBe('terminal_ajena');
    expect(rpcs).toHaveLength(1);
    expect(upserts).toHaveLength(0);
  });

  it.each([['42883'], ['PGRST202']])('base SIN migrar (la RPC no existe, %s): cae al camino anterior y guarda igual', async (code) => {
    respuestasRpc = [{ error: { message: 'Could not find the function public.guardar_conductor_config_y_contactos in the schema cache', code } }];
    const r = await guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT, topeDiarioChofer: 9 }, CONTACTOS);
    expect(r).toBe('ok');
    expect(rpcs).toHaveLength(1);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ tenant_id: 't1', tope_diario_chofer: 9 });
    expect(tablas).toContain('conductor_contacto_trafico');
  });

  it('una columna que falta (migración 0604) con valores de partida: reintenta la RPC sin ese grupo', async () => {
    respuestasRpc = [{ error: { message: 'column "avisar_llegada_sin_confirmar" of relation "agente_conductor_config" does not exist', code: '42703' } }];
    const r = await guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT }, CONTACTOS);
    expect(r).toBe('ok');
    expect(rpcs).toHaveLength(2);
    expect(rpcs[1].args.p_config).not.toHaveProperty('avisar_llegada_sin_confirmar');
    expect(rpcs[0].args.p_config).toHaveProperty('avisar_llegada_sin_confirmar');
  });

  it('una columna que falta con un valor pedido distinto NO se calla: dice que falta la migración', async () => {
    respuestasRpc = [{ error: { message: 'column "avisar_llegada_sin_confirmar" of relation "agente_conductor_config" does not exist', code: '42703' } }];
    await expect(guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT, avisarLlegadaSinConfirmar: true }, CONTACTOS)).rejects.toThrow(/0604/);
  });

  it('otro error de la base se lanza tal cual (no se confunde con función ausente)', async () => {
    respuestasRpc = [{ error: { message: 'permission denied for function guardar_conductor_config_y_contactos', code: '42501' } }];
    await expect(guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT }, CONTACTOS)).rejects.toThrow(/permission denied/);
    expect(upserts).toHaveLength(0);
  });

  it('sin contactos (undefined) el upsert de una sola tabla ya es atómico: no usa la RPC', async () => {
    expect(await guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT }, undefined)).toBe('ok');
    expect(rpcs).toHaveLength(0);
    expect(upserts).toHaveLength(1);
  });
});
