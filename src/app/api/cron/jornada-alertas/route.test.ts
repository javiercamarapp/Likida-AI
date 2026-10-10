import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL CRON DE LA ALERTA DE TOPE DE JORNADA — su contrato, fijado por prueba.
//
// A diferencia de `cron/jornada` (que no manda un mensaje), este LE ESCRIBE A
// PERSONAS: avisa a un encargado y a un operador que una jornada se acerca al
// tope. Hereda las reglas de los crons que mandan WhatsApp:
//
//   · sin CRON_SECRET no corre — la puerta rebota antes de tocar nada;
//   · interruptor global ilegible → 500 (NUNCA 200: «no sé si está apagado» no
//     es permiso para mandar mensajes) con latido `fallo` y su código;
//   · interruptor apagado → latido `saltado`, sin avisar a nadie;
//   · `venceEn` SE LE PASA al motor y cabe en el `maxDuration` de la ruta;
//   · una corrida que no cerró su trabajo (corte por reloj, lista truncada,
//     rechazo masivo) o con fallos de jornadas sueltas → latido `parcial`, y
//     los números VIAJAN EN EL CUERPO, no solo en el log;
//   · el rechazo masivo de WhatsApp además avisa al operador de la plataforma;
//   · el motor reventado → latido `fallo`, aviso al operador y 500;
//   · el latido se escribe en TODO camino de salida (el `finally`).
// ═══════════════════════════════════════════════════════════════════════════

let interruptor: 'encendido' | 'apagado' | 'ilegible' = 'encendido';
vi.mock('@/lib/likida/interruptores', () => ({ leerInterruptor: async () => interruptor }));

const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger }));

const registrarLatido = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/admin/salud', () => ({
  registrarLatido: (...a: unknown[]) => registrarLatido(...a),
  puertaCron: async (_c: string, req: Request) =>
    req.headers.get('authorization') === 'Bearer secreto-de-prueba' ? null : new Response(null, { status: 401 }),
}));

interface ResultadoFalso {
  revisadas: number; enCurso: number; sinInicio: number; inicioEnFuturo: number; sinCierreProbable: number; bajoUmbral: number;
  yaAvisadas: number; alertas: { aviso: number; critico: number; exceso: number }; sinDestinatario: number;
  rechazosReintentables: number; cortadosPorReloj: number; listaTruncada: boolean; cortadaPorRechazoMasivo: boolean; fallos: string[];
}
const CORRIDA_LIMPIA: ResultadoFalso = {
  revisadas: 5, enCurso: 4, sinInicio: 1, inicioEnFuturo: 0, sinCierreProbable: 0, bajoUmbral: 2, yaAvisadas: 1,
  alertas: { aviso: 1, critico: 0, exceso: 0 }, sinDestinatario: 0, rechazosReintentables: 0, cortadosPorReloj: 0,
  listaTruncada: false, cortadaPorRechazoMasivo: false, fallos: [],
};
const correrAlertasTope = vi.fn(async (..._a: unknown[]): Promise<ResultadoFalso> => ({ ...CORRIDA_LIMPIA }));
vi.mock('@/lib/likida/jornada/alerta_tope', () => ({ correrAlertasTope: (...a: unknown[]) => correrAlertasTope(...a) }));
// Los puertos reales tocan la base: aquí basta con que existan (el motor es un doble).
vi.mock('@/lib/likida/jornada/alerta_tope_datos', () => ({ puertosAlertaReales: { marca: 'puertos-reales' } }));

const alertarOperador = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...a) }));
vi.mock('@/lib/observability/sentry', () => ({ codigoDeError: () => 'codigo-prueba' }));

import { GET } from './route';

const CON_SECRETO = { headers: { authorization: 'Bearer secreto-de-prueba' } };
const URL_CRON = 'https://likida.ai/api/cron/jornada-alertas';

