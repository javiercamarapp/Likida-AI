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

// El kill switch (0110). Default: sin fila = encendido (false) — así TODAS
// las pruebas existentes prueban de paso que sin interruptor el cron corre.
const estaApagado = vi.fn(async (nombre: string) => nombre === '__ninguno_apagado__');
vi.mock('@/lib/likida/interruptores', () => ({
  estaApagado: (...a: unknown[]) => estaApagado(...(a as [string])),
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
    logger.warn.mockClear();
    estaApagado.mockReset().mockResolvedValue(false);
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

describe('el kill switch (0110)', () => {
  beforeEach(() => {
    // El beforeEach del describe de arriba no alcanza a éste: se re-arman los
    // motores aquí o los conteos arrastran las llamadas de las pruebas previas.
    escalarViajesSinAceptar.mockReset().mockResolvedValue({ escalados: 0 });
    ejecutarCobranzaGlobal.mockReset().mockResolvedValue({ tenants: 0, contactados: 0, fallos: [] });
    logger.warn.mockClear();
    estaApagado.mockReset().mockResolvedValue(false);
  });

  it("con 'global' apagado: 200 con {saltado}, y NINGÚN motor corre", async () => {
    // 200 y no 500: apagado a propósito no es fallo — un 500 mandaría a
    // alguien a investigar la decisión de Javier como si fuera incidente.
    estaApagado.mockImplementation(async (n: string) => n === 'global');
    const res = await GET(peticion('Bearer secreto-de-prueba'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ corrio: false, saltado: 'interruptor global' });
    expect(escalarViajesSinAceptar).not.toHaveBeenCalled();
    expect(ejecutarCobranzaGlobal).not.toHaveBeenCalled();
    // Y lo dice en el log: el salto no puede pasar desapercibido.
    expect(logger.warn).toHaveBeenCalledWith('cron.escalar.saltado', { interruptor: 'global' });
  });

  it("con 'agente:cobranza' apagado: la aceptación CORRE, la cobranza salta Y LO DICE", async () => {
    estaApagado.mockImplementation(async (n: string) => n === 'agente:cobranza');
    const res = await GET(peticion('Bearer secreto-de-prueba'));
    const cuerpo = await res.json();

    expect(res.status).toBe(200);
    expect(escalarViajesSinAceptar).toHaveBeenCalledTimes(1);
    expect(ejecutarCobranzaGlobal).not.toHaveBeenCalled();
    expect(cuerpo.comprobacion).toEqual({ saltado: 'interruptor agente:cobranza' });
    // La aceptación reporta normal: la palanca de cobranza no la toca.
    expect(cuerpo.aceptacion).toEqual({ escalados: 0 });
  });

  it('sin fila (el default del catálogo) el cron corre entero', async () => {
    // `estaApagado` en false ES "sin fila = encendido" — el contrato del
    // default seguro, probado desde el cable.
    const res = await GET(peticion('Bearer secreto-de-prueba'));
    expect(res.status).toBe(200);
    expect(escalarViajesSinAceptar).toHaveBeenCalledTimes(1);
    expect(ejecutarCobranzaGlobal).toHaveBeenCalledTimes(1);
  });

  it('el interruptor se consulta DESPUÉS de la puerta: sin bearer válido ni se lee', async () => {
    // Si se consultara antes, cualquiera sin secreto podría sondear con el
    // reloj si el sistema está apagado.
    await GET(peticion('Bearer equivocado'));
    expect(estaApagado).not.toHaveBeenCalled();
  });
});
