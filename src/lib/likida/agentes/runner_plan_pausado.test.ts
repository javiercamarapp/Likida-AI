import { describe, it, expect, vi, beforeEach } from 'vitest';

// F20: una vuelta del runner que actúa por una flota con plan pausado/cancelado/ilegible NO despacha a ningún agente.
vi.unmock('@/lib/saas/salidas_flota');

type R = { data: unknown; error: { message: string } | null };
let plan: R = { data: [{ estado: 'pausada' }], error: null };
const tablasLeidas: string[] = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => {
      tablasLeidas.push(t);
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'is', 'not', 'gte', 'order', 'limit', 'range']) b[m] = () => b;
      const r: R = t === 'suscripcion' ? plan
        : t === 'agente_definicion' ? { data: [{ id: 'redactor', presupuesto_dia_usd: 1, experimental: false }, { id: 'kpi_whatsapp', presupuesto_dia_usd: 0, experimental: false }], error: null }
          : { data: [], error: null };
      b.then = (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(r).then(res, rej);
      return b;
    },
    rpc: async () => ({ data: true, error: null }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', async (i) => ({ ...(await i<typeof import('@/lib/likida/presupuesto')>()), acotada: (q: unknown) => q }));
vi.mock('../interruptores', async (i) => ({ ...(await i<typeof import('../interruptores')>()), estaApagado: async () => false }));
const redactar = vi.fn(async () => ({ piezaId: 'p', asunto: 'x', aviso: null, costoUsd: 0 }));
vi.mock('./redactor', () => ({ redactarCorreoFrio: (...a: unknown[]) => (redactar as unknown as (...x: unknown[]) => unknown)(...a) }));

const { correrRunner } = await import('./runner');
const { olvidarCacheSalidas } = await import('@/lib/saas/salidas_flota');

describe('correrRunner por flota con el plan frenado', () => {
  beforeEach(() => { olvidarCacheSalidas(); tablasLeidas.length = 0; redactar.mockClear(); });

  it.each([
    ['pausada', { data: [{ estado: 'pausada' }], error: null }],
    ['cancelada', { data: [{ estado: 'cancelada' }], error: null }],
    ['ilegible', { data: null, error: { message: 'caída' } }],
  ] as const)('plan %s: todos saltados, ninguna pieza, el Redactor no se llama', async (_n, p) => {
    plan = p;
    const r = await correrRunner(undefined, 'tenant-1', { venceEn: Date.now() + 60_000 });
    expect(r.agentes.length).toBe(2);
    expect(r.agentes.every((a) => a.resultado === 'saltado')).toBe(true);
    expect(r.agentes[0].motivo).toMatch(/no genera salidas automáticas/);
    expect(redactar).not.toHaveBeenCalled();
    expect(tablasLeidas).not.toContain('cola_aprobacion');
  });

  it('la vuelta de PLATAFORMA (sin tenant) no consulta ningún plan', async () => {
    plan = { data: [{ estado: 'pausada' }], error: null };
    await correrRunner('inexistente', undefined, { venceEn: Date.now() + 60_000 });
    expect(tablasLeidas).not.toContain('suscripcion');
  });
});
