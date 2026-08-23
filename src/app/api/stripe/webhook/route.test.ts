// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 13, MEDIO (residual del ALTO 3 de la ronda 12): el webhook de
// Stripe —endpoint PÚBLICO que convierte un pago en plan activo— no tenía
// route-test. Este prueba la puerta: firma inválida → 401, sin secreto → 503,
// evento repetido → 200 con repetido:true, y el 500 con desmarcado cuando la
// aplicación falla (para que el reintento de Stripe pueda volver a aplicar).
//
// AUDITORÍA EXTERNA 16-ago (P1 billing-reliability): las ramas de fallo
// LÓGICO de aplicar() —checkout sin tenant, suscripción sin tenant, price
// sin plan, invoice sin tenant— hacían log + return, o sea marker de
// idempotencia intacto + 200 → Stripe jamás reintentaba y el pago se perdía
// en silencio. Ahora LANZAN, y aquí se fija cada rama: 500 + marker borrado
// (el reintento podrá aplicar). El contraste también se fija: un tipo de
// evento que NO nos concierne sigue contestando 200 sin lanzar.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const firmaValida = vi.fn(() => true);
const configurado = vi.fn(() => true);
// DAT-32: por defecto el evento viene del mismo modo que la llave. Las pruebas
// del candado lo ponen en false a propósito.
const modoCoincide = vi.fn((_livemode: unknown) => true);
const marcar = vi.fn(async (): Promise<'nueva' | 'pendiente' | 'aplicada'> => 'nueva');
const sellar = vi.fn(async () => {});
const aplicarSuscripcion = vi.fn(async () => {});
const aplicarFactura = vi.fn(async () => {});
const tenantDeCustomer = vi.fn(async (): Promise<string | null> => 't-1');
const planDePrice = vi.fn(async (): Promise<string | null> => 'basico');
const cancelarFacturaDeStripe = vi.fn(async () => 'cancelada' as const);

vi.mock('@/lib/saas/stripe', () => ({
  verificarFirmaStripe: firmaValida, webhookConfigurado: configurado, eventoEnModoDeLaLlave: modoCoincide,
}));
vi.mock('@/lib/saas/suscripcion', () => ({
  marcarEvento: marcar, sellarEventoAplicado: sellar, aplicarSuscripcion, aplicarFactura,
  estadoDesdeStripe: vi.fn(() => 'activa'), tenantDeCustomer, planDePrice,
  cancelarFacturaDeStripe,
}));
vi.mock('@/lib/ratelimit', () => ({ bodyExcede: vi.fn(() => false) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/seguridad/eventos', () => ({ registrarEventoSeguridad: vi.fn(async () => {}) }));

// La marca NO se borra jamás desde 0132; `borrado` queda para AFIRMAR que
// ningún camino la borra (el modo de falla "marca huérfana" murió).
const borrado = vi.fn((_tabla: string, _col: string, _id: string) => ({ error: null }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => ({ delete: () => ({ eq: (col: string, id: string) => borrado(tabla, col, id) }) }),
  }),
}));

const { POST } = await import('./route');

function req(body: unknown, firma?: string): NextRequest {
  return new NextRequest('https://x/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': firma ?? 'firma', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  firmaValida.mockClear(); configurado.mockClear(); marcar.mockClear();
  aplicarSuscripcion.mockClear(); aplicarFactura.mockClear();
  tenantDeCustomer.mockClear(); planDePrice.mockClear(); borrado.mockClear();
  firmaValida.mockImplementation(() => true); configurado.mockImplementation(() => true);
  modoCoincide.mockClear(); modoCoincide.mockImplementation(() => true);
  marcar.mockImplementation(async () => 'nueva'); sellar.mockClear();
  aplicarSuscripcion.mockImplementation(async () => {}); aplicarFactura.mockImplementation(async () => {});
  tenantDeCustomer.mockImplementation(async () => 't-1');
  planDePrice.mockImplementation(async () => 'basico');
  cancelarFacturaDeStripe.mockClear();
});

