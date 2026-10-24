import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// CAMPAÑAS (0123, §4) — lo que se fija:
//  · Este módulo NO TIENE función de crear campañas ni subir presupuesto —
//    la asimetría es el diseño, y se prueba enumerando los exports.
//  · Pausar: solo activas; con token, si Meta RECHAZA, la fila NO se marca
//    pausada (marcarla mentiría mientras sigue gastando); sin token, pausa
//    local y el mensaje exige apagarla también en el Ads Manager.
//  · Sin META_ADS_TOKEN, refrescar gasto dice configurada:false — jamás $0.
// ═══════════════════════════════════════════════════════════════════════════

const respuestas = new Map<string, Array<{ data: unknown; error: { message: string } | null; count?: number }>>();
const updatesCampana: Array<Record<string, unknown>> = [];
const rangos: Array<[number, number]> = [];
function builder(tabla: string) {
  const responder = () => {
    const cola = respuestas.get(tabla);
    return cola && cola.length > 0 ? cola.shift()! : { data: [], error: null };
  };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b, order: () => b, limit: () => b,
    neq: () => b, not: () => b, is: () => b,
    range: (d: number, h: number) => { rangos.push([d, h]); return b; },
    maybeSingle: () => b, insert: () => b,
    update: (p: Record<string, unknown>) => { if (tabla === 'campana') updatesCampana.push(p); return b; },
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(responder).then(res, rej),
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

const modulo = await import('./campanas');
const { pausarCampana, refrescarGastoMeta, estadoIntegracionAds } = modulo;

const envAntes = process.env.META_ADS_TOKEN;
beforeEach(() => {
  respuestas.clear();
  updatesCampana.length = 0;
  rangos.length = 0;
  fetchMock.mockReset();
  delete process.env.META_ADS_TOKEN;
});
afterEach(() => {
  if (envAntes === undefined) delete process.env.META_ADS_TOKEN;
  else process.env.META_ADS_TOKEN = envAntes;
});

const ACTIVA = { id: 'c-1', canal: 'meta', id_externo: '1234', nombre: 'Prueba', estado: 'activa' };

describe('la asimetría es el diseño', () => {
  it('el módulo NO exporta crear campaña ni subir presupuesto', () => {
    const nombres = Object.keys(modulo).map((n) => n.toLowerCase()).join(' ');
    expect(nombres).not.toMatch(/crear|activar|subir|aumentar|presupuestar/);
  });
});

describe('pausarCampana', () => {
  it('solo una ACTIVA se puede pausar', async () => {
    respuestas.set('campana', [{ data: { ...ACTIVA, estado: 'pausada' }, error: null }]);
    await expect(pausarCampana('c-1', 'u-1')).rejects.toThrow(/no está activa/);
  });

  it('con token y Meta RECHAZANDO, la fila NO se marca pausada — sigue gastando y se dice', async () => {
    process.env.META_ADS_TOKEN = 'tok';
    respuestas.set('campana', [{ data: ACTIVA, error: null }]);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'bad' } as Response);
    await expect(pausarCampana('c-1', 'u-1')).rejects.toThrow(/SIGUE ACTIVA/);
    // Solo hubo el SELECT: cero updates a la fila.
    expect(respuestas.get('campana')?.length ?? 0).toBe(0);
  });

  it('con token y Meta confirmando, pausa remota + fila + bitácora', async () => {
    process.env.META_ADS_TOKEN = 'tok';
    respuestas.set('campana', [
      { data: ACTIVA, error: null },
      { data: [{ id: 'c-1' }], error: null },
    ]);
    respuestas.set('bitacora_auditoria', [{ data: null, error: null }]);
    fetchMock.mockResolvedValueOnce({ ok: true } as Response);
    const r = await pausarCampana('c-1', 'u-1');
    expect(r.remotaConfirmada).toBe(true);
    expect(r.mensaje).toMatch(/Meta confirmó/);
  });

  it('SIN token: pausa local y el mensaje exige apagarla también en el Ads Manager', async () => {
    respuestas.set('campana', [
      { data: ACTIVA, error: null },
      { data: [{ id: 'c-1' }], error: null },
    ]);
    respuestas.set('bitacora_auditoria', [{ data: null, error: null }]);
    const r = await pausarCampana('c-1', 'u-1');
    expect(r.remotaConfirmada).toBe(false);
    expect(r.mensaje).toMatch(/Ads Manager/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('el gasto real', () => {
  it('sin META_ADS_TOKEN no se finge medición: configurada=false y cero fetch', async () => {
    const r = await refrescarGastoMeta();
    expect(r).toEqual({ medidas: 0, fallidas: [], configurada: false, pendientes: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(estadoIntegracionAds().metaConfigurada).toBe(false);
  });
});

// ── A37-S22-02/03: moneda, spend, tiempo, paginación y token ────────────────
const metaCampanas = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `c-${i}`, canal: 'meta', id_externo: `ext-${i}`, nombre: `Campaña ${i}`, estado: 'activa',
  presupuesto_aprobado_usd: 100,
}));
const insights = (spend: unknown, moneda: unknown = 'USD') => ({
  ok: true, json: async () => ({ data: [{ spend, account_currency: moneda }] }),
}) as unknown as Response;

describe('A37-S22-02/03 — el gasto de Meta', () => {
  it('A37-S22-02: pide account_currency y solo guarda como USD si la cuenta ES USD', async () => {
    process.env.META_ADS_TOKEN = 'tok-secreto';
    respuestas.set('campana', [{ data: metaCampanas(1), error: null, count: 1 }]);
    fetchMock.mockResolvedValueOnce(insights('12.50'));
    const r = await refrescarGastoMeta();
    expect(r.medidas).toBe(1);
    expect(updatesCampana[0]).toMatchObject({ gasto_real_usd: 12.5 });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/fields=spend(,|%2C)account_currency/);
  });

  it('A37-S22-02: una cuenta en MXN NO se guarda como USD (sin conversión inventada)', async () => {
    process.env.META_ADS_TOKEN = 'tok';
    respuestas.set('campana', [{ data: metaCampanas(1), error: null, count: 1 }]);
    fetchMock.mockResolvedValueOnce(insights('900', 'MXN'));
    const r = await refrescarGastoMeta();
    expect(r.medidas).toBe(0);
    expect(r.fallidas[0].motivo).toMatch(/MXN/);
    expect(updatesCampana).toHaveLength(0);
  });

  it('A37-S22-02: sin account_currency en la respuesta tampoco se guarda (no se puede demostrar USD)', async () => {
    process.env.META_ADS_TOKEN = 'tok';
    respuestas.set('campana', [{ data: metaCampanas(1), error: null, count: 1 }]);
    fetchMock.mockResolvedValueOnce(insights('5', null));
    const r = await refrescarGastoMeta();
    expect(r.medidas).toBe(0);
    expect(updatesCampana).toHaveLength(0);
  });

  it('A37-S22-02: un spend no numérico, vacío o negativo no escribe NaN/0 sobre la medición previa', async () => {
    process.env.META_ADS_TOKEN = 'tok';
    for (const malo of ['abc', '', '   ', '-3', 'Infinity']) {
      respuestas.set('campana', [{ data: metaCampanas(1), error: null, count: 1 }]);
      fetchMock.mockResolvedValueOnce(insights(malo));
      const r = await refrescarGastoMeta();
      expect(r.medidas, `spend=${JSON.stringify(malo)}`).toBe(0);
      expect(r.fallidas).toHaveLength(1);
    }
    expect(updatesCampana).toHaveLength(0);
  });

  it('A37-S22-03: el token viaja en el header Authorization, no en la URL', async () => {
    process.env.META_ADS_TOKEN = 'tok-secreto';
    respuestas.set('campana', [{ data: metaCampanas(1), error: null, count: 1 }]);
    fetchMock.mockResolvedValueOnce(insights('1'));
    await refrescarGastoMeta();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain('tok-secreto');
    expect(String(url)).not.toContain('access_token');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-secreto');
  });

  it('A37-S22-03: mide TODAS las campañas de Meta (paginadas), no solo las primeras 100', async () => {
    process.env.META_ADS_TOKEN = 'tok';
    respuestas.set('campana', [{ data: metaCampanas(120), error: null, count: 120 }]);
    fetchMock.mockImplementation(async () => insights('2'));
    const r = await refrescarGastoMeta();
    expect(r.medidas).toBe(120);
    expect(r.pendientes).toBe(0);
    expect(rangos[0]).toEqual([0, 999]);
  });

  it('A37-S22-03: con el presupuesto de tiempo agotado no se llama a Meta y se DICE cuántas quedaron sin medir', async () => {
    process.env.META_ADS_TOKEN = 'tok';
    respuestas.set('campana', [{ data: metaCampanas(7), error: null, count: 7 }]);
    const r = await refrescarGastoMeta({ presupuestoMs: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.medidas).toBe(0);
    expect(r.pendientes).toBe(7);
  });

  it('A37-S22-03: listarCampanasConTotal avisa cuando hay más campañas que las mostradas', async () => {
    respuestas.set('campana', [{ data: metaCampanas(100), error: null, count: 130 }]);
    const r = await modulo.listarCampanasConTotal();
    expect(r.campanas).toHaveLength(100);
    expect(r.total).toBe(130);
  });
});