describe('cron jornada-alertas — puerta, palanca, reloj y contrato de fallo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    interruptor = 'encendido';
    correrAlertasTope.mockResolvedValue({ ...CORRIDA_LIMPIA });
  });

  it('sin el CRON_SECRET no corre: la puerta rebota antes de tocar el motor ni el latido', async () => {
    const res = await GET(new Request(URL_CRON));
    expect(res.status).toBe(401);
    expect(correrAlertasTope).not.toHaveBeenCalled();
    expect(registrarLatido).not.toHaveBeenCalled();
  });

  it('ILEGIBLE: 500 y no 200 — falla cerrado, no avisa a nadie y deja latido `fallo` con su código', async () => {
    interruptor = 'ilegible';
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ corrio: false, codigo: 'interruptor_ilegible', interruptor: 'global' });
    expect(correrAlertasTope).not.toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('jornada-alertas', 'fallo', { codigo: 'interruptor_ilegible' });
  });

  it('APAGADO: 200, latido `saltado` y ni un mensaje', async () => {
    interruptor = 'apagado';
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ corrio: false, saltado: 'interruptor global' });
    expect(correrAlertasTope).not.toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('jornada-alertas', 'saltado', { interruptor: 'global' });
  });

  it('usa los puertos reales y le PASA `venceEn` al motor: un instante FUTURO que cabe en el maxDuration', async () => {
    const antes = Date.now();
    await GET(new Request(URL_CRON, CON_SECRETO));
    expect(correrAlertasTope).toHaveBeenCalledTimes(1);
    const [puertos, opts] = correrAlertasTope.mock.calls[0] as [unknown, { venceEn?: number }];
    expect(puertos).toEqual({ marca: 'puertos-reales' });
    expect(typeof opts.venceEn).toBe('number');
    expect(opts.venceEn).toBeGreaterThan(antes);
    // maxDuration 60 s menos el margen de 12 s que deja para el latido y el cierre de la respuesta.
    expect(opts.venceEn!).toBeLessThanOrEqual(antes + 48_000 + 50);
  });

  it('corrida limpia: 200, latido `ok` con los conteos y los conteos en el cuerpo', async () => {
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ corrio: true, revisadas: 5, alertas: { aviso: 1, critico: 0, exceso: 0 }, yaAvisadas: 1 });
    expect(registrarLatido).toHaveBeenCalledWith('jornada-alertas', 'ok', expect.objectContaining({ revisadas: 5, enCurso: 4, alertas: { aviso: 1, critico: 0, exceso: 0 }, fallos: 0 }));
    expect(alertarOperador).not.toHaveBeenCalled();
  });

  it('`cortadosPorReloj > 0` → latido `parcial`, y el número viaja EN EL CUERPO', async () => {
    correrAlertasTope.mockResolvedValueOnce({ ...CORRIDA_LIMPIA, cortadosPorReloj: 9 });
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ cortadosPorReloj: 9 });
    expect(registrarLatido).toHaveBeenCalledWith('jornada-alertas', 'parcial', expect.objectContaining({ cortadosPorReloj: 9 }));
  });

  it('`listaTruncada` → latido `parcial` y se dice en el cuerpo (un tope de lista no se recupera solo)', async () => {
    correrAlertasTope.mockResolvedValueOnce({ ...CORRIDA_LIMPIA, listaTruncada: true });
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(await res.json()).toMatchObject({ listaTruncada: true });
    expect(registrarLatido).toHaveBeenCalledWith('jornada-alertas', 'parcial', expect.objectContaining({ listaTruncada: true }));
  });

  it('fallos de jornadas sueltas → `parcial` (la corrida siguió), con el conteo y una muestra de a lo más 20 en el cuerpo', async () => {
    const fallos = Array.from({ length: 30 }, (_, i) => `jornada j${i}: no se pudo leer el expediente`);
    correrAlertasTope.mockResolvedValueOnce({ ...CORRIDA_LIMPIA, fallos });
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(res.status).toBe(200);
    const cuerpo = await res.json() as { fallos: string[] };
    expect(cuerpo.fallos).toHaveLength(20);
    expect(registrarLatido).toHaveBeenCalledWith('jornada-alertas', 'parcial', expect.objectContaining({ fallos: 30 }));
  });

  it('rechazo masivo de WhatsApp → `parcial`, motivo en el latido y aviso al operador de la plataforma', async () => {
    correrAlertasTope.mockResolvedValueOnce({ ...CORRIDA_LIMPIA, cortadaPorRechazoMasivo: true, rechazosReintentables: 5, fallos: ['jornada j1 (aviso): rate limit (se reintenta en la siguiente corrida)'] });
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(res.status).toBe(200);
    expect(registrarLatido).toHaveBeenCalledWith('jornada-alertas', 'parcial', expect.objectContaining({ rechazosReintentables: 5, motivo: expect.stringContaining('rechazó varios avisos') }));
    expect(alertarOperador).toHaveBeenCalledWith('cron.jornada_alertas', expect.objectContaining({ codigo: 'wa_rechazo_masivo' }));
  });

  it('motor reventado (p. ej. no se pudo leer la lista) → latido `fallo`, aviso al operador y 500, nunca un verde', async () => {
    correrAlertasTope.mockRejectedValueOnce(new Error('jornada.alerta.candidatas: respuesta inválida'));
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ corrio: false, codigo: 'codigo-prueba' });
    expect(alertarOperador).toHaveBeenCalledWith('cron.jornada_alertas', expect.objectContaining({ codigo: 'codigo-prueba' }));
    expect(registrarLatido).toHaveBeenCalledWith('jornada-alertas', 'fallo', expect.objectContaining({ codigo: 'codigo-prueba' }));
    expect(registrarLatido).toHaveBeenCalledTimes(1);
  });
});