describe('POST /api/stripe/webhook — la puerta del plan', () => {
  it('sin secreto configurado contesta 503 y NO procesa', async () => {
    configurado.mockReturnValueOnce(false);
    const r = await POST(req({ id: 'evt-1', type: 'x', data: { object: {} } }));
    expect(r.status).toBe(503);
    expect(marcar).not.toHaveBeenCalled();
  });

  it('firma inválida contesta 401', async () => {
    firmaValida.mockReturnValueOnce(false);
    const r = await POST(req({ id: 'evt-1', type: 'x', data: { object: {} } }));
    expect(r.status).toBe(401);
    expect(marcar).not.toHaveBeenCalled();
  });

  it('evento NUEVO: marca, aplica y contesta 200', async () => {
    const r = await POST(req({
      id: 'evt-1', type: 'customer.subscription.created',
      data: { object: { id: 'sub-1', customer: 'cus-1', items: { data: [{ price: { id: 'price-1' } }] }, status: 'active' } },
    }));
    expect(marcar).toHaveBeenCalledWith('evt-1', 'customer.subscription.created', expect.objectContaining({ id: 'sub-1' }));
    expect(aplicarSuscripcion).toHaveBeenCalled();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it('evento REPETIDO (ya aplicado): 200 con repetido:true y NO aplica', async () => {
    marcar.mockResolvedValueOnce('aplicada');
    const r = await POST(req({
      id: 'evt-1', type: 'customer.subscription.created',
      data: { object: { id: 'sub-1', customer: 'cus-1', items: { data: [{ price: { id: 'price-1' } }] }, status: 'active' } },
    }));
    expect(aplicarSuscripcion).not.toHaveBeenCalled();
    expect(await r.json()).toEqual({ ok: true, repetido: true });
  });

  it('si aplicar falla: 500, la marca NO se borra y queda SIN sellar — el reintento la re-aplica', async () => {
    aplicarSuscripcion.mockRejectedValueOnce(new Error('la base se cayó'));
    const r = await POST(req({
      id: 'evt-1', type: 'customer.subscription.created',
      data: { object: { id: 'sub-1', customer: 'cus-1', items: { data: [{ price: { id: 'price-1' } }] }, status: 'active' } },
    }));
    expect(r.status).toBe(500);
    expect(borrado).not.toHaveBeenCalled();
    expect(sellar).not.toHaveBeenCalled();
  });

  it("evento PENDIENTE (intento anterior muerto a medias): se RE-aplica y se sella", async () => {
    marcar.mockResolvedValueOnce('pendiente');
    const r = await POST(req({
      id: 'evt-1', type: 'customer.subscription.created',
      data: { object: { id: 'sub-1', customer: 'cus-1', items: { data: [{ price: { id: 'price-1' } }] }, status: 'active' } },
    }));
    expect(r.status).toBe(200);
    expect(aplicarSuscripcion).toHaveBeenCalled();
    expect(sellar).toHaveBeenCalledWith('evt-1');
  });
});

// Las ramas que ANTES hacían log + return: quedaban como "aplicadas" con 200
// y Stripe no volvía jamás — un pago real sin aplicar, en silencio. Cada una
// tiene que lanzar: 500 con la marca SIN sellar (0132) = el reintento entra
// como 'pendiente' y re-aplica. La marca no se borra en ningún camino.
describe('las ramas de fallo lógico LANZAN para entrar al camino de retry', () => {
  it('checkout sin tenant (ni client_reference_id ni metadata): 500 sin sellar', async () => {
    const r = await POST(req({
      id: 'evt-c1', type: 'checkout.session.completed',
      data: { object: { subscription: 'sub-1' } },
    }));
    expect(r.status).toBe(500);
    expect(borrado).not.toHaveBeenCalled();
    expect(sellar).not.toHaveBeenCalled();
  });

  it('checkout sin subscription: 500 sin sellar (nuestros checkouts siempre son de suscripción)', async () => {
    const r = await POST(req({
      id: 'evt-c2', type: 'checkout.session.completed',
      data: { object: { client_reference_id: 't-1' } },
    }));
    expect(r.status).toBe(500);
    expect(borrado).not.toHaveBeenCalled();
    expect(sellar).not.toHaveBeenCalled();
  });

  it('checkout COMPLETO (tenant + subscription): 200 ok', async () => {
    const r = await POST(req({
      id: 'evt-c3', type: 'checkout.session.completed',
      data: { object: { client_reference_id: 't-1', subscription: 'sub-1' } },
    }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(borrado).not.toHaveBeenCalled();
  });

  it('suscripción sin tenant (sin metadata y customer desconocido): 500, NO aplica, sin sellar', async () => {
    tenantDeCustomer.mockResolvedValueOnce(null);
    const r = await POST(req({
      id: 'evt-s1', type: 'customer.subscription.updated',
      data: { object: { id: 'sub-1', customer: 'cus-x', items: { data: [{ price: { id: 'price-1' } }] }, status: 'active' } },
    }));
    expect(r.status).toBe(500);
    expect(aplicarSuscripcion).not.toHaveBeenCalled();
    expect(borrado).not.toHaveBeenCalled();
    expect(sellar).not.toHaveBeenCalled();
  });

  it('price sin plan que le corresponda: 500, NO aplica, sin sellar', async () => {
    planDePrice.mockResolvedValueOnce(null);
    const r = await POST(req({
      id: 'evt-s2', type: 'customer.subscription.created',
      data: { object: { id: 'sub-1', customer: 'cus-1', items: { data: [{ price: { id: 'price-nuevo' } }] }, status: 'active' } },
    }));
    expect(r.status).toBe(500);
    expect(aplicarSuscripcion).not.toHaveBeenCalled();
    expect(borrado).not.toHaveBeenCalled();
    expect(sellar).not.toHaveBeenCalled();
  });

  it('invoice sin tenant (customer desconocido): 500, NO registra, sin sellar', async () => {
    tenantDeCustomer.mockResolvedValueOnce(null);
    const r = await POST(req({
      id: 'evt-f1', type: 'invoice.paid',
      data: { object: { id: 'in-1', customer: 'cus-x', amount_paid: 240000, currency: 'mxn' } },
    }));
    expect(r.status).toBe(500);
    expect(aplicarFactura).not.toHaveBeenCalled();
    expect(borrado).not.toHaveBeenCalled();
    expect(sellar).not.toHaveBeenCalled();
  });

  it('el CONTRASTE: un tipo de evento que no nos concierne contesta 200 sin lanzar', async () => {
    const r = await POST(req({
      id: 'evt-x1', type: 'payment_intent.created',
      data: { object: { id: 'pi-1' } },
    }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(borrado).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD (22-ago-2026) · DAT-24, DAT-32, DAT-33 y DAT-40 — lo que este
// endpoint escribía mal sobre dinero real.
// ═══════════════════════════════════════════════════════════════════════════

describe('DAT-24 · el cobro fallido no vale $0', () => {
  it('en `invoice.payment_failed` el monto sale de amount_due, no de amount_paid (que es 0)', async () => {
    const r = await POST(req({
      id: 'evt-pf', type: 'invoice.payment_failed', livemode: false,
      data: {
        object: {
          id: 'in-2', customer: 'cus-1', currency: 'mxn',
          // Así llega de verdad: NO viene `undefined`, viene CERO — porque
          // justamente no se pagó. Con `amount_paid ?? amount_due` el `??` no
          // salta el 0 y la pantalla decía "transfiere $0.00".
          amount_paid: 0, amount_remaining: 1160000, amount_due: 1160000,
        },
      },
    }));
    expect(r.status).toBe(200);
    expect(aplicarFactura).toHaveBeenCalledWith(expect.objectContaining({ monto: 11600, pagada: false }));
  });

  it('en `invoice.paid` sigue mandando lo PAGADO', async () => {
    await POST(req({
      id: 'evt-ok', type: 'invoice.paid',
      data: { object: { id: 'in-3', customer: 'cus-1', currency: 'mxn', amount_paid: 1160000, amount_due: 1160000 } },
    }));
    expect(aplicarFactura).toHaveBeenCalledWith(expect.objectContaining({ monto: 11600, pagada: true }));
  });
});

describe('DAT-32 · un evento de otro modo (test/live) no toca la base', () => {
  it('contesta 400, NO marca el evento y NO aplica nada', async () => {
    modoCoincide.mockReturnValueOnce(false);
    const r = await POST(req({
      id: 'evt-sandbox', type: 'invoice.paid', livemode: false,
      data: { object: { id: 'in-9', customer: 'cus-1', amount_paid: 1160000, currency: 'mxn' } },
    }));
    expect(r.status).toBe(400);
    // NO se marca: marcarlo lo daría por atendido para siempre. Lo que hace
    // falta es que quede visible como entrega fallida en el panel de Stripe.
    expect(marcar).not.toHaveBeenCalled();
    expect(aplicarFactura).not.toHaveBeenCalled();
  });
});

describe('DAT-40 · el fin de periodo con la API nueva de Stripe', () => {
  it('lo lee del ITEM cuando la suscripción ya no lo trae (API ≥ 2025-03-31)', async () => {
    const fin = Math.floor(Date.UTC(2026, 8, 30) / 1000);
    await POST(req({
      id: 'evt-cp', type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub-1', customer: 'cus-1', status: 'active',
          items: { data: [{ price: { id: 'price-1' }, current_period_end: fin }] },
        },
      },
    }));
    // Sin esto quedaba NULL y la pantalla decía "Sin fecha de corte" de una
    // flota que sí tiene corte.
    expect(aplicarSuscripcion).toHaveBeenCalledWith(expect.objectContaining({ periodoFin: '2026-09-30' }));
  });
});

describe('DAT-33 · lo que se devuelve o se anula deja de estar cobrado', () => {
  it('`invoice.voided` cancela la factura', async () => {
    const r = await POST(req({ id: 'evt-v', type: 'invoice.voided', data: { object: { id: 'in-5' } } }));
    expect(r.status).toBe(200);
    expect(cancelarFacturaDeStripe).toHaveBeenCalledWith('in-5', '02');
  });

  it('`charge.refunded` cancela por la factura del cargo, con lo reembolsado', async () => {
    await POST(req({
      id: 'evt-r', type: 'charge.refunded',
      data: { object: { id: 'ch-1', invoice: 'in-6', amount: 1160000, amount_refunded: 1160000 } },
    }));
    expect(cancelarFacturaDeStripe).toHaveBeenCalledWith('in-6', '02', 11600);
  });

  it('un cargo suelto (sin factura nuestra) contesta 200 sin tocar nada', async () => {
    const r = await POST(req({
      id: 'evt-r2', type: 'charge.refunded',
      data: { object: { id: 'ch-2', invoice: null, amount_refunded: 5000 } },
    }));
    expect(r.status).toBe(200);
    expect(cancelarFacturaDeStripe).not.toHaveBeenCalled();
  });

  it('`credit_note.created` manda el TOTAL acreditado: una nota parcial no anula el CFDI', async () => {
    await POST(req({
      id: 'evt-cn', type: 'credit_note.created',
      data: { object: { id: 'cn-1', invoice: 'in-7', total: 116000 } },
    }));
    expect(cancelarFacturaDeStripe).toHaveBeenCalledWith('in-7', '02', 1160);
  });
});
