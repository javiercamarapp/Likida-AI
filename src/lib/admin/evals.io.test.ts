import { beforeEach, describe, expect, it, vi } from 'vitest';

let corrida: Record<string, unknown> | null = null;
let casosCount: number | null = 12;
let error: { message: string } | null = null;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const api: Record<string, unknown> = {
        select: () => api, eq: () => api, order: () => api, limit: () => api,
        maybeSingle: async () => ({ data: corrida, error }),
        then: (r: (v: unknown) => unknown) => Promise.resolve({ count: casosCount, error }).then(r),
      };
      return api;
    },
  }),
}));

const { getEstadoEvals } = await import('./evals');

beforeEach(() => { corrida = null; casosCount = 12; error = null; });

describe('getEstadoEvals — el gate del re-examen', () => {
  it('sin corrida JAMÁS corrida = drift (el examen no se ha hecho)', async () => {
    const e = await getEstadoEvals('analista');
    expect(e.driftDePrompt).toBe(true);
    expect(e.ultima).toBeNull();
    expect(e.casosActivos).toBe(12);
  });

  it('la corrida con OTRO hash = drift; con el hash vivo = sin drift', async () => {
    corrida = { id: 'c1', prompt_hash: 'viejo', veredicto: 'paso', iniciada_en: 'x', terminada_en: 'x', casos: 12, costo_usd: 1 };
    const e1 = await getEstadoEvals('analista');
    expect(e1.driftDePrompt).toBe(true);
    corrida = { ...corrida, prompt_hash: e1.hashVivo };
    const e2 = await getEstadoEvals('analista');
    expect(e2.driftDePrompt).toBe(false);
  });

  it('un error de lectura LANZA — el panel enseña su fallo, no un verde', async () => {
    error = { message: 'db down' };
    await expect(getEstadoEvals('analista')).rejects.toThrow('db down');
  });
});
