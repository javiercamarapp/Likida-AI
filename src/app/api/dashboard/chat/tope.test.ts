import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// El tope diario del chat y su lectura de gasto — compartidos por el freno
// del endpoint y el widget de uso del sidebar (16-ago-2026): un solo número.

let filas: Array<{ costo_usd: unknown }> | 'error' = [];
vi.mock('@/lib/likida/pg', () => ({
  conteo: () => ({}),
  traerTodo: async () => {
    if (filas === 'error') throw new Error('base caída');
    return filas;
  },
}));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => ({}) }) }));
vi.mock('@/lib/saludo', () => ({ ahoraMs: () => Date.parse('2026-08-16T18:00:00Z') }));

const { topeDiaUsd, gastoChatHoyUsd } = await import('./tope');

const envAntes = process.env.LIKIDA_CHAT_TOPE_DIA_USD;
beforeEach(() => { filas = []; delete process.env.LIKIDA_CHAT_TOPE_DIA_USD; });
afterEach(() => {
  if (envAntes === undefined) delete process.env.LIKIDA_CHAT_TOPE_DIA_USD;
  else process.env.LIKIDA_CHAT_TOPE_DIA_USD = envAntes;
});

describe('topeDiaUsd', () => {
  it('default $1.00; el env lo ajusta sin deploy', () => {
    expect(topeDiaUsd()).toBe(1.0);
    process.env.LIKIDA_CHAT_TOPE_DIA_USD = '2.5';
    expect(topeDiaUsd()).toBe(2.5);
  });

  it('un env basura o negativo NO apaga el freno — cae al default', () => {
    process.env.LIKIDA_CHAT_TOPE_DIA_USD = 'gratis';
    expect(topeDiaUsd()).toBe(1.0);
    process.env.LIKIDA_CHAT_TOPE_DIA_USD = '-3';
    expect(topeDiaUsd()).toBe(1.0);
  });
});

describe('gastoChatHoyUsd', () => {
  it('suma las filas del día, tolerando costo nulo', async () => {
    filas = [{ costo_usd: 0.1 }, { costo_usd: '0.25' }, { costo_usd: null }];
    expect(await gastoChatHoyUsd('t-1')).toBeCloseTo(0.35);
  });

  it('con la base caída LANZA — el freno falla cerrado y el widget lo dice', async () => {
    filas = 'error';
    await expect(gastoChatHoyUsd('t-1')).rejects.toThrow();
  });
});
