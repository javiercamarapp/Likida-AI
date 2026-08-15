import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL CRON DE MANTENIMIENTO — no tenía pruebas y BORRA FILAS: era el único de
// los tres crons cuyo contrato (fallar cerrado sin secreto, error por valor
// de la RPC = 500, no un verde vacío) vivía solo en comentarios. Se fijan
// aquí junto con el cable nuevo del kill switch (0110): en un incidente donde
// Javier apaga todo, lo último que quiere es un cron borrando datos mientras
// investiga.
// ═══════════════════════════════════════════════════════════════════════════

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const alertarOperador = vi.fn(async () => {});
vi.mock('@/lib/observability/alerta', () => ({
  alertarOperador: (...a: unknown[]) => alertarOperador(...(a as [])),
}));

/** Lo que contesta la RPC `mantenimiento_de_datos`. */
let rpcRespuesta: { data: unknown; error: { message: string; code?: string } | null };
const rpc = vi.fn(async () => rpcRespuesta);
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ rpc: (...a: unknown[]) => rpc(...(a as [])) }),
}));

// El kill switch (0110). Default: sin fila = encendido (false).
const estaApagado = vi.fn(async (nombre: string) => nombre === '__ninguno_apagado__');
vi.mock('@/lib/likida/interruptores', () => ({
  estaApagado: (...a: unknown[]) => estaApagado(...(a as [string])),
}));

process.env.CRON_SECRET = 'secreto-de-prueba';
const { GET } = await import('./route');

const peticion = (auth?: string) => new Request('http://likida.test/api/cron/purgar', {
  headers: auth ? { authorization: auth } : {},
}) as never;

beforeEach(() => {
  rpcRespuesta = { data: { waPurgados: 3, llmCostoPurgado: false }, error: null };
  rpc.mockClear();
  alertarOperador.mockClear();
  estaApagado.mockReset().mockResolvedValue(false);
  for (const f of Object.values(logger)) f.mockReset();
});

describe('GET /api/cron/purgar — la puerta', () => {
  it('sin CRON_SECRET devuelve 500 y NO borra: un 200 dejaría el cron verde para siempre', async () => {
    const antes = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    const res = await GET(peticion());
    process.env.CRON_SECRET = antes;

    expect(res.status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('con el bearer equivocado, 401 sin cuerpo y sin tocar nada', async () => {
    const res = await GET(peticion('Bearer otro'));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    // Ni el interruptor se lee antes de la puerta.
    expect(estaApagado).not.toHaveBeenCalled();
  });
});

describe('la corrida', () => {
  it('con la base sana responde 200 y el detalle de la RPC tal cual', async () => {
    const res = await GET(peticion('Bearer secreto-de-prueba'));
    const cuerpo = await res.json();

    expect(res.status).toBe(200);
    expect(cuerpo).toEqual({ corrio: true, waPurgados: 3, llmCostoPurgado: false });
    expect(rpc).toHaveBeenCalledWith('mantenimiento_de_datos', { p_dias_wa: 30 });
  });

  it('un error POR VALOR de la RPC es 500 con alerta — no una purga verde que "no encontró nada"', async () => {
    rpcRespuesta = { data: null, error: { message: 'relation does not exist', code: '42P01' } };
    const res = await GET(peticion('Bearer secreto-de-prueba'));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('relation does not exist');
    expect(alertarOperador).toHaveBeenCalledWith('cron.purgar', expect.objectContaining({ codigo: expect.any(String) }));
  });
});

describe('el kill switch (0110)', () => {
  it("con 'global' apagado: 200 con {saltado} y la RPC de borrado NI SE LLAMA", async () => {
    estaApagado.mockResolvedValue(true);
    const res = await GET(peticion('Bearer secreto-de-prueba'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ corrio: false, saltado: 'interruptor global' });
    expect(rpc).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('cron.purgar.saltado', { interruptor: 'global' });
  });

  it('sin fila (el default) la purga corre — solo se consulta la palanca global', async () => {
    await GET(peticion('Bearer secreto-de-prueba'));
    expect(estaApagado.mock.calls.map((c) => c[0])).toEqual(['global']);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
