import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL CRON DEL RELOJ MUERTO OBEDECE LA PALANCA DESDE SU PRIMER DÍA.
//
// La lección del PR #80 (wa-outbox nació sin leer el interruptor y fue el
// único de 7 crons que seguía mandando con el sistema apagado) no se repite:
// este cron nace con el contrato de la palanca fijado por prueba, palabra por
// palabra el de los demás — apagado → 200 saltado sin tocar nada; ilegible →
// 500 con código sin tocar nada; encendido → escala.
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

const escalarAsistenciasPendientes = vi.fn(async () => ({
  revisadas: 2, escaladas: 1, diferidas: 1, fallosAviso: 0, cortadosPorReloj: 0,
}));
vi.mock('@/lib/likida/asistencia_escalamiento', () => ({
  escalarAsistenciasPendientes: (...a: unknown[]) => escalarAsistenciasPendientes(...(a as [])),
}));

const alertarOperador = vi.fn(async () => {});
vi.mock('@/lib/observability/alerta', () => ({
  alertarOperador: (...a: unknown[]) => alertarOperador(...(a as [])),
}));
vi.mock('@/lib/observability/sentry', () => ({ codigoDeError: () => 'codigo-prueba' }));

import { GET } from './route';

const CON_SECRETO = { headers: { authorization: 'Bearer secreto-de-prueba' } };
const URL_CRON = 'https://likida.ai/api/cron/asistencia';

describe('cron asistencia — kill switch y contrato de fallo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    interruptor = 'encendido';
  });

  it('APAGADO: no escala nada — 200 con saltado, latido saltado', async () => {
    interruptor = 'apagado';
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(escalarAsistenciasPendientes).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ corrio: false, saltado: 'interruptor global' });
    expect(registrarLatido).toHaveBeenCalledWith('asistencia', 'saltado', expect.anything());
  });

  it('ILEGIBLE: 500 con código, y no escala — "no sé si está apagado" no es permiso', async () => {
    interruptor = 'ilegible';
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(escalarAsistenciasPendientes).not.toHaveBeenCalled();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ codigo: 'interruptor_ilegible', interruptor: 'global' });
  });

  it('ENCENDIDO: escala y reporta el conteo; con trabajo diferido/fallos el latido es parcial', async () => {
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ escaladas: 1, diferidas: 1 });
    expect(registrarLatido).toHaveBeenCalledWith('asistencia', 'ok', expect.anything());
  });

  it('motor reventado → 500 y alerta, nunca un verde de mentira', async () => {
    escalarAsistenciasPendientes.mockRejectedValueOnce(new Error('boom'));
    const res = await GET(new Request(URL_CRON, CON_SECRETO));
    expect(res.status).toBe(500);
    expect(alertarOperador).toHaveBeenCalled();
    expect(registrarLatido).toHaveBeenCalledWith('asistencia', 'fallo', expect.anything());
  });

  it('sin secreto no corre', async () => {
    const res = await GET(new Request(URL_CRON));
    expect(res.status).toBe(401);
    expect(escalarAsistenciasPendientes).not.toHaveBeenCalled();
  });

  it('fallosAviso > 0 → latido parcial (un aviso que no salió no es una corrida sana)', async () => {
    escalarAsistenciasPendientes.mockResolvedValueOnce({
      revisadas: 1, escaladas: 1, diferidas: 0, fallosAviso: 1, cortadosPorReloj: 0,
    });
    await GET(new Request(URL_CRON, CON_SECRETO));
    expect(registrarLatido).toHaveBeenCalledWith('asistencia', 'parcial', expect.anything());
  });
});
