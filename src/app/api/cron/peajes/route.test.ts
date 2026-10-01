import { describe, it, expect, vi, beforeEach } from 'vitest';

// El cron de peajes: su CONTRATO operativo, el mismo de sus hermanos — secreto
// o 401/500, palancas global y del agente respetadas (y falla CERRADO si no se
// pueden leer), y un latido en TODO camino de salida.

let autorizado: 'si' | 'no' | 'sin_secreto' = 'si';
const registrarLatido = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/admin/salud', () => ({
  puertaCron: async (_c: string, _r: Request) => {
    if (autorizado === 'sin_secreto') return new Response(JSON.stringify({ error: 'CRON_SECRET' }), { status: 500 });
    if (autorizado === 'no') return new Response(null, { status: 401 });
    return null;
  },
  registrarLatido: (...a: unknown[]) => registrarLatido(...a),
}));
let interruptores: Record<string, 'encendido' | 'apagado' | 'ilegible'> = {};
vi.mock('@/lib/likida/interruptores', () => ({ leerInterruptor: async (id: string) => interruptores[id] ?? 'encendido' }));
const procesar = vi.fn(async (..._a: unknown[]): Promise<Record<string, number>> => ({ tomados: 2, procesados: 2, fallidos: 0, reintentar: 0, claimPerdido: 0 }));
vi.mock('@/lib/likida/peajes/ingesta', () => ({ procesarColaPeajes: (...a: unknown[]) => procesar(...a) }));
const alertarOperador = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...a) }));
vi.mock('@/lib/observability/sentry', () => ({ codigoDeError: () => 'cod' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { GET } = await import('./route');
const llamar = () => GET(new Request('https://app.likida.ai/api/cron/peajes'));
const j = async (r: Response) => (await r.json()) as Record<string, unknown>;

beforeEach(() => {
  autorizado = 'si'; interruptores = {};
  procesar.mockClear(); registrarLatido.mockClear(); alertarOperador.mockClear();
  procesar.mockResolvedValue({ tomados: 2, procesados: 2, fallidos: 0, reintentar: 0, claimPerdido: 0 });
});

describe('la puerta', () => {
  it('sin secreto o con secreto malo no corre nada', async () => {
    autorizado = 'no';
    expect((await llamar()).status).toBe(401);
    autorizado = 'sin_secreto';
    expect((await llamar()).status).toBe(500);
    expect(procesar).not.toHaveBeenCalled();
  });
});

describe('las palancas', () => {
  it.each(['global', 'agente:peajes'])('%s apagada → no corre, 200 con `saltado` y latido `saltado`', async (id) => {
    interruptores = { [id]: 'apagado' };
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(await j(r)).toMatchObject({ corrio: false, saltado: expect.stringContaining(id) });
    expect(procesar).not.toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('peajes', 'saltado', { interruptor: id });
  });

  it.each(['global', 'agente:peajes'])('%s ILEGIBLE → falla CERRADO (500) con latido `fallo`', async (id) => {
    interruptores = { [id]: 'ilegible' };
    const r = await llamar();
    expect(r.status).toBe(500);
    expect(await j(r)).toMatchObject({ corrio: false, codigo: 'interruptor_ilegible', interruptor: id });
    expect(procesar).not.toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('peajes', 'fallo', expect.objectContaining({ codigo: 'interruptor_ilegible' }));
  });
});

describe('la corrida', () => {
  it('todo bien → latido ok con el resumen', async () => {
    const r = await llamar();
    expect(await j(r)).toMatchObject({ corrio: true, tomados: 2, procesados: 2 });
    expect(registrarLatido).toHaveBeenCalledWith('peajes', 'ok', expect.objectContaining({ procesados: 2 }));
    expect(procesar).toHaveBeenCalledWith(expect.objectContaining({ limite: 3, venceEn: expect.any(Number) }));
  });

  it.each([{ fallidos: 1 }, { reintentar: 1 }, { claimPerdido: 1 }])('trabajo que no terminó bien (%o) → latido `parcial`, ni ok ni fallo', async (extra) => {
    procesar.mockResolvedValue({ tomados: 2, procesados: 1, fallidos: 0, reintentar: 0, claimPerdido: 0, ...extra });
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(registrarLatido).toHaveBeenCalledWith('peajes', 'parcial', expect.any(Object));
  });

  it('si truena → 500, alerta al operador y latido de fallo', async () => {
    procesar.mockRejectedValue(new Error('rpc caído'));
    const r = await llamar();
    expect(r.status).toBe(500);
    expect(await j(r)).toMatchObject({ corrio: false, error: 'rpc caído', codigo: 'cod' });
    expect(alertarOperador).toHaveBeenCalledWith('cron.peajes', expect.objectContaining({ error: 'rpc caído' }));
    expect(registrarLatido).toHaveBeenCalledWith('peajes', 'fallo', expect.objectContaining({ error: 'rpc caído' }));
  });
});
