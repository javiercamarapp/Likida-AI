import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// El tope de la sonda lee EXACTAMENTE la fila que la ruta escribe: fase ocr
// y viaje_id NULL (el OCR de WhatsApp siempre lleva viaje — no se cuenta aquí).

let filas: Array<{ costo_usd: unknown }> | 'error' = [];
const filtros: Array<[string, ...unknown[]]> = [];
vi.mock('@/lib/likida/pg', () => ({
  conteo: () => ({}),
  traerTodo: async (f: (d: number, h: number) => unknown) => {
    f(0, 999);
    if (filas === 'error') throw new Error('base caída');
    return filas;
  },
}));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'gte', 'order', 'range']) {
        b[m] = (...a: unknown[]) => { filtros.push([m, ...a]); return b; };
      }
      return b;
    },
  }),
}));
vi.mock('@/lib/saludo', () => ({ ahoraMs: () => Date.parse('2026-08-16T18:00:00Z') }));

const { topeSondaDiaUsd, gastoSondaHoyUsd } = await import('./tope');

const envAntes = process.env.LIKIDA_INGESTA_TOPE_DIA_USD;
beforeEach(() => { filas = []; filtros.length = 0; delete process.env.LIKIDA_INGESTA_TOPE_DIA_USD; });
afterEach(() => {
  if (envAntes === undefined) delete process.env.LIKIDA_INGESTA_TOPE_DIA_USD;
  else process.env.LIKIDA_INGESTA_TOPE_DIA_USD = envAntes;
});

describe('topeSondaDiaUsd', () => {
  it('default $1.00; el env lo ajusta; basura o negativo NO apagan el freno', () => {
    expect(topeSondaDiaUsd()).toBe(1.0);
    process.env.LIKIDA_INGESTA_TOPE_DIA_USD = '0.5';
    expect(topeSondaDiaUsd()).toBe(0.5);
    process.env.LIKIDA_INGESTA_TOPE_DIA_USD = 'gratis';
    expect(topeSondaDiaUsd()).toBe(1.0);
  });
});

describe('gastoSondaHoyUsd', () => {
  it('suma las filas de fase ocr SIN viaje del tenant, desde el inicio del día MX', async () => {
    filas = [{ costo_usd: 0.01 }, { costo_usd: '0.02' }, { costo_usd: null }];
    expect(await gastoSondaHoyUsd('t-1')).toBeCloseTo(0.03, 6);
    expect(filtros).toContainEqual(['eq', 'tenant_id', 't-1']);
    expect(filtros).toContainEqual(['eq', 'fase', 'ocr']);
    expect(filtros).toContainEqual(['is', 'viaje_id', null]);
    expect(filtros).toContainEqual(['gte', 'created_at', '2026-08-16T06:00:00.000Z']);
  });

  it('base caída: LANZA — la ruta falla cerrado, no inventa $0', async () => {
    filas = 'error';
    await expect(gastoSondaHoyUsd('t-1')).rejects.toThrow('base caída');
  });
});
