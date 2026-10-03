import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClasificacionGuardia } from '@/lib/admin/guardia';

// ═══════════════════════════════════════════════════════════════════════════
// LA GUARDIA EN EL SERVIDOR (E1-A, P0-8). Se fija su CONTRATO operativo — el de
// sus hermanos (secreto, palanca global, latido en todo camino de salida) — y
// lo propio: avisa solo lo NUEVO, una base inalcanzable avisa una vez, mide los
// componentes de /estado sin inventar un ok, y la retención corre una vez al día.
// ═══════════════════════════════════════════════════════════════════════════

let autorizado: 'si' | 'no' | 'sin_secreto' = 'si';
const registrarLatido = vi.fn(async (..._a: unknown[]) => {});
const registrarEstado = vi.fn(async (..._a: unknown[]) => true);
const purgarObservabilidad = vi.fn(async () => ({ latencias: 12, estados: 0, parcial: false }));
let latidoPrevio: { ultimoLatido: string; estado: string; detalle: Record<string, unknown> } | null = null;
let latidos: Record<string, { estado: string; ultimoEstado: string | null }> = {};
vi.mock('@/lib/admin/salud', () => {
  return {
    COMPONENTES_ESTADO: ['app', 'base', 'crons', 'whatsapp', 'correo'],
    puertaCron: async () => {
      if (autorizado === 'sin_secreto') return new Response(JSON.stringify({ error: 'CRON_SECRET' }), { status: 500 });
      if (autorizado === 'no') return new Response(null, { status: 401 });
      return null;
    },
    registrarLatido: (...a: unknown[]) => registrarLatido(...a),
    registrarEstado: (...a: unknown[]) => registrarEstado(...a),
    purgarObservabilidad: () => purgarObservabilidad(),
    leerLatido: async () => latidoPrevio,
    detalleLatidos: async () => latidos,
  };
});

let global: 'encendido' | 'apagado' | 'ilegible' = 'encendido';
vi.mock('@/lib/likida/interruptores', () => ({ leerInterruptor: async () => global }));

const vacia: ClasificacionGuardia = { fuentesCiegas: [], items: [], porSeveridad: { S1: 0, S2: 0, S3: 0, no_incidente: 0 }, limites: [] };
const incidente = { severidad: 'S2' as const, regla: 'regla x', fuente: 'corridas', titulo: 'Corrida en fallo', flota: 'Flota X', desde: '2026-10-03T00:00:00Z', vence: null, href: null };
let clasificacion: ClasificacionGuardia | Error = vacia;
vi.mock('@/lib/admin/guardia', async () => {
  const real = await vi.importActual<typeof import('@/lib/admin/guardia')>('@/lib/admin/guardia');
  return {
    ...real,
    clasificacionDeGuardia: async () => { if (clasificacion instanceof Error) throw clasificacion; return clasificacion; },
  };
});

