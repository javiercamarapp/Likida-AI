import { beforeEach, describe, expect, it, vi } from 'vitest';

// ═══ El ADAPTADOR de tabla (Fase B, 0131) contra un mock encadenable ═══════
// El contrato (un solo uso, actor, TTL, doble) se prueba sobre el almacén de
// memoria en copiloto-intents.test.ts; aquí se fija la FORMA de las llamadas
// a la base: el WHERE del UPDATE es la atomicidad, y sin estas guardas dos
// POSTs simultáneos ejecutarían dos veces.

interface Llamada { op: string; tabla: string; valores?: unknown; filtros: Array<[string, string, unknown]> }
const llamadas: Llamada[] = [];
let filaCargada: Record<string, unknown> | null = null;
let filasAfectadas = 1;

function builder(tabla: string, op: string, valores?: unknown) {
  const ll: Llamada = { op, tabla, valores, filtros: [] };
  llamadas.push(ll);
  const api = {
    eq: (c: string, v: unknown) => { ll.filtros.push(['eq', c, v]); return api; },
    is: (c: string, v: unknown) => { ll.filtros.push(['is', c, v]); return api; },
    gt: (c: string, v: unknown) => { ll.filtros.push(['gt', c, v]); return api; },
    lt: (c: string, v: unknown) => { ll.filtros.push(['lt', c, v]); return api; },
    select: () => Promise.resolve({ data: Array.from({ length: filasAfectadas }, () => ({ id: 'x' })), error: null }),
    maybeSingle: () => Promise.resolve({ data: filaCargada, error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
  };
  return api;
}
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => ({
      insert: (_v: unknown) => ({ then: (res: (x: unknown) => unknown) => Promise.resolve({ error: null }).then(res) }),
      select: () => builder(tabla, 'select'),
      update: (v: unknown) => builder(tabla, 'update', v),
      delete: () => builder(tabla, 'delete'),
    }),
  }),
}));

const { crearIntent, reclamarIntent, hashArgsAccion } = await import('./copiloto-intents');

const T0 = 1_700_000_000_000;
const HASH = hashArgsAccion('apagar_agente', 'agente:cobranza');
const FILA_VIVA = {
  id: 'i-1', actor_id: 'u-javier', accion: 'apagar_agente', args_hash: HASH,
  gateo: 'confirma', motivo: null, armado: false, usado_en: null,
  creado_en: new Date(T0).toISOString(), expira_en: new Date(T0 + 120_000).toISOString(),
};

describe('el adaptador de tabla de intents (0131)', () => {
  beforeEach(() => { llamadas.length = 0; filaCargada = null; filasAfectadas = 1; });

  it('crearIntent inserta en admin_action_intent (y el barrido corre best-effort)', async () => {
    const i = await crearIntent({ actorId: 'u', accion: 'a', objetivo: 'o', gateo: 'confirma', ahoraMs: T0 });
    expect(i.usado).toBe(false);
    // el barrido usa delete con lt sobre expira_en
    const barrido = llamadas.find((l) => l.op === 'delete');
    expect(barrido?.filtros.some(([f, c]) => f === 'lt' && c === 'expira_en')).toBe(true);
  });

  it("gastar es UN UPDATE con las guardas en el WHERE: usado_en null + expira_en > ahora", async () => {
    filaCargada = { ...FILA_VIVA };
    const r = await reclamarIntent({ intentId: 'i-1', actorId: 'u-javier', argsHash: HASH, ahoraMs: T0 + 1 });
    expect(r).toMatchObject({ ok: true, fase: 'ejecutar' });
    const up = llamadas.find((l) => l.op === 'update');
    expect(up?.filtros).toEqual(expect.arrayContaining([
      ['eq', 'id', 'i-1'], ['is', 'usado_en', null],
    ]));
    expect(up?.filtros.some(([f, c]) => f === 'gt' && c === 'expira_en')).toBe(true);
  });

  it('si el UPDATE no casó fila (carrera perdida), el reclamo es INVALIDO aunque la lectura la vio viva', async () => {
    filaCargada = { ...FILA_VIVA };
    filasAfectadas = 0; // otro POST ganó entre la lectura y el UPDATE
    const r = await reclamarIntent({ intentId: 'i-1', actorId: 'u-javier', argsHash: HASH, ahoraMs: T0 + 1 });
    expect(r).toMatchObject({ ok: false, codigo: 'invalido' });
  });

  it("el segundo POST de un 'doble' exige armado=true EN el WHERE", async () => {
    filaCargada = { ...FILA_VIVA, gateo: 'doble', armado: true, motivo: 'porque sí' };
    const r = await reclamarIntent({ intentId: 'i-1', actorId: 'u-javier', argsHash: HASH, motivo: 'x', ahoraMs: T0 + 1 });
    expect(r).toMatchObject({ ok: true, fase: 'ejecutar', motivo: 'porque sí' });
    const up = llamadas.find((l) => l.op === 'update');
    expect(up?.filtros).toEqual(expect.arrayContaining([['eq', 'armado', true]]));
  });
});
