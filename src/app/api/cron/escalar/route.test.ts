import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 3, OP-C1 (CRÍTICO): este cron respondía 200 con un motor entero
// reventado — así acumuló ~216 corridas "verdes" mientras el embed roto de
// la 0075 tumbaba la escalación cada hora. Estas pruebas fijan el contrato:
// motor caído = 500 (la plataforma cuenta el cron como FALLIDO); los dos
// motores corren AUNQUE el primero truene.
// ═══════════════════════════════════════════════════════════════════════════

const escalarViajesSinAceptar = vi.fn();
const ejecutarCobranzaGlobal = vi.fn();

vi.mock('@/lib/likida/escalar_viaje', () => ({
  escalarViajesSinAceptar: (...a: unknown[]) => escalarViajesSinAceptar(...a),
}));
vi.mock('@/lib/likida/agentes/cobranza', () => ({
  ejecutarCobranzaGlobal: (...a: unknown[]) => ejecutarCobranzaGlobal(...a),
}));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

// El canal de alerta al operador (auditoría 4, D1) se mockea: aquí se prueba
// que el cron LO DISPARA al fallar, no el canal mismo (ese vive en
// observability/alerta.test.ts).
const alertarOperador = vi.fn(async () => {});
vi.mock('@/lib/observability/alerta', () => ({
  alertarOperador: (...a: unknown[]) => alertarOperador(...(a as [])),
}));

process.env.CRON_SECRET = 'secreto-de-prueba';
const { GET } = await import('./route');

const peticion = (auth?: string) => new Request('http://likida.test/api/cron/escalar', {
  headers: auth ? { authorization: auth } : {},
}) as never;

describe('GET /api/cron/escalar — el cron ya no miente en verde', () => {
  beforeEach(() => {
    escalarViajesSinAceptar.mockReset().mockResolvedValue({ escalados: 0 });
    ejecutarCobranzaGlobal.mockReset().mockResolvedValue({ tenants: 0, contactados: 0, fallos: [] });
    alertarOperador.mockClear();
    logger.error.mockClear();
  });

  it('con los dos motores sanos responde 200 y no molesta al operador', async () => {
    const res = await GET(peticion('Bearer secreto-de-prueba'));
    expect(res.status).toBe(200);
    expect(alertarOperador).not.toHaveBeenCalled();
  });

  it('si la ESCALACIÓN revienta: 500, el error viaja en el cuerpo, y la cobranza CORRE igual', async () => {
    escalarViajesSinAceptar.mockRejectedValue(new Error('more than one relationship'));
    const res = await GET(peticion('Bearer secreto-de-prueba'));
    expect(res.status).toBe(500);
    const cuerpo = await res.json();
    expect(String((cuerpo.aceptacion as { error?: string }).error)).toContain('relationship');
    expect(ejecutarCobranzaGlobal).toHaveBeenCalledTimes(1);
    expect(cuerpo.comprobacion).toEqual({ tenants: 0, contactados: 0, fallos: [] });
    // D2: el fallo lleva `codigo` estable (discrimina la causa en el
    // fingerprint de Sentry). D1: la alerta al operador se dispara.
    expect(logger.error).toHaveBeenCalledWith('cron.escalar.falló', expect.objectContaining({ codigo: expect.stringMatching(/./) }));
    expect(alertarOperador).toHaveBeenCalledWith('cron.escalar', expect.objectContaining({ codigo: expect.any(String) }));
  });

  it('si la COBRANZA revienta: 500 también, con su propia alerta', async () => {
    ejecutarCobranzaGlobal.mockRejectedValue(new Error('se cayó'));
    const res = await GET(peticion('Bearer secreto-de-prueba'));
    expect(res.status).toBe(500);
    expect(alertarOperador).toHaveBeenCalledWith('cron.cobranza', expect.objectContaining({ codigo: expect.any(String) }));
  });

  it('sin el secreto correcto no corre nada', async () => {
    const res = await GET(peticion('Bearer equivocado'));
    expect(res.status).toBe(401);
    expect(escalarViajesSinAceptar).not.toHaveBeenCalled();
  });
});
