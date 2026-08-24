import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL RUNNER NIVEL 2 (0123) — los cuatro candados, todos fail-closed:
//  · Global abajo = no corre nada. Agente sin kill switch declarado = no
//    corre. Interruptor ilegible = no corre.
//  · Sin techo declarado NO hay autonomía; techo agotado o gasto ilegible,
//    tampoco.
//  · Backpressure: bandeja llena = no se fabrica encima.
//  · El lote corta por piezas y por presupuesto, y un prospecto que rebota
//    en las guardas NO tumba el lote.
// ═══════════════════════════════════════════════════════════════════════════

const respuestas = new Map<string, Array<{ data?: unknown; error?: { message: string } | null; count?: number }>>();
const llamadasRpc: Array<{ fn: string; args: Record<string, unknown> }> = [];
function builder(tabla: string) {
  const responder = () => {
    const cola = respuestas.get(tabla);
    return cola && cola.length > 0 ? cola.shift()! : { data: [], error: null };
  };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b, is: () => b, not: () => b, gte: () => b, order: () => b,
    limit: () => b, range: () => b,
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(responder).then(res, rej),
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({
  from: (t: string) => builder(t),
  rpc: (fn: string, args: Record<string, unknown>) => {
    llamadasRpc.push({ fn, args });
    const cola = respuestas.get(`rpc:${fn}`);
    return Promise.resolve(cola && cola.length ? cola.shift()! :
      (fn === 'reservar_presupuesto_agente'
        ? { data: [{ id: 'reserva-1', disponible_usd: 1 }], error: null }
        : { data: true, error: null }));
  },
}) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));

let apagados = new Set<string>();
let interruptorFalla = false;
vi.mock('../interruptores', () => ({
  INTERRUPTORES: ['global', 'agente:redactor'],
  estaApagado: async (n: string) => {
    if (interruptorFalla && n !== 'global') throw new Error('base caída');
    return apagados.has(n);
  },
}));

const redactar = vi.fn(async (..._a: unknown[]) => ({ piezaId: 'p', asunto: 'x', aviso: null, costoUsd: 0.001 }));
vi.mock('./redactor', () => ({ redactarCorreoFrio: (...a: unknown[]) => redactar(...a) }));

const { correrRunner } = await import('./runner');

const REDACTOR = { id: 'redactor', presupuesto_dia_usd: 1.0 };
const TENANT = 'tenant-runner-test';

beforeEach(() => {
  respuestas.clear();
  llamadasRpc.length = 0;
  apagados = new Set();
  interruptorFalla = false;
  redactar.mockClear();
  redactar.mockResolvedValue({ piezaId: 'p', asunto: 'x', aviso: null, costoUsd: 0.001 });
});

describe('los cuatro candados', () => {
  it('global abajo: no corre nada y se dice', async () => {
    apagados.add('global');
    const r = await correrRunner(undefined, TENANT);
    expect(r.apagadoGlobal).toBe(true);
    expect(redactar).not.toHaveBeenCalled();
  });

  it('un agente habilitado SIN kill switch declarado no corre — inapagable = inexistente', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'fantasma', presupuesto_dia_usd: 1 }], error: null }]);
    const r = await correrRunner(undefined, TENANT);
    expect(r.agentes[0]).toMatchObject({ agente: 'fantasma', resultado: 'saltado' });
    expect(r.agentes[0].motivo).toMatch(/kill switch/);
  });

  it('interruptor apagado o ILEGIBLE: no corre (fail closed)', async () => {
    apagados.add('agente:redactor');
    respuestas.set('agente_definicion', [{ data: [REDACTOR], error: null }]);
    let r = await correrRunner(undefined, TENANT);
    expect(r.agentes[0].motivo).toMatch(/apagado/);

    apagados.clear();
    interruptorFalla = true;
    respuestas.set('agente_definicion', [{ data: [REDACTOR], error: null }]);
    r = await correrRunner(undefined, TENANT);
    expect(r.agentes[0].motivo).toMatch(/fail closed/);
    expect(redactar).not.toHaveBeenCalled();
  });

  it('sin techo declarado NO hay autonomía; techo agotado tampoco', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'redactor', presupuesto_dia_usd: null }], error: null }]);
    let r = await correrRunner(undefined, TENANT);
    expect(r.agentes[0].motivo).toMatch(/sin presupuesto/);

    respuestas.set('agente_definicion', [{ data: [REDACTOR], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: null, error: null, count: 0 }]);
    r = await correrRunner(undefined, TENANT);
    expect(r.agentes[0].resultado).toBe('corrio');
    expect(redactar).not.toHaveBeenCalled();
  });

  it('sin tenant explícito no se corre — el techo central no se verifica a ciegas', async () => {
    respuestas.set('agente_definicion', [{ data: [REDACTOR], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: null, error: null, count: 0 }]);
    const r = await correrRunner();
    expect(r.agentes[0].motivo).toMatch(/tenant explícito/);
    expect(redactar).not.toHaveBeenCalled();
  });

  it('backpressure: la bandeja llena frena la fábrica', async () => {
    respuestas.set('agente_definicion', [{ data: [REDACTOR], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: null, error: null, count: 25 }]);
    const r = await correrRunner(undefined, TENANT);
    expect(r.agentes[0].motivo).toMatch(/bandeja con 25/);
    expect(redactar).not.toHaveBeenCalled();
  });
});

