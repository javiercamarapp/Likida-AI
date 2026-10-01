import { describe, it, expect, vi, beforeEach } from 'vitest';

// El cron del Agente 5 — su CONTRATO operativo, el mismo de sus hermanos: secreto o
// 401/500, la palanca global y la del agente respetadas (y falla CERRADO si no se
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
const correr = vi.fn(async (): Promise<Record<string, unknown>> => ({
  sembrados: 5, viajes: 2, solicitudes: 1, recordatorios: 0, escalaciones: 0, yaReclamados: 0, rechazosReintentables: 0,
  configIlegible: 0, sinDestinatario: 0, cortadosPorReloj: 0, cortadaPorRechazoMasivo: false, fallos: [], saltados: {},
}));
vi.mock('@/lib/likida/conductor/ejecutor', () => ({ correrConductor: (...a: unknown[]) => correr(...(a as [])), puertosReales: () => ({}) }));
let horaMx = 12;
vi.mock('@/lib/likida/conductor/config', () => ({ horaYDiaMx: () => ({ hora: horaMx, dia: 5 }) }));
const mantenimiento = vi.fn(async (): Promise<Record<string, number | string>> => ({ anonimizar_conductor_hitos: 3, purgar_conductor_auditoria: 3 }));
vi.mock('@/lib/likida/conductor/repo', () => ({ correrMantenimientoConductor: () => mantenimiento(), leerConfigConductor: async () => ({}) }));
const alertasEstadia = vi.fn(async (): Promise<Record<string, unknown>> => ({ revisadas: 1, alertas: 1, yaReclamadas: 0, sinDestinatario: 0, fueraDeVentana: 0, rechazosReintentables: 0, fallos: [] }));
vi.mock('@/lib/likida/conductor/alertas_estadia', () => ({ correrAlertasEstadia: () => alertasEstadia() }));
const barrido = vi.fn(async (): Promise<Record<string, unknown>> => ({ revisados: 2, validados: 1, sinCoincidencia: 0, sinDato: 1, saltados: 0, fallos: 0 }));
vi.mock('@/lib/likida/conductor/validar_hito', () => ({ barridoValidacion: () => barrido(), depsValidacionReales: {} }));
vi.mock('@/lib/likida/conductor/trabajo', () => ({ leerCandidatosValidacion: async () => [] }));
const alertarOperador = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...a) }));
vi.mock('@/lib/observability/sentry', () => ({ codigoDeError: () => 'cod' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { GET } = await import('./route');
const llamar = () => GET(new Request('https://app.likida.ai/api/cron/conductor-hitos'));
const j = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  autorizado = 'si'; interruptores = {}; horaMx = 12;
  correr.mockClear(); registrarLatido.mockClear(); alertarOperador.mockClear(); mantenimiento.mockClear(); alertasEstadia.mockClear(); barrido.mockClear();
});

describe('la puerta y las palancas', () => {
  it('sin secreto o con secreto malo no corre nada', async () => {
    autorizado = 'no';
    expect((await llamar()).status).toBe(401);
    autorizado = 'sin_secreto';
    expect((await llamar()).status).toBe(500);
    expect(correr).not.toHaveBeenCalled();
  });

  it('global apagada → 200 `saltado` con latido `saltado`', async () => {
    interruptores = { global: 'apagado' };
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(await j(r)).toMatchObject({ corrio: false, saltado: expect.stringContaining('global') });
    expect(registrarLatido).toHaveBeenCalledWith('conductor-hitos', 'saltado', { interruptor: 'global' });
    expect(correr).not.toHaveBeenCalled();
  });

  it('la palanca agente:conductores apagada también frena (y deja latido)', async () => {
    interruptores = { 'agente:conductores': 'apagado' };
    expect(await j(await llamar())).toMatchObject({ corrio: false, saltado: expect.stringContaining('agente:conductores') });
    expect(registrarLatido).toHaveBeenCalledWith('conductor-hitos', 'saltado', { interruptor: 'agente:conductores' });
    expect(correr).not.toHaveBeenCalled();
  });

  it.each(['global', 'agente:conductores'])('la palanca %s ILEGIBLE → falla CERRADO (500) con latido `fallo`', async (p) => {
    interruptores = { [p]: 'ilegible' };
    const r = await llamar();
    expect(r.status).toBe(500);
    expect(await j(r)).toMatchObject({ codigo: 'interruptor_ilegible' });
    expect(correr).not.toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('conductor-hitos', 'fallo', { codigo: 'interruptor_ilegible' });
  });
});

describe('las pasadas de la 0385 (alertas de estadía y validación de ubicación)', () => {
  it('corren después del motor y su resumen viaja en la respuesta y en el latido', async () => {
    const r = await j(await llamar());
    expect(alertasEstadia).toHaveBeenCalledTimes(1);
    expect(barrido).toHaveBeenCalledTimes(1);
    expect(r.alertasEstadia).toMatchObject({ alertas: 1 });
    expect(r.validacion).toMatchObject({ validados: 1 });
    expect(registrarLatido).toHaveBeenCalledWith('conductor-hitos', 'ok', expect.objectContaining({ alertasEstadia: 1, validados: 1 }));
  });

  it('las alertas revientan: la validación corre igual, el latido sale parcial y el motivo queda a la vista', async () => {
    alertasEstadia.mockRejectedValueOnce(new Error('boom alertas'));
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(barrido).toHaveBeenCalledTimes(1);
    expect(registrarLatido).toHaveBeenCalledWith('conductor-hitos', 'parcial', expect.anything());
    expect(JSON.stringify((await j(r)).fallos)).toContain('boom alertas');
  });

  it('la validación revienta: las alertas ya corrieron y el latido sale parcial', async () => {
    barrido.mockRejectedValueOnce(new Error('boom barrido'));
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(alertasEstadia).toHaveBeenCalledTimes(1);
    expect(registrarLatido).toHaveBeenCalledWith('conductor-hitos', 'parcial', expect.anything());
  });

  it('un fallo de alerta de envío (plantilla sin aprobar) también deja el latido parcial', async () => {
    alertasEstadia.mockResolvedValueOnce({ revisadas: 1, alertas: 0, fallos: ['estadía F-1: plantilla sin aprobar'] });
    await llamar();
    expect(registrarLatido).toHaveBeenCalledWith('conductor-hitos', 'parcial', expect.anything());
  });

  it('el motor principal lanza: ni alertas ni validación corren (500 y latido fallo)', async () => {
    correr.mockRejectedValueOnce(new Error('base caída'));
    await llamar();
    expect(alertasEstadia).not.toHaveBeenCalled();
    expect(barrido).not.toHaveBeenCalled();
  });
});

describe('la corrida', () => {
  it('sana → 200 con el resumen y latido ok', async () => {
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(await j(r)).toMatchObject({ corrio: true, solicitudes: 1 });
    expect(registrarLatido).toHaveBeenCalledWith('conductor-hitos', 'ok', expect.objectContaining({ solicitudes: 1 }));
    expect(mantenimiento).not.toHaveBeenCalled(); // el mantenimiento es solo a las 03:xx
  });

  it('con fallos de envío → latido parcial (no ok, no fallo total)', async () => {
    correr.mockResolvedValueOnce({ fallos: ['plantilla no aprobada'], cortadosPorReloj: 0, cortadaPorRechazoMasivo: false, configIlegible: 0, sinDestinatario: 0 });
    await llamar();
    expect(registrarLatido).toHaveBeenCalledWith('conductor-hitos', 'parcial', expect.anything());
  });

  it('el rechazo masivo de Meta alerta al operador y deja latido parcial', async () => {
    correr.mockResolvedValueOnce({ fallos: [], cortadosPorReloj: 3, cortadaPorRechazoMasivo: true, configIlegible: 0, sinDestinatario: 0 });
    await llamar();
    expect(alertarOperador).toHaveBeenCalledWith('cron.conductor_hitos', expect.objectContaining({ codigo: 'wa_rechazo_masivo' }));
    expect(registrarLatido).toHaveBeenCalledWith('conductor-hitos', 'parcial', expect.anything());
  });

  it('el motor lanza → 500, alerta y latido `fallo` (en finally: nunca «sin cerrar»)', async () => {
    correr.mockRejectedValueOnce(new Error('base caída'));
    const r = await llamar();
    expect(r.status).toBe(500);
    expect(alertarOperador).toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledTimes(1);
    expect(registrarLatido).toHaveBeenCalledWith('conductor-hitos', 'fallo', expect.objectContaining({ error: 'base caída' }));
  });

  it('el mantenimiento de privacidad corre a las 03:xx de México, una vez, con las dos funciones', async () => {
    horaMx = 3;
    const r = await j(await llamar());
    expect(mantenimiento).toHaveBeenCalledTimes(1);
    expect(r.mantenimiento).toEqual({ anonimizar_conductor_hitos: 3, purgar_conductor_auditoria: 3 });
  });

  it('un fallo del mantenimiento se reporta pero no tumba la corrida', async () => {
    horaMx = 3;
    mantenimiento.mockResolvedValueOnce({ anonimizar_conductor_hitos: 'error: boom', purgar_conductor_auditoria: 3 });
    const r = await llamar();
    expect(r.status).toBe(200);
    expect((await j(r)).mantenimiento.anonimizar_conductor_hitos).toContain('boom');
  });
});
