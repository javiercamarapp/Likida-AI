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

const respuestas = new Map<string, Array<{ data: unknown; error: { message: string } | null }>>();
function builder(tabla: string) {
  const responder = () => {
    const cola = respuestas.get(tabla);
    return cola && cola.length > 0 ? cola.shift()! : { data: [], error: null };
  };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b, order: () => b, limit: () => b,
    maybeSingle: () => b, update: () => b, insert: () => b,
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
    expect(r).toEqual({ medidas: 0, fallidas: [], configurada: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(estadoIntegracionAds().metaConfigurada).toBe(false);
  });
});
