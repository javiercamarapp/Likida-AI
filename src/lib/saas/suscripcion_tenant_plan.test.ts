import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// MEDIO (auditoría 25) — el segundo write de `aplicarSuscripcion`
// (`tenant.plan`) degradaba su `error` a `warn` y la función terminaba
// normal: el webhook sellaba el evento y contestaba 200, así que Stripe
// nunca reintentaba. Una flota que canceló (DAT-40) se quedaba viendo el
// plan pagado PARA SIEMPRE — no hay otro escritor de `tenant.plan` que lo
// reconcilie después.
// ═══════════════════════════════════════════════════════════════════════════

type Fila = Record<string, unknown>;
const filas: Record<string, Fila[]> = {};
const ops: Array<{ tabla: string; op: string; valores: Fila }> = [];
let errorUpdateTenant: { message: string } | null = null;

function tabla(nombre: string) {
  const api: Record<string, unknown> = {
    select: () => api,
    eq: () => api,
    is: () => api,
    in: () => api,
    order: () => api,
    limit: () => api,
    maybeSingle: () => Promise.resolve({ data: (filas[nombre] ?? [])[0] ?? null, error: null }),
    insert: (v: Fila) => { ops.push({ tabla: nombre, op: 'insert', valores: v }); return { error: null }; },
    upsert: (v: Fila) => { ops.push({ tabla: nombre, op: 'upsert', valores: v }); return Promise.resolve({ error: null }); },
    update: (v: Fila) => {
      ops.push({ tabla: nombre, op: 'update', valores: v });
      return {
        eq: () => (nombre === 'tenant'
          ? Promise.resolve({ error: errorUpdateTenant })
          : Promise.resolve({ error: null })),
      };
    },
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: filas[nombre] ?? [], error: null }).then(res),
  };
  return api;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => tabla(t) }) }));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { aplicarSuscripcion } = await import('./suscripcion');

beforeEach(() => {
  ops.length = 0;
  errorUpdateTenant = null;
  for (const k of Object.keys(filas)) delete filas[k];
  logger.warn.mockClear();
});

describe('aplicarSuscripcion — el segundo write (tenant.plan) no se traga su error', () => {
  it('MEDIO: si falla el update de tenant.plan, LANZA (no se degrada a warn)', async () => {
    errorUpdateTenant = { message: 'canceling statement due to statement timeout' };
    await expect(aplicarSuscripcion({
      tenantId: 't-1', planClave: 'demo', stripeCustomerId: 'cus-1',
      stripeSubscriptionId: 'sub-1', estado: 'cancelada', periodoFin: null,
      eventoCreadoUnix: 1_756_000_000,
    })).rejects.toThrow(/tenant_plan/);

    // La fila de suscripción SÍ se escribió (cancelada) — solo el plan del
    // tenant se quedó sin bajar.
    expect(ops.some((o) => o.tabla === 'suscripcion' && o.valores.estado === 'cancelada')).toBe(true);

    // Al LANZAR, el orden NO se sella: un reintento de Stripe tiene que
    // poder reaplicar este mismo evento y reintentar el update de tenant.
    expect(ops.find((o) => o.tabla === 'evento_stripe')).toBeUndefined();
  });

  it('si el update de tenant.plan SÍ funciona, se aplica normal y se sella', async () => {
    await aplicarSuscripcion({
      tenantId: 't-1', planClave: 'demo', stripeCustomerId: 'cus-1',
      stripeSubscriptionId: 'sub-1', estado: 'cancelada', periodoFin: null,
      eventoCreadoUnix: 1_756_000_000,
    });
    expect(ops.some((o) => o.tabla === 'tenant' && o.valores.plan === 'demo')).toBe(true);
    expect(ops.find((o) => o.tabla === 'evento_stripe')).toBeDefined();
  });
});
