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
const pulls = vi.fn(async (..._a: unknown[]): Promise<Record<string, number>> => ({ reclamadas: 0, exitosas: 0, fallidas: 0, recibidos: 0, duplicados: 0, rechazados: 0 }));
vi.mock('@/lib/likida/peajes/pull', () => ({ ejecutarPulls: (...a: unknown[]) => pulls(...a) }));
const avisos = vi.fn(async (..._a: unknown[]): Promise<Record<string, number>> => ({ revisados: 0, enviados: 0, pendientes: 0 }));
vi.mock('@/lib/likida/peajes/aviso_oficina', () => ({ reintentarAvisosPeajes: (...a: unknown[]) => avisos(...a) }));
const alertarOperador = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...a) }));
vi.mock('@/lib/observability/sentry', () => ({ codigoDeError: () => 'cod' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { GET } = await import('./route');
const llamar = () => GET(new Request('https://app.likida.ai/api/cron/peajes'));
const j = async (r: Response) => (await r.json()) as Record<string, unknown>;

beforeEach(() => {
  autorizado = 'si'; interruptores = {};
  procesar.mockClear(); registrarLatido.mockClear(); alertarOperador.mockClear(); pulls.mockClear(); avisos.mockClear();
  pulls.mockResolvedValue({ reclamadas: 0, exitosas: 0, fallidas: 0, recibidos: 0, duplicados: 0, rechazados: 0 });
  avisos.mockResolvedValue({ revisados: 0, enviados: 0, pendientes: 0 });
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

describe('pull y avisos a la oficina (0563)', () => {
  it('consulta los pulls ANTES de procesar la cola y barre los avisos DESPUÉS, y todo viaja en el cuerpo', async () => {
    const orden: string[] = [];
    pulls.mockImplementationOnce(async () => { orden.push('pull'); return { reclamadas: 1, exitosas: 1, fallidas: 0, recibidos: 2, duplicados: 0, rechazados: 0 }; });
    procesar.mockImplementationOnce(async () => { orden.push('cola'); return { tomados: 2, procesados: 2, fallidos: 0, reintentar: 0, claimPerdido: 0 }; });
    avisos.mockImplementationOnce(async () => { orden.push('avisos'); return { revisados: 1, enviados: 1, pendientes: 0 }; });
    const r = await llamar();
    expect(orden).toEqual(['pull', 'cola', 'avisos']);
    expect(await j(r)).toMatchObject({ corrio: true, pulls: { recibidos: 2 }, avisos: { enviados: 1 } });
    expect(registrarLatido).toHaveBeenCalledWith('peajes', 'ok', expect.objectContaining({ pulls: expect.anything(), avisos: expect.anything() }));
  });

  it('un pull que LANZA no impide procesar la cola; la corrida queda `parcial`, nunca `ok`', async () => {
    pulls.mockRejectedValueOnce(new Error('rpc caída'));
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(procesar).toHaveBeenCalled();
    expect((await j(r)).pulls).toBeNull();
    expect(registrarLatido).toHaveBeenCalledWith('peajes', 'parcial', expect.anything());
  });

  it('un pull fallido o un aviso que no salió dejan el latido `parcial`', async () => {
    pulls.mockResolvedValueOnce({ reclamadas: 1, exitosas: 0, fallidas: 1, recibidos: 0, duplicados: 0, rechazados: 0 });
    await llamar();
    expect(registrarLatido).toHaveBeenLastCalledWith('peajes', 'parcial', expect.anything());
    avisos.mockResolvedValueOnce({ revisados: 1, enviados: 0, pendientes: 1 });
    await llamar();
    expect(registrarLatido).toHaveBeenLastCalledWith('peajes', 'parcial', expect.anything());
  });

  it('un barrido de avisos que lanza no tumba la corrida', async () => {
    avisos.mockRejectedValueOnce(new Error('boom'));
    const r = await llamar();
    expect(r.status).toBe(200);
    expect((await j(r)).avisos).toBeNull();
  });

  it('con una palanca apagada no se consulta ningún pull ni se avisa nada', async () => {
    interruptores = { 'agente:peajes': 'apagado' };
    await llamar();
    expect(pulls).not.toHaveBeenCalled();
    expect(avisos).not.toHaveBeenCalled();
  });
});
