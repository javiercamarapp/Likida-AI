// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD (22-ago-2026) · DAT-11, DAT-12, DAT-33 y el plan de $0 (DAT-40).
//
// DAT-11 — CAMBIARLE EL PRECIO A UN PLAN HUERFANABA A QUIEN YA PAGABA.
// `planDePrice` solo miraba `plan.stripe_price_id`, que es el price VIGENTE. En
// cuanto /admin ligaba un price nuevo, los eventos de las suscripciones viejas
// —que siguen trayendo el price anterior— dejaban de resolver: el webhook
// lanzaba, contestaba 500, y a esa flota no se le aplicaba un solo evento más.
// Ni el pago, ni la morosidad, ni la cancelación. Nadie se entera: el panel
// sigue enseñando el último estado bueno.
//
// DAT-12 — las facturas de STRIPE nacían con `metodo_cobro` en 'transferencia'
// (el default de la 0057) y chocaban contra el índice "una por periodo" con la
// mensualidad que /admin ya había emitido a mano ese mes.
//
// DAT-33 — un reembolso dejaba la factura 'pagada' y el CFDI vivo: dinero
// devuelto, papel fiscal en pie.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Fila = Record<string, unknown>;
const TABLAS: Record<string, Fila[]> = {};
const ops: Array<{ tabla: string; op: string; valores: Fila }> = [];

function tabla(nombre: string) {
  const api: Record<string, unknown> = {
    select: () => api,
    eq: () => api,
    is: () => api,
    in: () => api,
    limit: () => api,
    order: () => api,
    maybeSingle: () => Promise.resolve({ data: (TABLAS[nombre] ?? [])[0] ?? null, error: null }),
    insert: (v: Fila) => { ops.push({ tabla: nombre, op: 'insert', valores: v }); return Promise.resolve({ error: null }); },
    upsert: (v: Fila) => { ops.push({ tabla: nombre, op: 'upsert', valores: v }); return Promise.resolve({ error: null }); },
    update: (v: Fila) => { ops.push({ tabla: nombre, op: 'update', valores: v }); return api; },
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
  };
  return api;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => tabla(t) }) }));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const cancelarCfdi = vi.fn(async () => ({ estado: 'cancelada' }));
vi.mock('./facturapi', () => ({
  cancelarCfdi,
  facturapiConfigurado: () => true,
}));

const { planDePrice, guardarPriceDePlan, aplicarFactura, cancelarFacturaDeStripe } = await import('./suscripcion');

const price = (o: Partial<Record<string, unknown>> = {}) => JSON.stringify({
  id: 'price_nuevo', unit_amount: 240000, currency: 'mxn', active: true,
  recurring: { interval: 'month' }, tax_behavior: 'inclusive', ...o,
});

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
  for (const k of Object.keys(TABLAS)) delete TABLAS[k];
  ops.length = 0;
  cancelarCfdi.mockClear();
  logger.info.mockClear(); logger.warn.mockClear(); logger.error.mockClear();
});
afterEach(() => { delete process.env.STRIPE_SECRET_KEY; vi.restoreAllMocks(); });

describe('DAT-11 · un price nunca deja de saber de qué plan era', () => {
  it('el price VIGENTE se resuelve por `plan`, como siempre', async () => {
    TABLAS.plan = [{ clave: 'flota' }];
    expect(await planDePrice('price_vigente')).toBe('flota');
  });

  it('un price que ya NO es el del plan se resuelve por el histórico — no devuelve null', async () => {
    TABLAS.plan = [];                                  // ya no está ligado a ningún plan
    TABLAS.plan_price = [{ plan_clave: 'empresa' }];    // pero el histórico lo recuerda
    // ESTE es el bug: antes aquí salía `null`, el webhook lanzaba y la flota
    // que paga se quedaba sin que se le aplicara un evento más.
    expect(await planDePrice('price_viejo')).toBe('empresa');
  });

  it('un price que nadie ligó nunca sigue devolviendo null (no se inventa un plan)', async () => {
    TABLAS.plan = [];
    TABLAS.plan_price = [];
    expect(await planDePrice('price_de_otro')).toBeNull();
  });

  it('guardar el price nuevo escribe el histórico y marca el viejo como reemplazado', async () => {
    TABLAS.plan = [{ stripe_price_id: 'price_viejo' }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(price(), { status: 200 })));

    await guardarPriceDePlan('flota', 'price_nuevo');

    const alta = ops.find((o) => o.tabla === 'plan_price' && o.op === 'upsert')!;
    expect(alta.valores).toMatchObject({ stripe_price_id: 'price_nuevo', plan_clave: 'flota', reemplazado_en: null });
    // La fila vieja NO se borra —hay suscripciones cobrando con ese price—,
    // solo se marca cuándo dejó de ser el vigente.
    const marca = ops.find((o) => o.tabla === 'plan_price' && o.op === 'update')!;
    expect(marca.valores.reemplazado_en).toEqual(expect.any(String));
  });
});

