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
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

process.env.CRON_SECRET = 'secreto-de-prueba';
const { GET } = await import('./route');

const peticion = (auth?: string) => new Request('http://likida.test/api/cron/escalar', {
  headers: auth ? { authorization: auth } : {},
}) as never;

describe('GET /api/cron/escalar — el cron ya no miente en verde', () => {
  beforeEach(() => {
    escalarViajesSinAceptar.mockReset().mockResolvedValue({ escalados: 0 });
    ejecutarCobranzaGlobal.mockReset().mockResolvedValue({ tenants: 0, contactados: 0, fallos: [] });
  });

  it('con los dos motores sanos responde 200', async () => {
    const res = await GET(peticion('Bearer secreto-de-prueba'));
    expect(res.status).toBe(200);
  });

  it('si la ESCALACIÓN revienta: 500, el error viaja en el cuerpo, y la cobranza CORRE igual', async () => {
    escalarViajesSinAceptar.mockRejectedValue(new Error('more than one relationship'));
    const res = await GET(peticion('Bearer secreto-de-prueba'));
    expect(res.status).toBe(500);
    const cuerpo = await res.json();
    expect(String((cuerpo.aceptacion as { error?: string }).error)).toContain('relationship');
    expect(ejecutarCobranzaGlobal).toHaveBeenCalledTimes(1);
    expect(cuerpo.comprobacion).toEqual({ tenants: 0, contactados: 0, fallos: [] });
  });

  it('si la COBRANZA revienta: 500 también', async () => {
    ejecutarCobranzaGlobal.mockRejectedValue(new Error('se cayó'));
    const res = await GET(peticion('Bearer secreto-de-prueba'));
    expect(res.status).toBe(500);
  });

  it('sin el secreto correcto no corre nada', async () => {
    const res = await GET(peticion('Bearer equivocado'));
    expect(res.status).toBe(401);
    expect(escalarViajesSinAceptar).not.toHaveBeenCalled();
  });
});
