import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18-c4 · BACK-C4-1 — RES-11 SE APLICÓ A LA SUSCRIPCIÓN Y NO A LA
// FACTURA.
//
// `suscripcion_orden.test.ts` fija la guardia de orden para
// `aplicarSuscripcion`. `aplicarFactura` quedó sin ella: ni siquiera recibía
// `eventoCreadoUnix` en su firma, y su upsert FIJA `estado` y `pagada_en`.
//
// El caso que rompe dinero, con la mensualidad de una flota real ($11,600):
//
//   10:02  `invoice.payment_failed` (evt_A). El apply revienta contra la base
//          → el webhook contesta 500 y la marca queda con `aplicado_en = null`.
//   10:20  el cliente cambia la tarjeta. `invoice.paid` (evt_B) entra bien:
//          estado 'pagada', `pagada_en` puesto.
//   11:05  Stripe REINTENTA evt_A (backoff normal, hasta 3 días). La 0132
//          manda re-aplicar lo que quedó pendiente — correcto — y cae otra vez
//          en `payment_failed`.
//
// Sin guardia, ese reintento pone `estado='fallida'` y `pagada_en=null` sobre
// una factura YA COBRADA. El contralor abre /dashboard/suscripcion, ve el
// pill rojo «Falló el cobro» y el botón de pagar sobre lo que ya transfirió;
// del otro lado `getPorCobrar` la vuelve a listar como cobrable. Likida le
// cobra dos veces a su primer cliente de pago.
//
// La otra dirección es peor: `cancelarFacturaDeStripe` cancela el CFDI ante el
// PAC tras un reembolso; un `invoice.paid` reentregado después la resucita a
// 'pagada' con `cfdi_cancelado_en` puesto — pagada y con el papel cancelado.
// ═══════════════════════════════════════════════════════════════════════════

type Fila = Record<string, unknown>;
const filas: Record<string, Fila[]> = {};
const ops: Array<{ tabla: string; op: string; valores: Fila; id?: string }> = [];
let errorLectura: { message: string } | null = null;

function tabla(nombre: string) {
  let idFiltrado: string | undefined;
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (col: string, val: string) => {
      // La factura se busca por `stripe_invoice_id`; la marca de orden, por `id`.
      if (col === 'id' || col === 'stripe_invoice_id') idFiltrado = val;
      return api;
    },
    is: () => api,
    in: () => api,
    order: () => api,
    limit: () => api,
    maybeSingle: () => {
      const esMarca = nombre === 'evento_stripe' && String(idFiltrado ?? '').startsWith('orden:');
      if (esMarca && errorLectura) return Promise.resolve({ data: null, error: errorLectura });
      return Promise.resolve({
        data: (filas[nombre] ?? []).find((f) => idFiltrado === undefined
          || f.id === idFiltrado || f.stripe_invoice_id === idFiltrado) ?? null,
        error: null,
      });
    },
    insert: (v: Fila) => { ops.push({ tabla: nombre, op: 'insert', valores: v }); return { error: null }; },
    upsert: (v: Fila) => {
      ops.push({ tabla: nombre, op: 'upsert', valores: v });
      filas[nombre] = [...(filas[nombre] ?? []).filter((f) => f.id !== v.id), v];
      return Promise.resolve({ error: null });
    },
    update: (v: Fila) => { ops.push({ tabla: nombre, op: 'update', valores: v, id: idFiltrado }); return api; },
    then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
  };
  return api;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => tabla(t) }) }));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { aplicarFactura } = await import('./suscripcion');

const FALLO_1002 = 1_755_800_520;  // 10:02
const PAGO_1020 = 1_755_801_600;   // 10:20

const factura = (pagada: boolean, creado: number) => ({
  tenantId: 't1',
  stripeInvoiceId: 'in_1QX',
  periodoInicio: '2026-08-01',
  periodoFin: '2026-08-31',
  monto: 11600,
  moneda: 'MXN',
  pagada,
  pagadaEn: pagada ? '2026-08-23T16:20:07Z' : null,
  eventoCreadoUnix: creado,
});