describe('DAT-40 · un plan de $0 no es un plan', () => {
  it('rechaza un price en cero: se vería contratado y no cobraría nunca', async () => {
    TABLAS.plan = [{ stripe_price_id: null }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(price({ unit_amount: 0 }), { status: 200 })));
    await expect(guardarPriceDePlan('flota', 'price_gratis')).rejects.toThrow(/\$0/);
    expect(ops.some((o) => o.tabla === 'plan')).toBe(false);
  });
});

describe('DAT-12 · la factura de Stripe dice que es de Stripe', () => {
  it('`aplicarFactura` escribe metodo_cobro = stripe', async () => {
    await aplicarFactura({
      tenantId: 't-1', stripeInvoiceId: 'in_B', periodoInicio: '2026-08-01', periodoFin: '2026-08-31',
      monto: 11600, moneda: 'MXN', pagada: true,
    });
    const w = ops.find((o) => o.tabla === 'factura_saas')!;
    // Sin esto, la fila entra al índice `factura_saas_una_por_periodo` (que
    // solo mira las de transferencia) y choca con la mensualidad emitida a
    // mano ese mes: 23505 → webhook 500 → el cobro real nunca se registra.
    expect(w.valores.metodo_cobro).toBe('stripe');
  });
});

describe('DAT-33 · lo que se devuelve se cancela, papel incluido', () => {
  const FACTURA = {
    id: 'f-1', monto: 11600, estado: 'pagada',
    cfdi_uuid: '11111111-2222-3333-4444-555555555555',
    cfdi_proveedor_id: 'fac_pac_1', cfdi_cancelado_en: null,
  };

  it('un reembolso TOTAL cancela la factura y el CFDI', async () => {
    TABLAS.factura_saas = [FACTURA];
    expect(await cancelarFacturaDeStripe('in_B', '02', 11600)).toBe('cancelada');
    const marca = ops.find((o) => o.tabla === 'factura_saas' && o.op === 'update')!;
    expect(marca.valores).toMatchObject({ estado: 'cancelada', pagada_en: null });
    expect(cancelarCfdi).toHaveBeenCalledWith('fac_pac_1', '02');
  });

  it('un reembolso PARCIAL no cancela nada — eso sería anular un CFDI que sí ampara algo', async () => {
    TABLAS.factura_saas = [FACTURA];
    expect(await cancelarFacturaDeStripe('in_B', '02', 1000)).toBe('parcial');
    expect(cancelarCfdi).not.toHaveBeenCalled();
    expect(ops.some((o) => o.tabla === 'factura_saas' && o.op === 'update')).toBe(false);
  });

  it('si el PAC falla al cancelar, la factura YA quedó cancelada y el CFDI vivo se GRITA', async () => {
    TABLAS.factura_saas = [FACTURA];
    cancelarCfdi.mockRejectedValueOnce(new Error('PAC caído'));
    expect(await cancelarFacturaDeStripe('in_B', '02')).toBe('cancelada');
    expect(logger.error).toHaveBeenCalledWith('facturapi.cfdi_sin_cancelar', expect.anything());
  });

  it('un reembolso de un cobro que nunca registramos no lanza (Stripe reintentaría para siempre)', async () => {
    TABLAS.factura_saas = [];
    expect(await cancelarFacturaDeStripe('in_desconocida', '02')).toBe('sin_factura');
    expect(logger.warn).toHaveBeenCalledWith('stripe.anulacion_sin_factura', expect.anything());
  });
});
