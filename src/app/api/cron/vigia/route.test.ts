import { describe, it, expect, vi, beforeEach } from 'vitest';

// El barrido del Vigía. Se fija su CONTRATO operativo, el mismo de sus hermanos:
// secreto o 401/500, la palanca global respetada (y falla CERRADO si no se puede
// leer), latido en TODO camino de salida, y que un barrido parcial no se reporte
// como «ok» limpio.

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
vi.mock('@/lib/likida/interruptores', () => ({ leerInterruptor: async () => global }));
const base = { revisadas: 3, escaladas: 1, duplicadas: 0, sinDestinatario: 0, fallosEnvio: 0, atorados: 0, purgadas: 0, cortadoPorReloj: false };
const barrido = vi.fn(async (..._a: unknown[]) => ({ ...base }));
vi.mock('@/lib/likida/vigia/servicio', () => ({ barridoVigia: (...a: unknown[]) => barrido(...a) }));
vi.mock('@/lib/likida/vigia/deps', () => ({ crearDepsVigia: () => ({ repo: 'repo' }) }));
const alertarOperador = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...a) }));
vi.mock('@/lib/observability/sentry', () => ({ codigoDeError: () => 'cod' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { GET } = await import('./route');
const llamar = () => GET(new Request('https://app.likida.ai/api/cron/vigia'));
const j = async (r: Response) => (await r.json()) as Record<string, unknown>;

beforeEach(() => {
  autorizado = 'si'; global = 'encendido';
  barrido.mockReset(); registrarLatido.mockClear(); alertarOperador.mockClear();
  barrido.mockResolvedValue({ ...base });
});

describe('la puerta y las palancas', () => {
  it('sin secreto o con secreto malo no corre nada', async () => {
    autorizado = 'no';
    expect((await llamar()).status).toBe(401);
    autorizado = 'sin_secreto';
    expect((await llamar()).status).toBe(500);
    expect(barrido).not.toHaveBeenCalled();
  });
  it('global apagada: no corre, 200 con `saltado` y latido `saltado`', async () => {
    global = 'apagado';
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(await j(r)).toMatchObject({ corrio: false, saltado: expect.stringContaining('global') });
    expect(barrido).not.toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('vigia', 'saltado', { interruptor: 'global' });
  });
  it('global ILEGIBLE: falla CERRADO (500) con latido `fallo`', async () => {
    global = 'ilegible';
    const r = await llamar();
    expect(r.status).toBe(500);
    expect(await j(r)).toMatchObject({ codigo: 'interruptor_ilegible' });
    expect(barrido).not.toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('vigia', 'fallo', { codigo: 'interruptor_ilegible' });
  });
});

describe('la corrida', () => {
  it('éxito: latido ok con el resumen, y se le da al barrido un reloj que vence antes del límite de la función', async () => {
    const antes = Date.now();
    const r = await llamar();
    expect(await j(r)).toMatchObject({ corrio: true, revisadas: 3, escaladas: 1 });
    expect(registrarLatido).toHaveBeenCalledWith('vigia', 'ok', expect.objectContaining({ escaladas: 1 }));
    const opciones = barrido.mock.calls[0][1] as { vencePorReloj: number };
    expect(opciones.vencePorReloj).toBeGreaterThan(antes);
    expect(opciones.vencePorReloj).toBeLessThan(antes + 60_000);
  });
  it('el mantenimiento (atorados, ciclos muertos, retención) corre solo en los minutos múltiplo de 5; la vigilancia de clientes, siempre', async () => {
    vi.useFakeTimers();
    try {
      for (const [hora, esperado] of [['2026-10-02T12:10:00Z', true], ['2026-10-02T12:11:00Z', false], ['2026-10-02T12:14:59Z', false], ['2026-10-02T12:15:00Z', true]] as const) {
        vi.setSystemTime(new Date(hora));
        barrido.mockClear();
        await llamar();
        expect((barrido.mock.calls[0][1] as { mantenimiento: boolean }).mantenimiento, hora).toBe(esperado);
      }
    } finally { vi.useRealTimers(); }
  });
  it('barrido parcial (corte por reloj, envíos fallidos, atorados): latido `parcial`, no «ok»', async () => {
    for (const parcial of [{ cortadoPorReloj: true }, { fallosEnvio: 2 }, { atorados: 1 }]) {
      registrarLatido.mockClear();
      barrido.mockResolvedValue({ ...base, ...parcial });
      await llamar();
      expect(registrarLatido).toHaveBeenCalledWith('vigia', 'parcial', expect.anything());
    }
  });
  it('si el barrido lanza: 500, alerta al operador y latido `fallo`', async () => {
    barrido.mockRejectedValue(new Error('base caída'));
    const r = await llamar();
    expect(r.status).toBe(500);
    expect(await j(r)).toMatchObject({ corrio: false, error: 'base caída' });
    expect(alertarOperador).toHaveBeenCalledWith('cron.vigia', expect.objectContaining({ error: 'base caída' }));
    expect(registrarLatido).toHaveBeenCalledWith('vigia', 'fallo', expect.objectContaining({ error: 'base caída' }));
  });
});
