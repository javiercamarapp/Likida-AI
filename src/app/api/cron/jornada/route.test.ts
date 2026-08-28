import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL CRON QUE DERIVA EL REGISTRO DE JORNADA — su contrato, fijado por prueba.
//
// Este cron no manda un solo mensaje, así que la tentación de siempre es
// dejarlo contestar 200 pase lo que pase. Lo que produce es un DOCUMENTO
// LABORAL (LFT 132 fr. XXXIV): un cron verde que lleva semanas sin derivar
// deja huecos en el expediente que después nadie puede llenar. Por eso aquí se
// fija, palabra por palabra, lo mismo que en `cron/asistencia`:
//
//   · sin CRON_SECRET no corre — la puerta rebota antes de tocar nada;
//   · interruptor ilegible → 500, NUNCA 200: «no sé si está apagado» no es
//     permiso, y un 200 aquí se lee como una corrida sana;
//   · interruptor apagado → latido `saltado`, sin derivar;
//   · `venceEn` SE LE PASA al motor — regla de la casa: todo motor que itere
//     recibe y consulta el reloj de su corrida (patrón del PR #152 / ESC-3);
//   · trabajo que quedó pendiente (`cortadosPorReloj`) o ventana que no cupo
//     (`listaTruncada`) → latido `parcial`, y el número VIAJA EN EL CUERPO de
//     la respuesta, no solo en el log — el runner de producción ya murió mudo
//     dos veces por un motor que se quedaba sin turno sin que nadie se enterara;
//   · fallos o excepción → latido `fallo`, 500 y correo al operador.
// ═══════════════════════════════════════════════════════════════════════════

let interruptor: 'encendido' | 'apagado' | 'ilegible' = 'encendido';
vi.mock('@/lib/likida/interruptores', () => ({
  leerInterruptor: async () => interruptor,
}));

const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger }));

const registrarLatido = vi.fn(async () => {});
vi.mock('@/lib/admin/salud', () => ({
  registrarLatido: (...a: unknown[]) => registrarLatido(...(a as [])),
  puertaCron: async (_c: string, req: Request) =>
    req.headers.get('authorization') === 'Bearer secreto-de-prueba'
      ? null
      : new Response(null, { status: 401 }),
}));

interface ResultadoFalso {
  revisados: number;
  asentados: number;
  yaEstaban: number;
  fallos: string[];
  cortadosPorReloj: number;
  diasSinGps: number;
  listaTruncada: boolean;
}
const CORRIDA_LIMPIA: ResultadoFalso = {
  revisados: 3, asentados: 4, yaEstaban: 1, fallos: [],
  cortadosPorReloj: 0, diasSinGps: 0, listaTruncada: false,
};
const derivarJornadas = vi.fn(async (_a?: unknown): Promise<ResultadoFalso> => ({ ...CORRIDA_LIMPIA }));
// `PLAZO_DERIVACION_MS` se dobla con su valor real (45 s) porque la ruta lo
// usa para repartir el reloj: un valor inventado no probaría el reparto real.
vi.mock('@/lib/likida/jornada/derivar', () => ({
  derivarJornadas: (a?: unknown) => derivarJornadas(a),
  PLAZO_DERIVACION_MS: 45_000,
}));

const alertarOperador = vi.fn(async () => {});
vi.mock('@/lib/observability/alerta', () => ({
  alertarOperador: (...a: unknown[]) => alertarOperador(...(a as [])),
}));
vi.mock('@/lib/observability/sentry', () => ({ codigoDeError: () => 'codigo-prueba' }));

import { GET } from './route';

const CON_SECRETO = { headers: { authorization: 'Bearer secreto-de-prueba' } };
const URL_CRON = 'https://likida.ai/api/cron/jornada';

/** El único argumento con el que la ruta llamó al motor. */
function argumentoDelMotor(): { venceEn?: number } {
  expect(derivarJornadas).toHaveBeenCalledTimes(1);
  return (derivarJornadas.mock.calls[0][0] ?? {}) as { venceEn?: number };
}

