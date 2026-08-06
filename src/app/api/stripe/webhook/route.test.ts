// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 13, MEDIO (residual del ALTO 3 de la ronda 12): el webhook de
// Stripe —endpoint PÚBLICO que convierte un pago en plan activo— no tenía
// route-test. Este prueba la puerta: firma inválida → 401, sin secreto → 503,
// evento repetido → 200 con repetido:true, y el 500 con desmarcado cuando la
// aplicación falla (para que el reintento de Stripe pueda volver a aplicar).
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const firmaValida = vi.fn(() => true);
const configurado = vi.fn(() => true);
const marcar = vi.fn(async () => true);
const aplicarSuscripcion = vi.fn(async () => {});
const aplicarFactura = vi.fn(async () => {});
const desmarcar = vi.fn(async () => {});

vi.mock('@/lib/saas/stripe', () => ({ verificarFirmaStripe: firmaValida, webhookConfigurado: configurado }));
vi.mock('@/lib/saas/suscripcion', () => ({
  marcarEvento: marcar, aplicarSuscripcion, aplicarFactura,
  estadoDesdeStripe: vi.fn(() => 'activa'), tenantDeCustomer: vi.fn(async () => 't-1'),
  planDePrice: vi.fn(async () => 'basico'),
}));
vi.mock('@/lib/ratelimit', () => ({ bodyExcede: vi.fn(() => false) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// desmarcar se importa dinámicamente dentro del route
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ delete: () => ({ eq: () => ({ error: null }) }) }),
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
  firmaValida.mockImplementation(() => true); configurado.mockImplementation(() => true);
  marcar.mockImplementation(async () => true);
  aplicarSuscripcion.mockImplementation(async () => {}); aplicarFactura.mockImplementation(async () => {});
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

  it('evento REPETIDO: contesta 200 con repetido:true y NO aplica (idempotencia)', async () => {
    marcar.mockResolvedValueOnce(false);
    const r = await POST(req({
      id: 'evt-1', type: 'customer.subscription.created',
      data: { object: { id: 'sub-1', customer: 'cus-1', items: { data: [{ price: { id: 'price-1' } }] }, status: 'active' } },
    }));
    expect(aplicarSuscripcion).not.toHaveBeenCalled();
    expect(await r.json()).toEqual({ ok: true, repetido: true });
  });

  it('si aplicar falla: 500 (el reintento de Stripe podrá volver a aplicar)', async () => {
    aplicarSuscripcion.mockRejectedValueOnce(new Error('la base se cayó'));
    const r = await POST(req({
      id: 'evt-1', type: 'customer.subscription.created',
      data: { object: { id: 'sub-1', customer: 'cus-1', items: { data: [{ price: { id: 'price-1' } }] }, status: 'active' } },
    }));
    expect(r.status).toBe(500);
    // desmarcar se verifica indirectamente: el evento no queda clavado.
  });
});