/** El último upsert que tocó la factura (no la marca de orden). */
const ultimaFactura = () => ops.filter((o) => o.tabla === 'factura_saas').at(-1);

beforeEach(() => {
  ops.length = 0;
  errorLectura = null;
  for (const k of Object.keys(filas)) delete filas[k];
  logger.warn.mockClear();
});

describe('aplicarFactura — el cobro fallido que llega tarde no desmarca una factura pagada', () => {
  it('paga a las 10:20 y el payment_failed de las 10:02 NO la revierte', async () => {
    await aplicarFactura(factura(true, PAGO_1020));
    expect(ultimaFactura()!.valores.estado).toBe('pagada');

    ops.length = 0;
    await aplicarFactura(factura(false, FALLO_1002));

    // Lo que importa: ni un solo write sobre la factura.
    expect(ops.filter((o) => o.tabla === 'factura_saas')).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith('stripe.evento_fuera_de_orden', expect.objectContaining({
      factura: 'in_1QX', creado: FALLO_1002, ultimoAplicado: PAGO_1020,
    }));
  });

  it('un evento MÁS NUEVO sí se aplica (la protección no congela la factura)', async () => {
    await aplicarFactura(factura(false, FALLO_1002));
    ops.length = 0;
    await aplicarFactura(factura(true, PAGO_1020));
    expect(ultimaFactura()!.valores.estado).toBe('pagada');
    expect(ultimaFactura()!.valores.pagada_en).toBe('2026-08-23T16:20:07Z');
  });

  it('la marca de orden es por FACTURA y no ensucia el SLO', async () => {
    await aplicarFactura(factura(true, PAGO_1020));
    const marca = ops.find((o) => o.op === 'upsert' && o.tabla === 'evento_stripe');
    expect(marca).toBeDefined();
    expect(marca!.valores.id).toBe('orden:in_1QX');
    expect(String(marca!.valores.id).startsWith('evt_')).toBe(false);
    // `admin/slo.ts` cuenta las filas con `aplicado_en is null`.
    expect(marca!.valores.aplicado_en).toEqual(expect.any(String));
  });

  it('sin `eventoCreadoUnix` se aplica como siempre y NO se sella nada', async () => {
    const { eventoCreadoUnix: _fuera, ...sinOrden } = factura(true, PAGO_1020);
    void _fuera;
    await aplicarFactura(sinOrden);
    expect(ultimaFactura()!.valores.estado).toBe('pagada');
    expect(ops.find((o) => o.op === 'upsert' && o.tabla === 'evento_stripe')).toBeUndefined();
  });

  it('si la marca no se puede LEER, en la duda se aplica: dejar fuera un cobro real es peor', async () => {
    errorLectura = { message: 'fetch failed' };
    await aplicarFactura(factura(true, PAGO_1020));
    expect(ultimaFactura()!.valores.estado).toBe('pagada');
    expect(logger.warn).toHaveBeenCalledWith('stripe.orden_ilegible', expect.objectContaining({ factura: 'in_1QX' }));
  });
});

describe('cancelarFacturaDeStripe — un invoice.paid reentregado no resucita lo cancelado', () => {
  it('cancela por reembolso y el invoice.paid anterior NO la vuelve a poner pagada', async () => {
    const { cancelarFacturaDeStripe } = await import('./suscripcion');

    // La factura existe y está pagada, con su CFDI timbrado.
    filas['factura_saas'] = [{
      id: 'f1', stripe_invoice_id: 'in_1QX', monto: 11600, estado: 'pagada',
      cfdi_uuid: 'a3bb189e-8bf9-3888-9912-ace4e6543002', cfdi_proveedor_id: null,
      cfdi_cancelado_en: null,
    }];

    // El reembolso llega DESPUÉS del pago: sella el orden en 10:20+.
    const r = await cancelarFacturaDeStripe('in_1QX', '02', 11600, PAGO_1020 + 60);
    expect(r).toBe('cancelada');

    ops.length = 0;
    // Stripe reentrega el invoice.paid de las 10:20, más viejo que la cancelación.
    await aplicarFactura(factura(true, PAGO_1020));

    expect(ops.filter((o) => o.tabla === 'factura_saas')).toHaveLength(0);
  });
});
