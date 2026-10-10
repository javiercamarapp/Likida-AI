import { describe, it, expect, vi, beforeEach } from 'vitest';

// El cron de la entrega al contador (0531, Agente 9) — su CONTRATO operativo, el de sus hermanos: secreto o 401/500,
// la palanca global respetada (y falla CERRADO si no se puede leer), un latido en TODO camino de salida, y el motor
// invocado con un reloj que corta antes del techo de la función. El motor mismo lo prueba `buzon/entrega_e2e.test.ts`.

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
let global: 'encendido' | 'apagado' | 'ilegible' = 'encendido';
vi.mock('@/lib/likida/interruptores', () => ({ leerInterruptor: async (_id: string) => global }));
const base = () => ({ armados: 1, enviados: 1, reprogramados: 0, fallidos: 0, retrasados: 0, errores: 0 });
const motor = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => base());
vi.mock('@/lib/likida/buzon/entrega', () => ({ procesarEntregas: (...a: unknown[]) => motor(...a) }));
vi.mock('@/lib/likida/buzon/servicio', () => ({ depsEntregaReales: () => ({ doble: true }) }));
const alertarOperador = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...a) }));
vi.mock('@/lib/observability/sentry', () => ({ codigoDeError: () => 'cod' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { GET, maxDuration } = await import('./route');
const llamar = () => GET(new Request('https://app.likida.ai/api/cron/buzon-entrega'));
const j = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  autorizado = 'si'; global = 'encendido';
  motor.mockReset(); motor.mockImplementation(async () => base());
  registrarLatido.mockClear(); alertarOperador.mockClear();
});

describe('la puerta y la palanca global', () => {
  it('sin secreto o con secreto malo no corre nada', async () => {
    autorizado = 'no';
    expect((await llamar()).status).toBe(401);
    autorizado = 'sin_secreto';
    expect((await llamar()).status).toBe(500);
    expect(motor).not.toHaveBeenCalled();
  });

  it('el global apagado → 200 `saltado`, con latido `saltado` (apagado a propósito no es un cron muerto)', async () => {
    global = 'apagado';
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(await j(r)).toMatchObject({ corrio: false, saltado: 'interruptor global' });
    expect(registrarLatido).toHaveBeenCalledWith('buzon-entrega', 'saltado', { interruptor: 'global' });
    expect(motor).not.toHaveBeenCalled();
  });

  it('el global ILEGIBLE → falla CERRADO (500), con latido `fallo` y la causa', async () => {
    global = 'ilegible';
    const r = await llamar();
    expect(r.status).toBe(500);
    expect(await j(r)).toMatchObject({ corrio: false, codigo: 'interruptor_ilegible', interruptor: 'global' });
    expect(registrarLatido).toHaveBeenCalledWith('buzon-entrega', 'fallo', { codigo: 'interruptor_ilegible' });
    expect(motor).not.toHaveBeenCalled();
  });
});

describe('la corrida', () => {
  it('llama al motor con las dependencias reales y un reloj que vence ANTES del maxDuration; latido ok con las cifras', async () => {
    const antes = Date.now();
    const r = await j(await llamar());
    expect(motor).toHaveBeenCalledTimes(1);
    const [deps, opts] = motor.mock.calls[0] as [unknown, { vencePorReloj: number }];
    expect(deps).toEqual({ doble: true });
    expect(opts.vencePorReloj).toBeGreaterThan(antes);
    expect(opts.vencePorReloj).toBeLessThan(antes + maxDuration * 1000);
    expect(r).toMatchObject({ corrio: true, armados: 1, enviados: 1 });
    expect(registrarLatido).toHaveBeenCalledWith('buzon-entrega', 'ok', expect.objectContaining({ armados: 1, enviados: 1 }));
  });

  it.each([
    ['un lote que agotó sus intentos (fallido)', { fallidos: 1 }],
    ['una excepción al armar o enviar una flota', { errores: 1 }],
  ])('%s deja el latido PARCIAL (trabajo que no terminó), sin tirar la respuesta', async (_n, cambio) => {
    motor.mockResolvedValueOnce({ ...base(), ...cambio });
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(registrarLatido).toHaveBeenCalledWith('buzon-entrega', 'parcial', expect.anything());
  });

  it('los reprogramados y los retrasados NO son fallo: el latido sale ok (el backoff es el diseño)', async () => {
    motor.mockResolvedValueOnce({ ...base(), reprogramados: 2, retrasados: 1 });
    await llamar();
    expect(registrarLatido).toHaveBeenCalledWith('buzon-entrega', 'ok', expect.anything());
    expect(alertarOperador).not.toHaveBeenCalled();
  });

  it('el motor lanza → 500, alerta al operador y latido `fallo` con el código (en todo camino de salida)', async () => {
    motor.mockRejectedValueOnce(new Error('boom'));
    const r = await llamar();
    expect(r.status).toBe(500);
    expect(await j(r)).toMatchObject({ corrio: false, error: 'boom', codigo: 'cod' });
    expect(alertarOperador).toHaveBeenCalledWith('cron.buzon-entrega', { error: 'boom', codigo: 'cod' });
    expect(registrarLatido).toHaveBeenCalledWith('buzon-entrega', 'fallo', { error: 'boom', codigo: 'cod' });
  });
});
