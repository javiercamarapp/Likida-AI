import { describe, it, expect, vi } from 'vitest';

// La regla que gobierna el escritor: registrar JAMÁS lanza. Se prueba con la
// base rota de las dos formas en que puede romperse (error por valor y
// excepción), porque la corrida que anota ya hizo su trabajo real.

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const insert = vi.fn(async (_fila: unknown): Promise<{ error: { message: string } | null }> => ({ error: { message: 'PostgREST 503' } }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => ({ insert } as unknown) }),
}));

const { registrarCorrida, duracionLegible, motivoPausaPorFallos, FALLOS_PARA_PAUSA, SONDEO_PAUSA_MS } = await import('./corridas');
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

describe('motivoPausaPorFallos — la decisión pura del cortacircuitos', () => {
  const AHORA = Date.parse('2026-10-23T12:00:00Z');
  const hace = (h: number) => new Date(AHORA - h * 3_600_000).toISOString();
  const fallo = (h: number, error: string | null = 'x') => ({ estado: 'fallo', inicio: hace(h), error });

  it('el umbral y el sondeo son 3 fallos y 24 h', () => {
    expect(FALLOS_PARA_PAUSA).toBe(3);
    expect(SONDEO_PAUSA_MS).toBe(24 * 3_600_000);
  });

  it('3 fallos seguidos recientes: pausa, citando el último error', () => {
    const m = motivoPausaPorFallos([fallo(1, 'auth: HTTP 401'), fallo(5), fallo(9)], AHORA);
    expect(m).toBe('en pausa: 3 fallos seguidos (último: auth: HTTP 401) — se sondea una vez cada 24 h');
  });

  it('menos de 3 corridas, o un ok/parcial entre las 3 últimas: se despacha', () => {
    expect(motivoPausaPorFallos([fallo(1), fallo(5)], AHORA)).toBeNull();
    expect(motivoPausaPorFallos([fallo(1), { estado: 'parcial', inicio: hace(5), error: null }, fallo(9)], AHORA)).toBeNull();
    expect(motivoPausaPorFallos([{ estado: 'ok', inicio: hace(1), error: null }, fallo(5), fallo(9)], AHORA)).toBeNull();
  });

  it('el sondeo: con el último fallo de hace 24 h o más se despacha; con 23 h sigue la pausa', () => {
    expect(motivoPausaPorFallos([fallo(24), fallo(28), fallo(32)], AHORA)).toBeNull();
    expect(motivoPausaPorFallos([fallo(23), fallo(28), fallo(32)], AHORA)).toMatch(/en pausa/);
  });

  it('sin error registrado lo dice, y recorta el error a 160 caracteres', () => {
    expect(motivoPausaPorFallos([fallo(1, null), fallo(2), fallo(3)], AHORA)).toMatch(/sin motivo registrado/);
    const largo = motivoPausaPorFallos([fallo(1, 'z'.repeat(400)), fallo(2), fallo(3)], AHORA)!;
    expect(largo.length).toBeLessThan(260);
  });
});
