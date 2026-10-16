import { describe, it, expect, vi, beforeEach } from 'vitest';

// El cron de la bandeja de Carta Porte (0640-0642) — su CONTRATO operativo, el de sus hermanos: secreto o 401/500,
// la palanca global y la del agente respetadas (y falla CERRADO si no se pueden leer), un latido en TODO camino de
// salida, y el motor invocado con la liga de la bandeja y un reloj que corta antes del claim.

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
const base = () => ({
  pendientes: 3, procesados: 3, fallidos: 0, yaTomados: 0, errores: 0, cortadosPorReloj: 0, paradaPorPresupuesto: false, paradaPorFallosSeguidos: false,
  agotados: 0, zombisCerrados: 0, divisionesAvisadas: 0, hallazgos: 1, avisosEnviados: 1, avisosEnCola: 0, avisosFallidos: 0, avisosPerdidos: 0, sinTelefono: 0, avisosSinMigracion: false, fallos: [] as string[],
});
const motor = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => base());
vi.mock('@/lib/likida/carta_porte_docs/worker', () => ({ correrWorkerCartaPorte: (...a: unknown[]) => motor(...a) }));
vi.mock('@/lib/likida/carta_porte_docs/worker_deps', () => ({ depsWorkerReales: () => ({ doble: true }) }));
// La salida al TMS (T-A3-28): la segunda pasada del mismo cron. Su motor se prueba en `worker_envios.test.ts`; aquí, su integración.
const cifrasEnvios = () => ({
  sinMigracion: false, reclamados: 2, enviados: 2, duplicados: 0, pendientesReque: 0, enEsperaManual: 0, reintentos: 0, rechazados: 0, descartados: 0, devueltosARevision: 0,
  alertas: 0, alertasFallidas: 0, circuitosAbiertos: 0, credencialesCaducadas: 0, soltados: 0, cortadosPorReloj: 0, conflictos: 0, errores: 0, fallos: [] as string[],
});
const envios = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => cifrasEnvios());
vi.mock('@/lib/likida/carta_porte_docs/worker_envios', () => ({
  correrWorkerEnvios: (...a: unknown[]) => envios(...a),
  resultadoEnviosVacio: () => ({ ...cifrasEnvios(), reclamados: 0, enviados: 0 }),
}));
vi.mock('@/lib/likida/carta_porte_docs/worker_envios_deps', () => ({ depsEnviosReales: () => ({ dobleEnvios: true }) }));
const alertarOperador = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...a) }));
vi.mock('@/lib/observability/sentry', () => ({ codigoDeError: () => 'cod' }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.test' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { GET, maxDuration } = await import('./route');
const llamar = () => GET(new Request('https://app.likida.ai/api/cron/carta-porte-docs'));
const j = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  autorizado = 'si'; interruptores = {};
  motor.mockReset(); motor.mockImplementation(async () => base());
  registrarLatido.mockClear(); alertarOperador.mockClear();
  envios.mockReset(); envios.mockImplementation(async () => cifrasEnvios());
});

describe('la puerta y las palancas', () => {
  it('sin secreto o con secreto malo no corre nada', async () => {
    autorizado = 'no';
    expect((await llamar()).status).toBe(401);
    autorizado = 'sin_secreto';
    expect((await llamar()).status).toBe(500);
    expect(motor).not.toHaveBeenCalled();
  });

  it.each(['global', 'agente:carta_porte'])('la palanca %s apagada → 200 `saltado` con latido `saltado`', async (p) => {
    interruptores = { [p]: 'apagado' };
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(await j(r)).toMatchObject({ corrio: false, saltado: expect.stringContaining(p) });
    expect(registrarLatido).toHaveBeenCalledWith('carta-porte-docs', 'saltado', { interruptor: p });
    expect(motor).not.toHaveBeenCalled();
  });

  it.each(['global', 'agente:carta_porte'])('la palanca %s ILEGIBLE → falla CERRADO (500) con latido `fallo`', async (p) => {
    interruptores = { [p]: 'ilegible' };
    const r = await llamar();
    expect(r.status).toBe(500);
    expect(await j(r)).toMatchObject({ codigo: 'interruptor_ilegible', interruptor: p });
    expect(motor).not.toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('carta-porte-docs', 'fallo', { codigo: 'interruptor_ilegible' });
  });
});