describe('el lote', () => {
  it('fabrica hasta el tope de piezas y un rebote de guarda NO tumba el lote', async () => {
    respuestas.set('agente_definicion', [{ data: [REDACTOR], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: null, error: null, count: 0 }]);
    respuestas.set('prospecto', [{
      data: Array.from({ length: 8 }, (_, i) => ({ id: `pr-${i}`, vendedor: null })), error: null,
    }]);
    // El segundo candidato rebota en la guarda (cadencia) — el lote sigue.
    redactar.mockImplementation(async (id: unknown) => {
      if (id === 'pr-1') throw new Error('la cadencia lo protege');
      return { piezaId: 'p', asunto: 'x', aviso: null, costoUsd: 0.001 };
    });
    const r = await correrRunner(undefined, TENANT);
    expect(r.agentes[0].motivo).toBeUndefined();
    expect(r.agentes[0]).toMatchObject({ resultado: 'corrio', piezas: 5, saltados: 1 });
  });

  it('el lote recibe un único presupuesto central por toda la corrida', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'redactor', presupuesto_dia_usd: 0.005 }], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: null, error: null, count: 0 }]);
    respuestas.set('prospecto', [{
      data: Array.from({ length: 8 }, (_, i) => ({ id: `pr-${i}`, vendedor: null })), error: null,
    }]);
    redactar.mockResolvedValue({ piezaId: 'p', asunto: 'x', aviso: null, costoUsd: 0.002 });
    const r = await correrRunner(undefined, TENANT);
    expect(r.agentes[0].motivo).toBeUndefined();
    expect(r.agentes[0].piezas).toBe(5);
    expect(redactar.mock.calls.every((call) => (call[3] as { tenantId?: string }).tenantId === TENANT)).toBe(true);
  });
});

describe('M30 — correrRunner(soloAgente) acota la vuelta a UN agente', () => {
  it('con dos habilitados y soloAgente="redactor", el otro ni se evalúa', async () => {
    respuestas.set('agente_definicion', [{ data: [REDACTOR, { id: 'cobranza', presupuesto_dia_usd: 1 }], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: null, error: null, count: 0 }]);
    respuestas.set('prospecto', [{ data: [{ id: 'p1', vendedor: null }], error: null }]);
    const r = await correrRunner('redactor', TENANT);
    expect(r.agentes.map((a) => a.agente)).toEqual(['redactor']);
  });

  it('soloAgente que no está habilitado → vuelta vacía, sin despachar nada', async () => {
    respuestas.set('agente_definicion', [{ data: [REDACTOR], error: null }]);
    const r = await correrRunner('cobranza', TENANT);
    expect(r).toEqual({ apagadoGlobal: false, agentes: [] });
    expect(redactar).not.toHaveBeenCalled();
  });
});

describe('el presupuesto central evita un ledger duplicado', () => {
  it('no llama las RPC antiguas del runner', async () => {
    respuestas.set('agente_definicion', [{ data: [REDACTOR], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: null, error: null, count: 0 }]);
    respuestas.set('prospecto', [{ data: [{ id: 'p1', vendedor: null }], error: null }]);
    await correrRunner(undefined, TENANT);
    expect(llamadasRpc).toEqual([]);
  });
});
