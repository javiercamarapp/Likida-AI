import { describe, it, expect, vi, beforeEach } from 'vitest';

// T-A2-14: el cron barre también el resumen de atípicos y conserva el latido en toda salida.

const registrarLatido = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/admin/salud', () => ({ puertaCron: async () => null, registrarLatido: (...a: unknown[]) => registrarLatido(...a) }));
vi.mock('@/lib/likida/interruptores', () => ({ leerInterruptor: async () => 'encendido' }));
vi.mock('@/lib/likida/peajes/ingesta', () => ({ procesarColaPeajes: async () => ({ tomados: 0, procesados: 0, fallidos: 0, reintentar: 0, claimPerdido: 0 }) }));
vi.mock('@/lib/likida/peajes/pull', () => ({ ejecutarPulls: async () => ({ reclamadas: 0, exitosas: 0, fallidas: 0, recibidos: 0, duplicados: 0, rechazados: 0 }) }));
vi.mock('@/lib/likida/peajes/ingesta_sftp', () => ({ ejecutarSftpPeajes: async () => ({ reclamadas: 0, exitosas: 0, fallidas: 0, recibidos: 0, duplicados: 0, rechazados: 0 }) }));
vi.mock('@/lib/likida/peajes/aviso_oficina', () => ({ reintentarAvisosPeajes: async () => ({ revisados: 0, enviados: 0, pendientes: 0 }) }));
const atipicos = vi.fn(async (..._a: unknown[]): Promise<Record<string, number>> => ({ revisados: 0, enviados: 0, pendientes: 0 }));
vi.mock('@/lib/likida/peajes/aviso_atipicos', () => ({ reintentarAvisosAtipicos: (...a: unknown[]) => atipicos(...a) }));
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: vi.fn() }));
vi.mock('@/lib/observability/sentry', () => ({ codigoDeError: () => 'cod' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { GET } = await import('./route');
const llamar = () => GET(new Request('https://app.likida.ai/api/cron/peajes'));

beforeEach(() => { registrarLatido.mockClear(); atipicos.mockClear(); atipicos.mockResolvedValue({ revisados: 0, enviados: 0, pendientes: 0 }); });

describe('cron peajes: aviso de atípicos', () => {
  it('lo barre en la misma corrida y lo reporta en el cuerpo y el latido', async () => {
    atipicos.mockResolvedValueOnce({ revisados: 1, enviados: 1, pendientes: 0 });
    const r = await llamar();
    expect(atipicos).toHaveBeenCalledWith(5);
    expect(await r.json()).toMatchObject({ corrio: true, avisosAtipicos: { enviados: 1 } });
    expect(registrarLatido).toHaveBeenCalledWith('peajes', 'ok', expect.objectContaining({ avisosAtipicos: expect.anything() }));
  });
  it('un aviso que no sale deja el latido en parcial', async () => {
    atipicos.mockResolvedValueOnce({ revisados: 1, enviados: 0, pendientes: 1 });
    await llamar();
    expect(registrarLatido).toHaveBeenCalledWith('peajes', 'parcial', expect.anything());
  });
  it('un barrido que lanza no tumba la corrida: parcial, con latido', async () => {
    atipicos.mockRejectedValueOnce(new Error('boom'));
    const r = await llamar();
    expect(r.status).toBe(200);
    expect((await r.json() as Record<string, unknown>).avisosAtipicos).toBeNull();
    expect(registrarLatido).toHaveBeenCalledTimes(1);
    expect(registrarLatido).toHaveBeenCalledWith('peajes', 'parcial', expect.anything());
  });
});