let sondeo = { respondio: true, httpStatus: 200, status: 'ok', db: 'ok', crons: 'ok', migracionAlDia: true } as Record<string, unknown>;
vi.mock('@/lib/admin/estado', async () => {
  const real = await vi.importActual<typeof import('@/lib/admin/estado')>('@/lib/admin/estado');
  return { ...real, sondearHealth: async () => sondeo };
});
vi.mock('@/lib/correo/enviar', () => ({ correoConfigurado: () => true }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.likida.ai' }));
let avisoSale = true;
const alertarOperador = vi.fn(async (..._a: unknown[]) => avisoSale);
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...a) }));
vi.mock('@/lib/observability/sentry', () => ({ codigoDeError: () => 'cod' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { GET } = await import('./route');
const llamar = () => GET(new Request('https://app.likida.ai/api/cron/guardia'));
const j = async (r: Response) => (await r.json()) as Record<string, unknown>;
const ok = { estado: 'ok', ultimoEstado: 'ok' };

beforeEach(() => {
  autorizado = 'si'; global = 'encendido'; clasificacion = vacia; latidoPrevio = null;
  sondeo = { respondio: true, httpStatus: 200, status: 'ok', db: 'ok', crons: 'ok', migracionAlDia: true };
  latidos = { 'wa-pendientes': ok, 'wa-outbox': ok, 'buzon-entrega': ok };
  avisoSale = true; registrarLatido.mockClear(); registrarEstado.mockClear(); alertarOperador.mockClear(); purgarObservabilidad.mockClear();
  vi.useRealTimers();
});

describe('la puerta y las palancas', () => {
  it('sin secreto o con secreto malo no corre nada', async () => {
    autorizado = 'no';
    expect((await llamar()).status).toBe(401);
    autorizado = 'sin_secreto';
    expect((await llamar()).status).toBe(500);
    expect(registrarEstado).not.toHaveBeenCalled();
    expect(alertarOperador).not.toHaveBeenCalled();
  });
  it('global apagada: no corre ni mide, 200 con `saltado` y latido `saltado` (el interruptor la apaga)', async () => {
    global = 'apagado';
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(await j(r)).toMatchObject({ corrio: false, saltado: expect.stringContaining('global') });
    expect(registrarEstado).not.toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('guardia', 'saltado', { interruptor: 'global' });
  });
  it('global ILEGIBLE: falla CERRADO (500), latido `fallo` y AVISA — la guardia ciega que calla es el fallo que no se acepta', async () => {
    global = 'ilegible';
    const r = await llamar();
    expect(r.status).toBe(500);
    expect(await j(r)).toMatchObject({ codigo: 'interruptor_ilegible' });
    expect(registrarLatido).toHaveBeenCalledWith('guardia', 'fallo', { codigo: 'interruptor_ilegible' });
    expect(alertarOperador).toHaveBeenCalledWith('guardia.sin_vista', expect.objectContaining({ codigo: 'interruptor_ilegible' }));
  });
});

describe('avisar solo lo NUEVO', () => {
  it('un S2 nuevo avisa al operador y deja su huella en el latido; sin texto de negocio en el estado', async () => {
    clasificacion = { ...vacia, items: [incidente], porSeveridad: { ...vacia.porSeveridad, S2: 1 } };
    const r = await llamar();
    expect(await j(r)).toMatchObject({ corrio: true, urgentes: 1, nuevos: 1 });
    expect(alertarOperador).toHaveBeenCalledWith('guardia.incidente_nuevo', expect.objectContaining({
      codigo: 'guardia_incidente_nuevo', cual: expect.any(String), incidente_1: expect.stringContaining('Corrida en fallo'),
    }));
    const detalle = registrarLatido.mock.calls.find((c) => c[0] === 'guardia')?.[2] as { vistos: string[] };
    expect(detalle.vistos).toHaveLength(1);
    expect(JSON.stringify(detalle.vistos)).not.toMatch(/Corrida en fallo|Flota X/);
  });

  it('con el estado previo en el latido, el MISMO incidente no vuelve a avisar', async () => {
    clasificacion = { ...vacia, items: [incidente], porSeveridad: { ...vacia.porSeveridad, S2: 1 } };
    await llamar();
    const guardado = registrarLatido.mock.calls.find((c) => c[0] === 'guardia')?.[2] as Record<string, unknown>;
    latidoPrevio = { ultimoLatido: new Date().toISOString(), estado: 'ok', detalle: guardado };
    alertarOperador.mockClear();
    await llamar();
    expect(alertarOperador).not.toHaveBeenCalledWith('guardia.incidente_nuevo', expect.anything());
  });

  it('M5: si el aviso NO salió (sin canal, piso, envío rechazado) el incidente nuevo NO queda en vistos y se reintenta', async () => {
    clasificacion = { ...vacia, items: [incidente], porSeveridad: { ...vacia.porSeveridad, S2: 1 } };
    avisoSale = false;
    await llamar();
    const guardado = registrarLatido.mock.calls.find((c) => c[0] === 'guardia')?.[2] as { vistos: string[] };
    expect(guardado.vistos).toHaveLength(0);
    // al configurar el canal, la siguiente pasada SÍ avisa
    latidoPrevio = { ultimoLatido: new Date().toISOString(), estado: 'ok', detalle: guardado };
    avisoSale = true; alertarOperador.mockClear();
    await llamar();
    expect(alertarOperador).toHaveBeenCalledWith('guardia.incidente_nuevo', expect.anything());
  });

  it('bandeja vacía: ningún aviso y latido ok', async () => {
    const r = await llamar();
    expect(await j(r)).toMatchObject({ corrio: true, parcial: false, nuevos: 0 });
    expect(alertarOperador).not.toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('guardia', 'ok', expect.anything());
  });

  it('base inalcanzable: 500, latido `fallo` y UN aviso por racha (la segunda pasada ciega calla)', async () => {
    clasificacion = new Error('connection refused');
    const r = await llamar();
    expect(r.status).toBe(500);
    expect(alertarOperador).toHaveBeenCalledWith('guardia.base_inalcanzable', expect.objectContaining({ codigo: 'guardia_base_inalcanzable' }));
    const guardado = registrarLatido.mock.calls.find((c) => c[0] === 'guardia')?.[2] as Record<string, unknown>;
    expect(registrarLatido).toHaveBeenCalledWith('guardia', 'fallo', expect.objectContaining({ baseCaidaDesde: expect.any(String) }));
    latidoPrevio = { ultimoLatido: new Date().toISOString(), estado: 'fallo', detalle: guardado };
    alertarOperador.mockClear();
    await llamar();
    expect(alertarOperador).not.toHaveBeenCalled();
  });

  it('cuando la base vuelve, avisa que volvió', async () => {
    latidoPrevio = { ultimoLatido: new Date().toISOString(), estado: 'fallo', detalle: { vistos: [], baseCaidaDesde: '2026-10-03T00:00:00Z' } };
    await llamar();
    expect(alertarOperador).toHaveBeenCalledWith('guardia.base_volvio', expect.anything());
  });
});

describe('los componentes de /estado', () => {
  it('mide lo que se pudo medir y escribe UNA medición por componente; el latido lleva el estado actual', async () => {
    const r = await llamar();
    expect((await j(r)).componentes).toEqual({ app: 'ok', base: 'ok', crons: 'ok', whatsapp: 'ok', correo: 'ok' });
    expect(registrarEstado.mock.calls.map((c) => c.join(':')).sort()).toEqual(['app:ok', 'base:ok', 'correo:ok', 'crons:ok', 'whatsapp:ok']);
    const detalle = registrarLatido.mock.calls.find((c) => c[0] === 'guardia')?.[2] as { componentes: Record<string, string> };
    expect(detalle.componentes.whatsapp).toBe('ok');
  });

  it('lo que NO se midió no se escribe (nada de oks inventados): sin latido de WhatsApp, whatsapp queda fuera', async () => {
    latidos = { 'buzon-entrega': ok };
    await llamar();
    expect(registrarEstado.mock.calls.some((c) => c[0] === 'whatsapp')).toBe(false);
  });

  it('la app sin respuesta por la URL pública: app caída, aviso al operador, y no se inventa la base', async () => {
    sondeo = { respondio: false, httpStatus: null, status: null, db: null, crons: null, migracionAlDia: null };
    await llamar();
    expect(registrarEstado).toHaveBeenCalledWith('app', 'caido');
    expect(registrarEstado.mock.calls.some((c) => c[0] === 'base')).toBe(false);
    expect(alertarOperador).toHaveBeenCalledWith('guardia.app_sin_respuesta', expect.anything());
  });

  it('si una escritura de estado falla, el latido es `parcial` (no «ok» limpio)', async () => {
    registrarEstado.mockResolvedValueOnce(false);
    await llamar();
    expect(registrarLatido).toHaveBeenCalledWith('guardia', 'parcial', expect.anything());
  });
});

describe('la retención diaria', () => {
  it('corre SOLO entre las 3:00 y las 3:04 de México, una vez al día', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
    await llamar();
    expect(purgarObservabilidad).not.toHaveBeenCalled();
    vi.setSystemTime(new Date('2026-10-03T09:02:00Z')); // 3:02 hora de México
    await llamar();
    expect(purgarObservabilidad).toHaveBeenCalledTimes(1);
    expect(registrarLatido).toHaveBeenLastCalledWith('guardia', 'ok', expect.objectContaining({ mantenimiento: { latencias: 12, estados: 0, parcial: false } }));
  });
  it('si la retención falla, no tumba la guardia: latido `parcial` con el motivo', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T09:02:00Z'));
    purgarObservabilidad.mockRejectedValueOnce(new Error('timeout'));
    const r = await llamar();
    expect((await j(r)).corrio).toBe(true);
    expect(registrarLatido).toHaveBeenLastCalledWith('guardia', 'parcial', expect.objectContaining({ mantenimiento: { error: 'timeout' } }));
  });
});