describe('la corrida', () => {
  it('llama al motor con la liga de la bandeja y un reloj dentro del maxDuration; latido ok con las cifras', async () => {
    const antes = Date.now();
    const r = await j(await llamar());
    expect(motor).toHaveBeenCalledTimes(1);
    const [deps, opts] = motor.mock.calls[0] as [unknown, { venceEn: number; urlBandeja: string }];
    expect(deps).toEqual({ doble: true });
    expect(opts.urlBandeja).toBe('https://app.test/dashboard/carta-porte/documentos');
    expect(opts.venceEn).toBeGreaterThan(antes);
    expect(opts.venceEn).toBeLessThan(antes + maxDuration * 1000);
    expect(r).toMatchObject({ corrio: true, procesados: 3, avisosEnviados: 1 });
    expect(registrarLatido).toHaveBeenCalledWith('carta-porte-docs', 'ok', expect.objectContaining({ procesados: 3, hallazgos: 1 }));
  });

  it.each([
    ['un fallo de extracción', { fallidos: 1, fallos: ['modelo: x'] }],
    ['una excepción por documento', { errores: 1 }],
    ['el reloj cortó la pasada', { cortadosPorReloj: 2 }],
    ['el presupuesto de IA se agotó', { paradaPorPresupuesto: true }],
    ['un aviso a la oficina rechazado', { avisosFallidos: 1 }],
    ['la base sin la 0641 (avisos apagados)', { avisosSinMigracion: true }],
  ])('%s deja el latido PARCIAL', async (_n, cambio) => {
    motor.mockResolvedValueOnce({ ...base(), ...cambio });
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(registrarLatido).toHaveBeenCalledWith('carta-porte-docs', 'parcial', expect.anything());
  });

  it('un documento zombi cerrado en la pasada deja el latido en `parcial` (M3, ronda 15)', async () => {
    motor.mockImplementation(async () => ({ ...base(), zombisCerrados: 1, agotados: 1 }));
    await llamar();
    expect(registrarLatido).toHaveBeenCalledWith('carta-porte-docs', 'parcial', expect.anything());
  });

  it('un aviso en la cola de WhatsApp (rechazo reintentable) NO es un fallo: el latido sale ok', async () => {
    motor.mockResolvedValueOnce({ ...base(), avisosEnCola: 1, avisosEnviados: 0 });
    await llamar();
    expect(registrarLatido).toHaveBeenCalledWith('carta-porte-docs', 'ok', expect.anything());
  });

  it('el modelo caído (fallos seguidos) alerta al operador', async () => {
    motor.mockResolvedValueOnce({ ...base(), paradaPorFallosSeguidos: true, fallidos: 4 });
    await llamar();
    expect(alertarOperador).toHaveBeenCalledWith('cron.carta_porte_docs', expect.objectContaining({ codigo: 'cp_modelo_caido' }));
  });

  it('el motor lanza → 500, alerta y latido `fallo` (en todo camino de salida)', async () => {
    motor.mockRejectedValueOnce(new Error('boom'));
    const r = await llamar();
    expect(r.status).toBe(500);
    expect(await j(r)).toMatchObject({ corrio: false, error: 'boom' });
    expect(alertarOperador).toHaveBeenCalledTimes(1);
    expect(registrarLatido).toHaveBeenCalledWith('carta-porte-docs', 'fallo', expect.objectContaining({ error: 'boom' }));
  });

  it('la respuesta recorta la lista de fallos a 20', async () => {
    motor.mockResolvedValueOnce({ ...base(), fallidos: 30, fallos: Array.from({ length: 30 }, (_, i) => `f${i}`) });
    const r = await j(await llamar());
    expect(r.fallos).toHaveLength(20);
  });
});