describe('cron jornada — palanca, reloj y contrato de fallo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    interruptor = 'encendido';
    derivarJornadas.mockResolvedValue({ ...CORRIDA_LIMPIA });
  });

  it('sin el CRON_SECRET no corre: la puerta rebota antes de tocar el motor', async () => {
    const res = await GET(new Request(URL_CRON));
    expect(res.status).toBe(401);
    expect(derivarJornadas).not.toHaveBeenCalled();
  });

  it('ILEGIBLE: 500 y no 200 — falla cerrado, y no deriva nada', async () => {
    interruptor = 'ilegible';
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    // El 500 es el punto entero: un 200 aquí pintaría verde una corrida que
    // ni siquiera supo si el sistema estaba apagado.
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      corrio: false, codigo: 'interruptor_ilegible', interruptor: 'global',
    });
    expect(derivarJornadas).not.toHaveBeenCalled();
    expect(registrarLatido).not.toHaveBeenCalled();
  });

  it('APAGADO: latido `saltado` y ni una marca asentada', async () => {
    interruptor = 'apagado';
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ corrio: false, saltado: 'interruptor global' });
    expect(derivarJornadas).not.toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('jornada', 'saltado', expect.anything());
  });

  it('le PASA `venceEn` al motor, y es un instante FUTURO', async () => {
    // Regla de la casa: todo motor que itere recibe el reloj de su corrida y lo
    // consulta antes de tomar trabajo nuevo. Si la ruta dejara de pasarlo, el
    // motor barrería hasta que Vercel lo matara a media lista y el latido
    // nunca se escribiría — que es como el runner murió mudo dos veces.
    const antes = Date.now();
    await GET(new Request(URL_CRON, CON_SECRETO));
    const arg = argumentoDelMotor();
    expect(typeof arg.venceEn).toBe('number');
    expect(arg.venceEn).toBeGreaterThan(antes);
    // Y cabe dentro del `maxDuration` de la ruta (60 s) con el margen de 10 s
    // que deja para el latido y el cierre de la respuesta.
    expect(arg.venceEn!).toBeLessThanOrEqual(antes + 50_000);
  });

  it('corrida limpia: 200, latido `ok` y los conteos en el cuerpo', async () => {
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ asentados: 4, yaEstaban: 1, cortadosPorReloj: 0 });
    expect(registrarLatido).toHaveBeenCalledWith('jornada', 'ok', expect.anything());
  });

  it('`cortadosPorReloj > 0` → latido `parcial`, y el número viaja EN EL CUERPO', async () => {
    derivarJornadas.mockResolvedValueOnce({ ...CORRIDA_LIMPIA, cortadosPorReloj: 7 });
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    // Ni `ok` ni `fallo`: las dos son maneras de mentir sobre una corrida que
    // dejó trabajo sin tocar.
    expect(registrarLatido).toHaveBeenCalledWith('jornada', 'parcial', expect.objectContaining({
      cortadosPorReloj: 7,
    }));
    // EN EL CUERPO, no solo en el log: un log que nadie lee no avisa de nada.
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ cortadosPorReloj: 7 });
  });

  it('`listaTruncada` → latido `parcial` también, y se dice en el cuerpo', async () => {
    // El tope de la consulta NO se recupera solo, a diferencia del reloj: la
    // lista sale ordenada por `aceptado_en` ascendente, así que una ventana que
    // lo rebasa devuelve siempre los mismos viajes viejos y los recientes no se
    // derivan NUNCA. Un `ok` aquí sería un cron verde sobre un registro laboral
    // que se está quedando vacío.
    derivarJornadas.mockResolvedValueOnce({ ...CORRIDA_LIMPIA, listaTruncada: true });
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(registrarLatido).toHaveBeenCalledWith('jornada', 'parcial', expect.objectContaining({
      listaTruncada: true,
    }));
    expect(await res.json()).toMatchObject({ listaTruncada: true });
  });

  it('`fallos.length > 0` → latido `fallo` y HTTP 500', async () => {
    derivarJornadas.mockResolvedValueOnce({ ...CORRIDA_LIMPIA, fallos: ['expediente op-1/2026-08-20: se cayó'] });
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(res.status).toBe(500);
    expect(registrarLatido).toHaveBeenCalledWith('jornada', 'fallo', expect.anything());
    expect(logger.error).toHaveBeenCalledWith('cron.jornada.con_fallos', expect.anything());
  });

  it('un fallo GANA sobre el parcial: no se pinta ámbar una corrida que se rompió', async () => {
    derivarJornadas.mockResolvedValueOnce({
      ...CORRIDA_LIMPIA, fallos: ['gps u-1/2026-08-20: se cayó'], cortadosPorReloj: 2, listaTruncada: true,
    });
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(res.status).toBe(500);
    expect(registrarLatido).toHaveBeenCalledWith('jornada', 'fallo', expect.anything());
  });

  it('motor reventado → latido `fallo`, correo al operador y 500 (nunca un verde de mentira)', async () => {
    derivarJornadas.mockRejectedValueOnce(new Error('no se pudo leer la lista de trabajo'));
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ corrio: false, codigo: 'codigo-prueba' });
    expect(alertarOperador).toHaveBeenCalledWith('cron.jornada', expect.objectContaining({ codigo: 'codigo-prueba' }));
    expect(registrarLatido).toHaveBeenCalledWith('jornada', 'fallo', expect.objectContaining({ codigo: 'codigo-prueba' }));
  });
});
