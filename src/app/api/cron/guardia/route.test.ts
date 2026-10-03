import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memoriaDeEstado, type ClasificacionGuardia } from '@/lib/admin/guardia';
import { huellaDeDetalle } from '@/lib/observability/alerta';

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
let lecturaLatido: 'ok' | 'falla' = 'ok';
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
    leerLatido: async () => { if (lecturaLatido === 'falla') throw new Error('base caída'); return latidoPrevio; },
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
vi.mock('@/lib/observability/alerta', async () => {
  const real = await vi.importActual<typeof import('@/lib/observability/alerta')>('@/lib/observability/alerta');
  return { ...real, alertarOperador: (...a: unknown[]) => alertarOperador(...a) };
});
vi.mock('@/lib/observability/sentry', () => ({ codigoDeError: () => 'cod' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { GET } = await import('./route');
const llamar = () => GET(new Request('https://app.likida.ai/api/cron/guardia'));
const j = async (r: Response) => (await r.json()) as Record<string, unknown>;
const ok = { estado: 'ok', ultimoEstado: 'ok' };

beforeEach(() => {
  autorizado = 'si'; global = 'encendido'; clasificacion = vacia; latidoPrevio = null; lecturaLatido = 'ok'; memoriaDeEstado.olvidar();
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
    sondeo = { ...sondeo, db: 'fallo' }; // la bandeja rota + el propio /api/health diciendo db=fallo = base inalcanzable
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

/** Una pasada, encadenando el detalle del latido que dejó como «el previo» de la siguiente (lo que hace la base real). */
async function pasar() {
  const r = await llamar();
  const l = registrarLatido.mock.calls.filter((c) => c[0] === 'guardia').at(-1);
  if (l && lecturaLatido === 'ok') latidoPrevio = { ultimoLatido: new Date().toISOString(), estado: String(l[1]), detalle: l[2] as Record<string, unknown> };
  return r;
}
const avisosApp = () => alertarOperador.mock.calls.filter((c) => c[0] === 'guardia.app_sin_respuesta');

describe('M6 (ronda 19): la bandeja rota con la base sana no es «base inalcanzable»', () => {
  it('aísla la bandeja: sigue al sondeo de health y registra el estado; latido parcial, 200, sin falso aviso de base', async () => {
    clasificacion = new Error('statement timeout');
    const r = await pasar();
    expect(r.status).toBe(200);
    expect(await j(r)).toMatchObject({ corrio: true, parcial: true, bandejaFallo: true });
    expect(registrarEstado).toHaveBeenCalledWith('app', 'ok');
    expect(registrarEstado).toHaveBeenCalledWith('base', 'ok');
    expect(alertarOperador).not.toHaveBeenCalledWith('guardia.base_inalcanzable', expect.anything());
    expect(registrarLatido).toHaveBeenCalledWith('guardia', 'parcial', expect.objectContaining({ rachaBandeja: 1 }));
  });
  it('si la bandeja sigue rota una segunda pasada, la guardia lo dice (está ciega para S1/S2), una vez', async () => {
    clasificacion = new Error('statement timeout');
    await pasar();
    expect(alertarOperador).not.toHaveBeenCalled();
    await pasar();
    expect(alertarOperador).toHaveBeenCalledWith('guardia.sin_vista', expect.objectContaining({ codigo: 'guardia_bandeja_fallo' }));
    alertarOperador.mockClear();
    await pasar();
    expect(alertarOperador).not.toHaveBeenCalled();
  });
});

describe('M4 (ronda 19): el estado de dedup no depende solo de la base', () => {
  it('con la base caída (lectura del latido falla) el aviso sale UNA vez por racha y, al volver, se emite «base volvió»', async () => {
    lecturaLatido = 'falla';
    clasificacion = new Error('connection refused');
    sondeo = { ...sondeo, db: 'fallo' };
    await pasar();
    await pasar();
    await pasar();
    expect(alertarOperador.mock.calls.filter((c) => c[0] === 'guardia.base_inalcanzable')).toHaveLength(1);
    // la base vuelve: se lee el latido (viejo, sin la caída porque durante ella no se pudo escribir) y la bandeja
    lecturaLatido = 'ok'; latidoPrevio = { ultimoLatido: new Date().toISOString(), estado: 'ok', detalle: {} };
    clasificacion = vacia; sondeo = { ...sondeo, db: 'ok' };
    alertarOperador.mockClear();
    await pasar();
    expect(alertarOperador).toHaveBeenCalledWith('guardia.base_volvio', expect.anything());
    await pasar();
    expect(alertarOperador.mock.calls.filter((c) => c[0] === 'guardia.base_volvio')).toHaveLength(1);
  });
});

describe('A3 (ronda 19): histéresis de la app', () => {
  const caida = { respondio: false, httpStatus: null, status: null, db: null, crons: null, migracionAlDia: null };
  const sana = { respondio: true, httpStatus: 200, status: 'ok', db: 'ok', crons: 'ok', migracionAlDia: true };

  it('un fallo AISLADO no avisa ni marca la app caída (ni en el latido ni en el día público)', async () => {
    sondeo = caida;
    await pasar();
    expect(avisosApp()).toHaveLength(0);
    expect(registrarEstado.mock.calls.some((c) => c[0] === 'app')).toBe(false);
    sondeo = sana;
    await pasar();
    expect(avisosApp()).toHaveLength(0);
    expect(registrarEstado).toHaveBeenCalledWith('app', 'ok');
  });

  it('dos fallos SEGUIDOS sí: avisa una vez y marca caído; sigue caída sin repetir el aviso', async () => {
    sondeo = caida;
    await pasar(); await pasar();
    expect(avisosApp()).toHaveLength(1);
    expect(registrarEstado).toHaveBeenCalledWith('app', 'caido');
    await pasar();
    expect(avisosApp()).toHaveLength(1);
  });

  it('un fallo, un sondeo sano y otro fallo NO suman (la racha se reinicia con el sano)', async () => {
    sondeo = caida; await pasar();
    sondeo = sana; await pasar();
    sondeo = caida; await pasar();
    expect(avisosApp()).toHaveLength(0);
  });

  it('una caída que vuelve y cae de nuevo DENTRO de la hora avisa otra vez: la huella (cual) cambia y el piso de 1 h no la silencia', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
    sondeo = caida; await pasar();
    vi.setSystemTime(new Date('2026-10-03T12:05:00Z')); await pasar();
    sondeo = sana; vi.setSystemTime(new Date('2026-10-03T12:10:00Z')); await pasar();
    sondeo = caida; vi.setSystemTime(new Date('2026-10-03T12:15:00Z')); await pasar();
    vi.setSystemTime(new Date('2026-10-03T12:20:00Z')); await pasar();
    const avisos = avisosApp();
    expect(avisos).toHaveLength(2);
    // el piso de alerta.ts parte la llave por huella del detalle: dos huellas distintas = dos alarmas aunque caigan en la misma hora
    expect(huellaDeDetalle(avisos[0][1] as Record<string, unknown>)).not.toBe(huellaDeDetalle(avisos[1][1] as Record<string, unknown>));
  });

  it('si el aviso de la caída no salió, se reintenta en la siguiente pasada (M5)', async () => {
    sondeo = caida; avisoSale = false;
    await pasar(); await pasar();
    expect(avisosApp()).toHaveLength(1);
    avisoSale = true;
    await pasar();
    expect(avisosApp()).toHaveLength(2);
    await pasar();
    expect(avisosApp()).toHaveLength(2);
  });
});

describe('A2 (ronda 19): health que contesta algo que no es health', () => {
  it('un 403 de firewall NO marca la app ok: queda sin medición y la guardia lo dice', async () => {
    sondeo = { respondio: true, httpStatus: 403, status: null, db: null, crons: null, migracionAlDia: null };
    const r = await pasar();
    expect(registrarEstado.mock.calls.some((c) => c[0] === 'app')).toBe(false);
    expect((await j(r)).componentes).toMatchObject({ app: null });
    expect(alertarOperador).toHaveBeenCalledWith('guardia.app_sin_medicion', expect.objectContaining({ status: '403' }));
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
    await pasar(); await pasar(); // A3: dos sondeos fallidos seguidos
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