describe('la salida al TMS: segunda pasada del mismo cron (T-A3-28)', () => {
  it('corre DESPUÉS de la extracción, con el mismo reloj, y su parte va en la respuesta y en el latido', async () => {
    const orden: string[] = [];
    motor.mockImplementation(async () => { orden.push('extraccion'); return base(); });
    envios.mockImplementation(async () => { orden.push('salida'); return cifrasEnvios(); });
    const antes = Date.now();
    const r = await j(await llamar());
    expect(orden).toEqual(['extraccion', 'salida']);
    const [deps, opts] = envios.mock.calls[0] as [unknown, { venceEn: number }];
    expect(deps).toEqual({ dobleEnvios: true });
    const [, optsExtraccion] = motor.mock.calls[0] as [unknown, { venceEn: number }];
    expect(opts.venceEn).toBe(optsExtraccion.venceEn);
    expect(opts.venceEn).toBeLessThan(antes + maxDuration * 1000);
    expect(r.envios).toMatchObject({ corrio: true, reclamados: 2, enviados: 2 });
    expect(registrarLatido).toHaveBeenCalledWith('carta-porte-docs', 'ok', expect.objectContaining({ envios: expect.objectContaining({ corrio: true, enviados: 2, fallos: 0 }) }));
  });

  it('la palanca de la salida APAGADA salta solo la salida: la extracción corre y el latido sale ok', async () => {
    interruptores = { 'agente:carta_porte_salida_tms': 'apagado' };
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(await j(r)).toMatchObject({ corrio: true, procesados: 3, envios: { corrio: false } });
    expect(motor).toHaveBeenCalledTimes(1);
    expect(envios).not.toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('carta-porte-docs', 'ok', expect.objectContaining({ envios: { corrio: false, saltado: 'apagada' } }));
  });

  it('la palanca de la salida ILEGIBLE falla CERRADO solo para la salida: no sube nada y el latido queda `parcial`', async () => {
    interruptores = { 'agente:carta_porte_salida_tms': 'ilegible' };
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(await j(r)).toMatchObject({ corrio: true, procesados: 3, envios: { corrio: false, codigo: 'interruptor_ilegible' } });
    expect(envios).not.toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('carta-porte-docs', 'parcial', expect.anything());
  });

  it.each(['global', 'agente:carta_porte'])('la palanca %s apagada también detiene la salida (ni extracción ni envíos)', async (p) => {
    interruptores = { [p]: 'apagado' };
    await llamar();
    expect(motor).not.toHaveBeenCalled();
    expect(envios).not.toHaveBeenCalled();
  });

  it('si la salida LANZA, lo ya extraído se conserva: 200, alerta al operador y latido `parcial`', async () => {
    envios.mockRejectedValueOnce(new Error('base de envíos caída'));
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(await j(r)).toMatchObject({ corrio: true, procesados: 3, envios: { corrio: false, error: 'base de envíos caída' } });
    expect(alertarOperador).toHaveBeenCalledTimes(1);
    expect(alertarOperador).toHaveBeenCalledWith('cron.carta_porte_docs.salida', expect.objectContaining({ error: 'base de envíos caída' }));
    expect(registrarLatido).toHaveBeenCalledWith('carta-porte-docs', 'parcial', expect.anything());
  });

  it.each([
    ['un error de infraestructura en un envío', { errores: 1 }],
    ['un aviso de envío que no salió', { alertasFallidas: 1 }],
    ['el circuito del TMS se abrió', { circuitosAbiertos: 1 }],
    ['la credencial del TMS caducó', { credencialesCaducadas: 1 }],
    ['el reloj cortó la salida', { cortadosPorReloj: 1 }],
    ['la base sin la 0790', { sinMigracion: true }],
  ])('%s deja el latido PARCIAL', async (_n, cambio) => {
    envios.mockResolvedValueOnce({ ...cifrasEnvios(), ...cambio });
    await llamar();
    expect(registrarLatido).toHaveBeenCalledWith('carta-porte-docs', 'parcial', expect.anything());
  });

  it('la pasada con el circuito abierto registra el latido con `circuito_tms_abierto: true` y los pendientes (T-A3-38)', async () => {
    envios.mockResolvedValueOnce({ ...cifrasEnvios(), circuitosAbiertos: 1, reintentos: 4, soltados: 2, pendientesReque: 1 });
    await llamar();
    expect(registrarLatido).toHaveBeenCalledWith('carta-porte-docs', 'parcial', expect.objectContaining({
      envios: expect.objectContaining({ circuito_tms_abierto: true, envios_pendientes: 7 }),
    }));
  });

  it('con el circuito cerrado el latido lo dice y no inventa pendientes (T-A3-38)', async () => {
    await llamar();
    expect(registrarLatido).toHaveBeenCalledWith('carta-porte-docs', 'ok', expect.objectContaining({
      envios: expect.objectContaining({ circuito_tms_abierto: false, envios_pendientes: 0 }),
    }));
  });

  it('envíos que esperan (reque, descarga manual) o rechazados por el TMS NO son un fallo del cron: el latido sale ok', async () => {
    envios.mockResolvedValueOnce({ ...cifrasEnvios(), pendientesReque: 3, enEsperaManual: 2, rechazados: 1, reintentos: 1 });
    await llamar();
    expect(registrarLatido).toHaveBeenCalledWith('carta-porte-docs', 'ok', expect.anything());
  });

  it('el reloj duro de la extracción no deja a la salida sin su techo: si la salida se cuelga, el cron responde igual', async () => {
    envios.mockImplementation(() => new Promise(() => {})); // nunca resuelve
    vi.useFakeTimers();
    try {
      const pendiente = llamar();
      await vi.advanceTimersByTimeAsync(maxDuration * 1000);
      const r = await pendiente;
      expect(r.status).toBe(200);
      expect((await j(r)).envios).toMatchObject({ corrio: true, errores: 1 });
      expect(registrarLatido).toHaveBeenCalledWith('carta-porte-docs', 'parcial', expect.anything());
    } finally {
      vi.useRealTimers();
    }
  });
});
