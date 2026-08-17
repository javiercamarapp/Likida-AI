import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrimerosPasos } from './primeros-pasos';

// El mock encadenable mínimo: cada tabla resuelve su {count, error}.
const porTabla = new Map<string, { count: number | null; error: { message: string } | null }>();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => ({
      select: () => ({
        eq: () => Promise.resolve(porTabla.get(tabla) ?? { count: null, error: { message: 'tabla no mockeada' } }),
      }),
    }),
  }),
}));

describe('getPrimerosPasos — señales reales, jamás inventadas', () => {
  beforeEach(() => porTabla.clear());

  it('cuenta las 4 señales y completa solo con la primera liquidación', async () => {
    porTabla.set('operador', { count: 2, error: null });
    porTabla.set('viaje', { count: 1, error: null });
    porTabla.set('gasto', { count: 0, error: null });
    porTabla.set('liquidacion', { count: 0, error: null });
    const p = await getPrimerosPasos('t1');
    expect(p).toEqual({ operadores: 2, viajes: 1, comprobantes: 0, liquidaciones: 0, completado: false });
  });

  it('con una liquidación queda completado (la guía no se pinta)', async () => {
    for (const t of ['operador', 'viaje', 'gasto']) porTabla.set(t, { count: 3, error: null });
    porTabla.set('liquidacion', { count: 1, error: null });
    expect((await getPrimerosPasos('t1')).completado).toBe(true);
  });

  it('un error de la base LANZA — un 0 inventado diría "no has empezado"', async () => {
    porTabla.set('operador', { count: null, error: { message: 'db down' } });
    for (const t of ['viaje', 'gasto', 'liquidacion']) porTabla.set(t, { count: 0, error: null });
    await expect(getPrimerosPasos('t1')).rejects.toThrow('db down');
  });

  it('count nulo sin error TAMBIÉN lanza — la base no contó, no se inventa', async () => {
    for (const t of ['operador', 'viaje', 'gasto']) porTabla.set(t, { count: 0, error: null });
    porTabla.set('liquidacion', { count: null, error: null });
    await expect(getPrimerosPasos('t1')).rejects.toThrow('no devolvió el conteo');
  });
});
