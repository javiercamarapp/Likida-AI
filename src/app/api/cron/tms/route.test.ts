import { describe, it, expect, vi, beforeEach } from 'vitest';

// El cron del sincronizador. Lo que se fija es su CONTRATO operativo, el mismo de sus hermanos: secreto o 401/500,
// la palanca global respetada (y falla CERRADO si no se puede leer), y un latido en TODO camino de salida. El trabajo
// real (sincronizar) se prueba en `conectores/tms/sincronizar.test.ts`; aquí se sustituye.

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
const sincronizar = vi.fn();
vi.mock('@/lib/likida/conectores/tms/sincronizar', () => ({ depsReales: () => ({}), sincronizarTms: (...a: unknown[]) => sincronizar(...a) }));
const alertarOperador = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...a) }));
vi.mock('@/lib/observability/sentry', () => ({ codigoDeError: () => 'cod' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { GET } = await import('./route');
const llamar = () => GET(new Request('https://app.likida.ai/api/cron/tms'));
const j = async (r: Response) => (await r.json()) as Record<string, unknown>;

const resumen = (extra: Record<string, unknown> = {}) => ({
  flotas: [], filasPorRecurso: { liquidaciones: 0, peajes: 0, viajes: 0, posiciones: 0 },
  peticiones: 0, renovados401: 0, conError: 0, parciales: 0, sinTurno: 0, alarmas: 0, atrasadas: [], ...extra,
});

beforeEach(() => {
  autorizado = 'si'; interruptores = {};
  sincronizar.mockReset(); registrarLatido.mockClear(); alertarOperador.mockClear();
  sincronizar.mockResolvedValue(resumen());
});

describe('la puerta', () => {
  it('sin secreto o con secreto malo no corre nada', async () => {
    autorizado = 'no';
    expect((await llamar()).status).toBe(401);
    autorizado = 'sin_secreto';
    expect((await llamar()).status).toBe(500);
    expect(sincronizar).not.toHaveBeenCalled();
  });

  it('la puerta REAL de este cron: con CRON_SECRET puesto, una petición sin el secreto es 401 y sin CRON_SECRET es 500', async () => {
    const real = await vi.importActual<typeof import('@/lib/admin/salud')>('@/lib/admin/salud');
    const previo = process.env.CRON_SECRET;
    try {
      process.env.CRON_SECRET = 'secreto-sintetico';
      const sin = await real.puertaCron('tms', new Request('https://app.likida.ai/api/cron/tms'), '');
      expect(sin?.status).toBe(401);
      const con = await real.puertaCron('tms', new Request('https://app.likida.ai/api/cron/tms', { headers: { authorization: 'Bearer secreto-sintetico' } }), '');
      expect(con).toBeNull();
      delete process.env.CRON_SECRET;
      const sinSecreto = await real.puertaCron('tms', new Request('https://app.likida.ai/api/cron/tms'), '');
      expect(sinSecreto?.status).toBe(500);
    } finally {
      if (previo === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previo;
    }
  });
});

describe('la palanca global', () => {
  it('apagada → no corre, 200 con `saltado` y DEJA LATIDO `saltado`', async () => {
    interruptores = { global: 'apagado' };
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(await j(r)).toMatchObject({ corrio: false, saltado: expect.stringContaining('global') });
    expect(sincronizar).not.toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('tms', 'saltado', { interruptor: 'global' });
  });

  it('ILEGIBLE → falla CERRADO (500) con latido `fallo`', async () => {
    interruptores = { global: 'ilegible' };
    const r = await llamar();
    expect(r.status).toBe(500);
    expect(await j(r)).toMatchObject({ codigo: 'interruptor_ilegible' });
    expect(sincronizar).not.toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('tms', 'fallo', { codigo: 'interruptor_ilegible' });
  });
});

describe('la corrida', () => {
  it('sin flotas configuradas: ok, `flotas: 0`, y no es una alarma', async () => {
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(await j(r)).toMatchObject({ corrio: true, flotas: 0, conError: 0 });
    expect(registrarLatido).toHaveBeenCalledWith('tms', 'ok', expect.objectContaining({ flotas: 0 }));
    expect(alertarOperador).not.toHaveBeenCalled();
  });

  it('con filas leídas y sin fallos: latido ok con las métricas por recurso, 401 renovados y peticiones', async () => {
    sincronizar.mockResolvedValue(resumen({
      flotas: [{ tenantId: 't1', credencialRechazada: false, recursos: [{ recurso: 'viajes', estado: 'ok', leidas: 10, nuevas: 10, omitidas: 0, entregadas: 10, rechazadas: 0, pendientes: 0, conflictos: 0, backlog: false }] }],
      filasPorRecurso: { liquidaciones: 20, peajes: 0, viajes: 10, posiciones: 100 }, peticiones: 14, renovados401: 1,
    }));
    const r = await llamar();
    const cuerpo = await j(r);
    expect(cuerpo).toMatchObject({ corrio: true, flotas: 1, filas: { liquidaciones: 20, viajes: 10, posiciones: 100 }, peticiones: 14, renovados401: 1 });
    expect(registrarLatido).toHaveBeenCalledWith('tms', 'ok', expect.objectContaining({ filas: { liquidaciones: 20, peajes: 0, viajes: 10, posiciones: 100 }, peticiones: 14, renovados401: 1 }));
  });

  it.each([
    ['un recurso con error', { conError: 1 }],
    ['una lectura a medias', { parciales: 1 }],
    ['una flota sin turno por el reloj', { sinTurno: 1 }],
    ['una credencial rechazada', { alarmas: 1 }],
  ])('%s → latido `parcial`, no `ok`', async (_n, extra) => {
    sincronizar.mockResolvedValue(resumen(extra));
    await llamar();
    expect(registrarLatido).toHaveBeenCalledWith('tms', 'parcial', expect.anything());
  });

  it('el cuerpo no lleva credenciales: solo conteos y frases', async () => {
    sincronizar.mockResolvedValue(resumen({
      flotas: [{ tenantId: 't1', credencialRechazada: true, recursos: [{ recurso: 'viajes', estado: 'error', leidas: 0, nuevas: 0, omitidas: 0, entregadas: 0, rechazadas: 0, pendientes: 0, conflictos: 0, backlog: false, error: 'El sistema rechazó el usuario o la contraseña.' }] }],
      alarmas: 1,
    }));
    const texto = JSON.stringify(await j(await llamar()));
    expect(texto).not.toMatch(/clave-sintetica|token|authorization/i);
    expect(texto).toContain('rechazó el usuario');
  });

  it('una excepción inesperada → 500, alerta al operador y latido `fallo`', async () => {
    sincronizar.mockRejectedValue(new Error('la base no contestó'));
    const r = await llamar();
    expect(r.status).toBe(500);
    expect(await j(r)).toMatchObject({ corrio: false, error: 'la base no contestó' });
    expect(alertarOperador).toHaveBeenCalledWith('cron.tms', expect.objectContaining({ error: 'la base no contestó' }));
    expect(registrarLatido).toHaveBeenCalledWith('tms', 'fallo', expect.anything());
  });

  it('le pasa a la corrida un reloj (`venceEn`) dentro del maxDuration', async () => {
    await llamar();
    const opciones = sincronizar.mock.calls[0][1] as { venceEn: number };
    expect(opciones.venceEn).toBeGreaterThan(Date.now());
    expect(opciones.venceEn).toBeLessThan(Date.now() + 120_000);
  });
});

describe('A37-TRANSVERSAL-08: flota atrasada', () => {
  it('avisa al operador (solo ids) cuando una flota se queda sin turno y lleva horas sin lectura exitosa', async () => {
    sincronizar.mockResolvedValue(resumen({ sinTurno: 1, atrasadas: ['flota-sintetica-9'] }));
    const r = await llamar();
    expect((await j(r)).flotasAtrasadas).toBe(1);
    expect(alertarOperador).toHaveBeenCalledWith('cron.tms.flota_atrasada', { flotas: ['flota-sintetica-9'], total: 1 });
  });
  it('sin flotas atrasadas no avisa', async () => {
    await llamar();
    expect(alertarOperador).not.toHaveBeenCalled();
  });
});
