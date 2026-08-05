// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 12, ALTO (backend): el webhook de Stripe y suscripcion.ts no
// tenían UNA sola prueba. El endpoint es PÚBLICO: convierte un pago en plan
// activo. `marcarEvento` usa el insert como candado de idempotencia (23505) —
// la única protección contra doble procesamiento.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

const escrituras: Array<{ tabla: string; valores: Record<string, unknown>; op: string }> = [];
const errores: Record<string, unknown> = {};
let insertError = null as { code?: string; message?: string } | null;

function constructor(tabla: string) {
  const api: Record<string, unknown> = {
    select: () => api,
    eq: () => api,
    is: () => api,
    in: () => api,
    maybeSingle: () => Promise.resolve({ data: null, error: errores[tabla] ?? null }),
    insert: (v: Record<string, unknown>) => {
      escrituras.push({ tabla, valores: v, op: 'insert' });
      return { error: insertError };
    },
    update: (v: Record<string, unknown>) => {
      escrituras.push({ tabla, valores: v, op: 'update' });
      return api;
    },
    then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
  };
  return api;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => constructor(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { marcarEvento, estadoDesdeStripe, aplicarSuscripcion } = await import('./suscripcion');

beforeEach(() => {
  escrituras.length = 0;
  insertError = null;
});

describe('marcarEvento — el candado de idempotencia del webhook', () => {
  it('registra un evento nuevo', async () => {
    const ok = await marcarEvento('evt-1', 'checkout.session.completed', { total: 100 });
    expect(ok).toBe(true);
    expect(escrituras[0]).toMatchObject({ tabla: 'evento_stripe', op: 'insert' });
    expect(escrituras[0].valores).toMatchObject({ id: 'evt-1', tipo: 'checkout.session.completed' });
  });

  it('devuelve false en un evento repetido (23505) — el idempotente manda', async () => {
    insertError = { code: '23505', message: 'duplicate key' };
    const ok = await marcarEvento('evt-1', 'checkout.session.completed', {});
    expect(ok).toBe(false);
  });

  it('LANZA ante cualquier otro error — un fallo de base no se lee como repetido', async () => {
    insertError = { message: 'network error' };
    await expect(marcarEvento('evt-1', 'checkout.session.completed', {})).rejects.toThrow(/network error/);
  });
});

describe('estadoDesdeStripe — el mapeo del dominio', () => {
  it('mapea los estados de Stripe al dominio de la app', () => {
    expect(estadoDesdeStripe('trialing')).toBe('prueba');
    expect(estadoDesdeStripe('active')).toBe('activa');
    expect(estadoDesdeStripe('past_due')).toBe('morosa');   // moroso NO apaga el producto
    expect(estadoDesdeStripe('unpaid')).toBe('morosa');
    expect(estadoDesdeStripe('paused')).toBe('pausada');
    expect(estadoDesdeStripe('canceled')).toBe('cancelada');
    expect(estadoDesdeStripe('incomplete_expired')).toBe('cancelada');
  });

  it('un checkout incompleto NO activa el plan — trata como prueba', () => {
    expect(estadoDesdeStripe('incomplete')).toBe('prueba');
    expect(estadoDesdeStripe('cualquier-cosa')).toBe('prueba');
  });
});

describe('aplicarSuscripcion — el pago que activa el plan', () => {
  it('aplica una suscripción con el estado mapeado de Stripe', async () => {
    await aplicarSuscripcion({
      tenantId: 't-1', planClave: 'basico', stripeCustomerId: 'cus-1',
      stripeSubscriptionId: 'sub-1', estado: 'activa', periodoFin: '2026-08-31',
    });
    const w = escrituras.find((e) => e.tabla === 'suscripcion' && e.op === 'insert')!;
    expect(w.valores).toMatchObject({
      tenant_id: 't-1', plan_clave: 'basico', estado: 'activa',
      stripe_subscription_id: 'sub-1', stripe_customer_id: 'cus-1', cancelada_en: null,
    });
  });
});
