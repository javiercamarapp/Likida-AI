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
const marcar = vi.fn(async (): Promise<'nueva' | 'pendiente' | 'aplicada'> => 'nueva');
const sellar = vi.fn(async () => {});
const aplicarSuscripcion = vi.fn(async () => {});
const aplicarFactura = vi.fn(async () => {});
const tenantDeCustomer = vi.fn(async (): Promise<string | null> => 't-1');
const planDePrice = vi.fn(async (): Promise<string | null> => 'basico');

vi.mock('@/lib/saas/stripe', () => ({ verificarFirmaStripe: firmaValida, webhookConfigurado: configurado }));
vi.mock('@/lib/saas/suscripcion', () => ({
  marcarEvento: marcar, sellarEventoAplicado: sellar, aplicarSuscripcion, aplicarFactura,
  estadoDesdeStripe: vi.fn(() => 'activa'), tenantDeCustomer, planDePrice,
}));
vi.mock('@/lib/ratelimit', () => ({ bodyExcede: vi.fn(() => false) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

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
  marcar.mockImplementation(async () => 'nueva'); sellar.mockClear();
  aplicarSuscripcion.mockImplementation(async () => {}); aplicarFactura.mockImplementation(async () => {});
  tenantDeCustomer.mockImplementation(async () => 't-1');
  planDePrice.mockImplementation(async () => 'basico');
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
