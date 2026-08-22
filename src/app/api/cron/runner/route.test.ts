import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL LATIDO DEL RUNNER — lo que se fija:
//  · sin CRON_SECRET: 500; secreto incorrecto: 401 — y el runner no corre.
//  · si el runner truena: 500 (Vercel lo pinta rojo), log con `codigo`
//    estable (Sentry notifica por causa nueva) y correo al operador
//    (AUDITORÍA 18, M15: era el único cron sin las dos cosas).
// ═══════════════════════════════════════════════════════════════════════════

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));
const correrRunner = vi.fn(async () => ({ apagadoGlobal: false, agentes: [] as Array<{ agente: string; resultado: string; piezas: number; motivo?: string }> }));
vi.mock('@/lib/likida/agentes/runner', () => ({ correrRunner: () => correrRunner() }));
const alertarOperador = vi.fn(async (_e: string, _d: Record<string, unknown>) => { void _e; void _d; });
vi.mock('@/lib/observability/alerta', () => ({
  alertarOperador: (e: string, d: Record<string, unknown>) => alertarOperador(e, d),
}));

const { GET } = await import('./route');

const peticion = (auth?: string) =>
  new Request('https://app.likida.ai/api/cron/runner', { headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  process.env.CRON_SECRET = 'secreto-de-prueba';
  correrRunner.mockClear(); alertarOperador.mockClear(); logger.error.mockClear();
});

describe('la puerta', () => {
  it('sin CRON_SECRET: 500 y no corre', async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(peticion('Bearer x'))).status).toBe(500);
    expect(correrRunner).not.toHaveBeenCalled();
  });
  it('secreto incorrecto: 401 y no corre', async () => {
    expect((await GET(peticion('Bearer otro'))).status).toBe(401);
    expect(correrRunner).not.toHaveBeenCalled();
  });
});

describe('la corrida', () => {
  it('sana: 200 con el resultado, sin alerta', async () => {
    const r = await GET(peticion('Bearer secreto-de-prueba'));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ apagadoGlobal: false });
    expect(alertarOperador).not.toHaveBeenCalled();
  });

  it('que truena: 500, log con codigo estable y correo al operador', async () => {
    correrRunner.mockRejectedValueOnce(Object.assign(new Error('relation "agente" does not exist'), { code: '42P01' }));
    const r = await GET(peticion('Bearer secreto-de-prueba'));
    expect(r.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith('cron.runner.fallo', expect.objectContaining({ codigo: '42P01' }));
    expect(alertarOperador).toHaveBeenCalledWith('cron.runner', expect.objectContaining({ codigo: '42P01', error: expect.stringContaining('agente') }));
  });

  it('dos causas distintas dan dos códigos distintos (dos issues, dos notificaciones)', async () => {
    correrRunner.mockRejectedValueOnce(new Error('token vencido'));
    await GET(peticion('Bearer secreto-de-prueba'));
    correrRunner.mockRejectedValueOnce(new TypeError('x is not a function'));
    await GET(peticion('Bearer secreto-de-prueba'));
    const codigos = logger.error.mock.calls.map((c) => (c[1] as { codigo: string }).codigo);
    expect(codigos).toHaveLength(2);
    expect(codigos[0]).not.toBe(codigos[1]);
  });
});
