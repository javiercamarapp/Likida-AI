import { describe, it, expect, vi, beforeEach } from 'vitest';

// El cron entrega y concilia. Lo que se fija es su CONTRATO operativo, el mismo
// de sus hermanos: secreto o 401/500, la palanca global y la del agente
// respetadas (y falla CERRADO si no se pueden leer), y un latido en TODO camino
// de salida — sin el latido, un apagado deliberado se pinta como cron muerto.

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
const procesar = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ tomadas: 2, en_cola: 1, enviadas: 1, reintentar: 0, fallidas: 0, sin_cambio: 0, avisos: { tomados: 0, enviados: 0, reintentar: 0, fallidos: 0, en_curso: 0 } }));
vi.mock('@/lib/likida/liquidacion_externa/servicio', () => ({ procesarLiquidacionesExternas: (...a: unknown[]) => procesar(...(a as [])) }));
const alertarOperador = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...a) }));
vi.mock('@/lib/observability/sentry', () => ({ codigoDeError: () => 'cod' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { GET } = await import('./route');
const llamar = () => GET(new Request('https://app.likida.ai/api/cron/liquidaciones-externas'));
const j = async (r: Response) => (await r.json()) as Record<string, unknown>;

beforeEach(() => {
  autorizado = 'si'; interruptores = {};
  procesar.mockClear(); registrarLatido.mockClear(); alertarOperador.mockClear();
  procesar.mockResolvedValue({ tomadas: 2, en_cola: 1, enviadas: 1, reintentar: 0, fallidas: 0, sin_cambio: 0, avisos: { tomados: 0, enviados: 0, reintentar: 0, fallidos: 0, en_curso: 0 } });
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
  it('global apagada → no corre, 200 con `saltado`, y DEJA LATIDO `saltado`', async () => {
    interruptores = { global: 'apagado' };
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(await j(r)).toMatchObject({ corrio: false, saltado: expect.stringContaining('global') });
    expect(procesar).not.toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('liquidaciones-externas', 'saltado', { interruptor: 'global' });
  });

  it('global ILEGIBLE → falla CERRADO (500) con latido `fallo`: «no sé si está apagado» no es permiso', async () => {
    interruptores = { global: 'ilegible' };
    const r = await llamar();
    expect(r.status).toBe(500);
    expect(await j(r)).toMatchObject({ codigo: 'interruptor_ilegible' });
    expect(procesar).not.toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('liquidaciones-externas', 'fallo', { codigo: 'interruptor_ilegible' });
  });

  it('la palanca del agente de Liquidación también apaga la entrega, con su latido', async () => {
    interruptores = { 'agente:liquidacion': 'apagado' };
    const r = await llamar();
    expect(await j(r)).toMatchObject({ corrio: false, saltado: expect.stringContaining('agente:liquidacion') });
    expect(procesar).not.toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('liquidaciones-externas', 'saltado', { interruptor: 'agente:liquidacion' });
  });

  it('la palanca del agente ilegible → falla cerrado', async () => {
    interruptores = { 'agente:liquidacion': 'ilegible' };
    expect((await llamar()).status).toBe(500);
    expect(procesar).not.toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('liquidaciones-externas', 'fallo', expect.anything());
  });
});

describe('la corrida', () => {
  it('encendido: procesa, responde el resumen y deja latido ok', async () => {
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(await j(r)).toMatchObject({ corrio: true, tomadas: 2, enviadas: 1 });
    expect(registrarLatido).toHaveBeenCalledWith('liquidaciones-externas', 'ok', expect.objectContaining({ tomadas: 2 }));
  });

  it('un aviso de «No coincide» que no llegó (reintentar o fallido) también es `parcial`', async () => {
    for (const avisos of [{ tomados: 1, enviados: 0, reintentar: 1, fallidos: 0, en_curso: 0 }, { tomados: 1, enviados: 0, reintentar: 0, fallidos: 1, en_curso: 0 }]) {
      registrarLatido.mockClear();
      procesar.mockResolvedValueOnce({ tomadas: 0, en_cola: 0, enviadas: 0, reintentar: 0, fallidas: 0, sin_cambio: 0, avisos });
      await llamar();
      expect(registrarLatido).toHaveBeenCalledWith('liquidaciones-externas', 'parcial', expect.anything());
    }
    registrarLatido.mockClear();
    procesar.mockResolvedValueOnce({ tomadas: 0, en_cola: 0, enviadas: 0, reintentar: 0, fallidas: 0, sin_cambio: 0, avisos: { tomados: 2, enviados: 2, reintentar: 0, fallidos: 0, en_curso: 0 } });
    await llamar();
    expect(registrarLatido).toHaveBeenCalledWith('liquidaciones-externas', 'ok', expect.anything());
  });

  it('trabajo que NO terminó (reintentos o fallidas) es `parcial`: ni «ok» ni «fallo»', async () => {
    procesar.mockResolvedValueOnce({ tomadas: 3, en_cola: 0, enviadas: 1, reintentar: 1, fallidas: 1, sin_cambio: 0, avisos: { tomados: 0, enviados: 0, reintentar: 0, fallidos: 0, en_curso: 0 } });
    await llamar();
    expect(registrarLatido).toHaveBeenCalledWith('liquidaciones-externas', 'parcial', expect.anything());
  });

  it('las fases de correo y pull: lo que no terminó (fallidas, por reintentar, sin configurar, errores, pull con error) es `parcial`; limpio es `ok`', async () => {
    const avisos = { tomados: 0, enviados: 0, reintentar: 0, fallidos: 0, en_curso: 0 };
    const base = { tomadas: 0, en_cola: 0, enviadas: 0, reintentar: 0, fallidas: 0, sin_cambio: 0, avisos };
    const correoOk = { reclamadas: 3, enviadas: 3, reintentar: 0, fallidas: 0, sinConfigurar: 0, fueraDeVentana: 0, apagada: 0, sinConfirmar: 0, errores: 0 };
    const pullOk = { flotas: 1, leidas: 4, importadas: 4, excepciones: 0, errores: 0 };
    const parciales = [
      { correo: { ...correoOk, fallidas: 1 }, pull: pullOk },
      { correo: { ...correoOk, reintentar: 1 }, pull: pullOk },
      { correo: { ...correoOk, sinConfigurar: 1 }, pull: pullOk },
      { correo: { ...correoOk, errores: 1 }, pull: pullOk },
      { correo: correoOk, pull: { ...pullOk, errores: 1, error: 'TmsNoDisponible' } },
    ];
    for (const extra of parciales) {
      registrarLatido.mockClear();
      procesar.mockResolvedValueOnce({ ...base, ...extra });
      await llamar();
      expect(registrarLatido).toHaveBeenCalledWith('liquidaciones-externas', 'parcial', expect.objectContaining({ correo: extra.correo, pull: extra.pull }));
    }
    registrarLatido.mockClear();
    procesar.mockResolvedValueOnce({ ...base, correo: correoOk, pull: pullOk });
    await llamar();
    expect(registrarLatido).toHaveBeenCalledWith('liquidaciones-externas', 'ok', expect.objectContaining({ correo: correoOk, pull: pullOk }));
  });

  it('si el procesamiento lanza: 500, latido `fallo` y ALERTA al operador (no un cron verde que no hace nada)', async () => {
    procesar.mockRejectedValueOnce(new Error('base caída'));
    const r = await llamar();
    expect(r.status).toBe(500);
    expect(await j(r)).toMatchObject({ corrio: false, error: 'base caída' });
    expect(registrarLatido).toHaveBeenCalledWith('liquidaciones-externas', 'fallo', expect.objectContaining({ error: 'base caída' }));
    expect(alertarOperador).toHaveBeenCalledTimes(1);
  });
});


describe('A37-S09-02 — reloj de la corrida', () => {
  it('le pasa un `venceEn` (instante futuro) a la pasada', async () => {
    await llamar();
    const venceEn = procesar.mock.calls[0][2] as number;
    expect(venceEn).toBeGreaterThan(Date.now());
    expect(venceEn).toBeLessThan(Date.now() + 60_000);
  });
  it('si la pasada devuelve `cortadoPorReloj`, el latido es parcial', async () => {
    procesar.mockResolvedValueOnce({ tomadas: 5, en_cola: 2, enviadas: 0, reintentar: 0, fallidas: 0, sin_cambio: 0, avisos: { tomados: 0, enviados: 0, reintentar: 0, fallidos: 0, en_curso: 0 }, cortadoPorReloj: true });
    await llamar();
    expect(registrarLatido).toHaveBeenLastCalledWith('liquidaciones-externas', 'parcial', expect.objectContaining({ cortadoPorReloj: true }));
  });
  it('si la pasada se cuelga más allá del reloj duro, la ruta responde y late parcial', async () => {
    vi.useFakeTimers();
    try {
      procesar.mockImplementationOnce(() => new Promise(() => {}));
      const p = llamar();
      await vi.advanceTimersByTimeAsync(55_000);
      const r = await p;
      expect(r.status).toBe(200);
      expect(registrarLatido).toHaveBeenLastCalledWith('liquidaciones-externas', 'parcial', expect.objectContaining({ cortadoPorReloj: true }));
    } finally {
      vi.useRealTimers();
    }
  });
});
