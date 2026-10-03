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
vi.mock('@/lib/likida/conductor/repo', () => ({ correrMantenimientoConductor: () => mantenimiento(), leerConfigConductor: async () => ({}), asignarSitioDerivado: async () => 'ok' }));
const alertasEstadia = vi.fn(async (): Promise<Record<string, unknown>> => ({ revisadas: 1, alertas: 1, yaReclamadas: 0, sinDestinatario: 0, fueraDeVentana: 0, rechazosReintentables: 0, fallos: [] }));
vi.mock('@/lib/likida/conductor/alertas_estadia', () => ({ correrAlertasEstadia: () => alertasEstadia() }));
const llegadas = vi.fn(async (): Promise<Record<string, unknown>> => ({ revisadas: 1, avisos: 1, yaReclamados: 0, sinDestinatario: 0, fueraDeVentana: 0, rechazosReintentables: 0, fallos: [] }));
vi.mock('@/lib/likida/conductor/alertas_llegada', () => ({ correrAlertasLlegadaSinConfirmar: () => llegadas(), puertosAlertaLlegadaReales: () => ({}) }));
const barrido = vi.fn(async (): Promise<Record<string, unknown>> => ({ revisados: 2, validados: 1, sinCoincidencia: 0, sinDato: 1, saltados: 0, fallos: 0 }));
vi.mock('@/lib/likida/conductor/validar_hito', () => ({ barridoValidacion: () => barrido(), depsValidacionReales: {} }));
vi.mock('@/lib/likida/conductor/trabajo', () => ({ leerCandidatosValidacion: async () => [], leerCandidatosSitioDerivado: async () => [], leerCatalogoSitios: async () => new Map() }));
const ciclo = vi.fn(async (): Promise<Record<string, unknown>> => ({ viajes: 4, evaluados: 3, detectados: 2, llegadas: 1, salidas: 1, fallos: [] }));
vi.mock('@/lib/likida/conductor/ciclo_gps', () => ({ barridoCicloGps: () => ciclo() }));
vi.mock('@/lib/likida/conductor/ciclo_gps_real', () => ({ puertosCicloGpsReales: () => ({}) }));
const sitios = vi.fn(async (): Promise<Record<string, unknown>> => ({ candidatos: 5, derivados: 3, sinCoincidencia: 2, yaAsignados: 0, fallos: 0, cortadosPorReloj: 0 }));
vi.mock('@/lib/likida/conductor/sitio_derivado', () => ({ barridoSitioDerivado: () => sitios() }));
const senal = vi.fn(async (): Promise<Record<string, unknown>> => ({ viajes: 4, avisosChofer: 1, escalaciones: 1, cortadaPorRechazoMasivo: false, fallos: [] }));
vi.mock('@/lib/likida/conductor/senal_vida', () => ({ barridoSenalVida: () => senal() }));
vi.mock('@/lib/likida/conductor/senal_vida_real', () => ({ puertosSenalVidaReales: () => ({}) }));
const acercamiento = vi.fn(async (): Promise<Record<string, unknown>> => ({ candidatos: 3, enviados: 1, sinPosicion: 1, lejos: 1, rechazados: 0, fallos: 0, cortadosPorReloj: 0 }));
vi.mock('@/lib/likida/convenios/acercamiento', () => ({ barridoAcercamiento: () => acercamiento() }));
class ConveniosNoDisponiblesDoble extends Error {}
vi.mock('@/lib/likida/convenios/repo', () => ({ ConveniosNoDisponibles: ConveniosNoDisponiblesDoble }));
const alertarOperador = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...a) }));
vi.mock('@/lib/observability/sentry', () => ({ codigoDeError: () => 'cod' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { GET } = await import('./route');
const llamar = () => GET(new Request('https://app.likida.ai/api/cron/conductor-hitos'));
const j = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  autorizado = 'si'; interruptores = {}; horaMx = 12;
  correr.mockClear(); registrarLatido.mockClear(); alertarOperador.mockClear(); mantenimiento.mockClear(); alertasEstadia.mockClear(); llegadas.mockClear(); barrido.mockClear(); acercamiento.mockClear(); ciclo.mockClear(); sitios.mockClear(); senal.mockClear();
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

describe('el aviso de llegada sin confirmar (0604)', () => {
  it('corre DESPUÉS de la validación y su resumen viaja en la respuesta y en el latido', async () => {
    const orden: string[] = [];
    barrido.mockImplementationOnce(async () => { orden.push('validacion'); return { revisados: 2, validados: 1, sinCoincidencia: 0, sinDato: 1, saltados: 0, fallos: 0 }; });
    llegadas.mockImplementationOnce(async () => { orden.push('llegadas'); return { revisadas: 1, avisos: 1, yaReclamados: 0, sinDestinatario: 0, fueraDeVentana: 0, rechazosReintentables: 0, fallos: [] }; });
    const r = await j(await llamar());
    expect(orden).toEqual(['validacion', 'llegadas']);
    expect(r.llegadasSinConfirmar).toMatchObject({ avisos: 1 });
    expect(registrarLatido).toHaveBeenCalledWith('conductor-hitos', 'ok', expect.objectContaining({ avisosLlegadaSinConfirmar: 1 }));
  });

  it('revienta: las demás pasadas corren igual, el latido sale parcial y el motivo queda a la vista', async () => {
    llegadas.mockRejectedValueOnce(new Error('boom llegadas'));
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(acercamiento).toHaveBeenCalledTimes(1);
    expect(registrarLatido).toHaveBeenCalledWith('conductor-hitos', 'parcial', expect.anything());
    expect(JSON.stringify((await j(r)).fallos)).toContain('boom llegadas');
  });

  it('un fallo de envío (plantilla sin aprobar) deja el latido parcial', async () => {
    llegadas.mockResolvedValueOnce({ revisadas: 1, avisos: 0, fallos: ['llegada F-1: plantilla sin aprobar'] });
    await llamar();
    expect(registrarLatido).toHaveBeenCalledWith('conductor-hitos', 'parcial', expect.anything());
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

describe('el aviso de acercamiento a la planta (0580)', () => {
  it('corre en cada pasada y su resultado va en el cuerpo y en el latido', async () => {
    const r = await j(await llamar());
    expect(acercamiento).toHaveBeenCalledTimes(1);
    expect(r.acercamiento).toMatchObject({ candidatos: 3, enviados: 1 });
    expect(registrarLatido).toHaveBeenCalledWith('conductor-hitos', 'ok', expect.objectContaining({ acercamientos: 1 }));
  });

  it('si revienta, las demás pasadas ya corrieron y el latido sale parcial con el motivo a la vista', async () => {
    acercamiento.mockRejectedValueOnce(new Error('boom acercamiento'));
    const r = await j(await llamar());
    expect(barrido).toHaveBeenCalledTimes(1);
    expect(r.fallos.join(' ')).toContain('boom acercamiento');
    expect(registrarLatido).toHaveBeenCalledWith('conductor-hitos', 'parcial', expect.anything());
  });

  it('con la base sin migrar (convenios no disponibles) NO es un fallo: no hay nada que avisar', async () => {
    acercamiento.mockRejectedValueOnce(new ConveniosNoDisponiblesDoble('falta 0580'));
    const r = await j(await llamar());
    expect(r.fallos).toEqual([]);
    expect(registrarLatido).toHaveBeenCalledWith('conductor-hitos', 'ok', expect.anything());
  });
});

describe('P2: el ciclo por geocerca, el sitio derivado y la señal de vida', () => {
  it('corren en cada pasada: sitio → ciclo → (validación y avisos de llegada) → señal de vida, y van al cuerpo y al latido', async () => {
    const orden: string[] = [];
    sitios.mockImplementationOnce(async () => { orden.push('sitios'); return { candidatos: 1, derivados: 1, sinCoincidencia: 0, yaAsignados: 0, fallos: 0, cortadosPorReloj: 0 }; });
    ciclo.mockImplementationOnce(async () => { orden.push('ciclo'); return { viajes: 1, detectados: 2, fallos: [] }; });
    barrido.mockImplementationOnce(async () => { orden.push('validacion'); return { revisados: 0, validados: 0, sinCoincidencia: 0, sinDato: 0, saltados: 0, fallos: 0 }; });
    senal.mockImplementationOnce(async () => { orden.push('senal'); return { viajes: 1, avisosChofer: 1, escalaciones: 1, cortadaPorRechazoMasivo: false, fallos: [] }; });
    const r = await j(await llamar());
    expect(orden).toEqual(['sitios', 'ciclo', 'validacion', 'senal']);
    expect(r.cicloGps).toMatchObject({ detectados: 2 });
    expect(r.senalVida).toMatchObject({ avisosChofer: 1 });
    expect(registrarLatido).toHaveBeenCalledWith('conductor-hitos', 'ok', expect.objectContaining({ hitosPorGps: 2, sitiosDerivados: 1, senalVidaAvisos: 1, senalVidaEscalaciones: 1 }));
  });

  it('cada pasada está aislada: si una revienta las demás corren y el latido sale parcial con el motivo', async () => {
    sitios.mockRejectedValueOnce(new Error('boom sitios'));
    ciclo.mockRejectedValueOnce(new Error('boom ciclo'));
    senal.mockRejectedValueOnce(new Error('boom senal'));
    const r = await j(await llamar());
    expect(barrido).toHaveBeenCalledTimes(1);
    expect(acercamiento).toHaveBeenCalledTimes(1);
    expect(r.fallos.join(' ')).toMatch(/boom sitios[\s\S]*boom ciclo[\s\S]*boom senal/);
    expect(registrarLatido).toHaveBeenCalledWith('conductor-hitos', 'parcial', expect.anything());
  });

  it('los fallos que reportan las pasadas llegan al cuerpo y vuelven parcial el latido', async () => {
    ciclo.mockResolvedValueOnce({ viajes: 1, detectados: 0, fallos: ['V-1: no se pudo registrar llegada_carga'] });
    const r = await j(await llamar());
    expect(r.fallos).toContain('V-1: no se pudo registrar llegada_carga');
    expect(registrarLatido).toHaveBeenCalledWith('conductor-hitos', 'parcial', expect.anything());
  });

  it('un rechazo masivo de Meta en la señal de vida deja el latido parcial', async () => {
    senal.mockResolvedValueOnce({ viajes: 8, avisosChofer: 0, escalaciones: 0, cortadaPorRechazoMasivo: true, fallos: [] });
    await llamar();
    expect(registrarLatido).toHaveBeenCalledWith('conductor-hitos', 'parcial', expect.anything());
  });

  it('con el interruptor apagado no corre ninguna de las tres', async () => {
    interruptores = { 'agente:conductores': 'apagado' };
    await llamar();
    expect(ciclo).not.toHaveBeenCalled();
    expect(sitios).not.toHaveBeenCalled();
    expect(senal).not.toHaveBeenCalled();
  });
});
