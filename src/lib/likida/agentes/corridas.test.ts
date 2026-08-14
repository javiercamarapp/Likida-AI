import { describe, it, expect, vi } from 'vitest';

// La regla que gobierna el escritor: registrar JAMÁS lanza. Se prueba con la
// base rota de las dos formas en que puede romperse (error por valor y
// excepción), porque la corrida que anota ya hizo su trabajo real.

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const insert = vi.fn(async (_fila: unknown): Promise<{ error: { message: string } | null }> => ({ error: { message: 'PostgREST 503' } }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => ({ insert } as unknown) }),
}));

const { registrarCorrida, duracionLegible } = await import('./corridas');
const { logger } = await import('@/lib/logger');

describe('registrarCorrida no puede tumbar la corrida que anota', () => {
  it('un error POR VALOR de la base no lanza, y grita en el log', async () => {
    await expect(registrarCorrida('t-1', 'cobranza', {
      inicio: new Date('2026-08-14T10:00:00Z'), fin: new Date('2026-08-14T10:01:00Z'),
      estado: 'ok', disparo: 'cron',
    })).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('corridas.no_registrada', expect.objectContaining({ agente: 'cobranza' }));
  });

  it('una EXCEPCIÓN de la base tampoco lanza', async () => {
    insert.mockImplementationOnce(async () => { throw new Error('red caída'); });
    await expect(registrarCorrida('t-1', 'peajes', {
      inicio: new Date(), fin: new Date(), estado: 'fallo', disparo: 'manual',
      error: 'No se pudo completar.',
    })).resolves.toBeUndefined();
  });

  it('las tareas sin medir viajan como null, jamás como 0/0', async () => {
    insert.mockClear();
    insert.mockImplementationOnce(async () => ({ error: null }));
    await registrarCorrida('t-1', 'conductores', {
      inicio: new Date(), fin: new Date(), estado: 'ok', disparo: 'cron',
    });
    const fila = insert.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(fila.tareas_hechas).toBeNull();
    expect(fila.tareas_total).toBeNull();
  });
});

describe('duracionLegible', () => {
  it('segundos y minutos como los lee una persona', () => {
    expect(duracionLegible(3_000)).toBe('3 s');
    expect(duracionLegible(125_000)).toBe('2 min 05 s');
  });

  it('sin fin no hay duración: null, no "0 s"', () => {
    expect(duracionLegible(null)).toBeNull();
  });
});
