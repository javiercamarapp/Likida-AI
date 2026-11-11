import { describe, it, expect, vi, beforeEach } from 'vitest';

const respuestas = new Map<string, unknown[]>();
function builder(tabla: string) {
  const b: Record<string, unknown> = {};
  const resp = () => { const c = respuestas.get(tabla); return c && c.length ? c.shift() : { data: [], error: null }; };
  Object.assign(b, { select: () => b, eq: () => b, order: () => b, limit: () => b,
    then: (a: (x: unknown) => unknown, c: (e: unknown) => unknown) => Promise.resolve().then(resp).then(a, c) });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
let latido: unknown = null; let latidoFalla = false;
vi.mock('./salud', () => ({ leerLatido: async () => { if (latidoFalla) throw new Error('x'); return latido; } }));

const m = await import('./agentes-parados');
const AHORA = Date.parse('2026-11-10T12:00:00Z');
const hace = (h: number) => new Date(AHORA - h * 3_600_000).toISOString();

beforeEach(() => { respuestas.clear(); latido = null; latidoFalla = false; });

describe('armarParados (pura)', () => {
  it('omite los que corrieron dentro del umbral y ordena: nunca corridos, luego los más viejos', () => {
    const r = m.armarParados(
      [{ id: 'a', nombre: 'A' }, { id: 'b', nombre: 'B' }, { id: 'c', nombre: 'C' }, { id: 'd', nombre: 'D' }],
      new Map([['a', hace(10)], ['b', hace(24 * 69)], ['c', hace(100)]]),
      [{ agente: 'b', causa: 'contrapresion_bandeja', motivo: 'bandeja sin atender' }],
      AHORA,
    );
    expect(r.map((x) => x.agente)).toEqual(['d', 'b', 'c']);
    expect(r[0]).toMatchObject({ ultimaCorrida: null, horasSinCorrer: null, motivo: null });
    expect(r[1]).toMatchObject({ motivo: 'bandeja sin atender', causa: 'contrapresion_bandeja' });
  });
  it('saltosDeLatido tolera detalles raros', () => {
    expect(m.saltosDeLatido(null)).toEqual([]);
    expect(m.saltosDeLatido({ saltados: 'x' })).toEqual([]);
    expect(m.saltosDeLatido({ saltados: [{ agente: 'a', motivo: 'm' }, 5] })).toEqual([{ agente: 'a', causa: null, motivo: 'm' }]);
  });
});

describe('getAgentesParados', () => {
  it('une catálogo, corridas y motivos del latido del runner', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'a', nombre: 'A' }], error: null }]);
    respuestas.set('agente_corrida', [{ data: [{ inicio: hace(24 * 69) }], error: null }]);
    latido = { ultimoLatido: hace(1), estado: 'parcial', detalle: { saltados: [{ agente: 'a', causa: 'contrapresion_bandeja', motivo: 'bandeja sin atender' }] } };
    const r = await m.getAgentesParados(AHORA);
    expect(r?.habilitados).toBe(1);
    expect(r?.parados[0]).toMatchObject({ agente: 'a', horasSinCorrer: 1656, causa: 'contrapresion_bandeja' });
  });
  it('si el latido no se lee, la lista sale con motivo null (no inventado)', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'a', nombre: null }], error: null }]);
    latidoFalla = true;
    const r = await m.getAgentesParados(AHORA);
    expect(r?.parados[0]).toMatchObject({ agente: 'a', motivo: null });
    expect(r?.latidoDelRunner).toBeNull();
  });
  it('si el catálogo no se lee: null, no lista vacía', async () => {
    respuestas.set('agente_definicion', [{ data: null, error: { message: 'caída' } }]);
    expect(await m.getAgentesParados(AHORA)).toBeNull();
  });
  it('si falla la lectura de corridas: null', async () => {
    respuestas.set('agente_definicion', [{ data: [{ id: 'a', nombre: 'A' }], error: null }]);
    respuestas.set('agente_corrida', [{ data: null, error: { message: 'caída' } }]);
    expect(await m.getAgentesParados(AHORA)).toBeNull();
  });
});
