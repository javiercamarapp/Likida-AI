// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD (22-ago-2026) · DAT-04 — EL SEGUNDO CLIC CREABA UNA SEGUNDA
// SUSCRIPCIÓN VIVA EN STRIPE QUE LA BASE NUNCA REGISTRABA.
//
// La secuencia real: la flota da clic en "Contratar", Stripe crea la
// suscripción y devuelve la URL de la factura… y la fila local NO existe
// todavía, porque la escribe el webhook. Quien recarga y vuelve a dar clic
// —o elige otro plan— entra otra vez por el camino de CREAR: dos suscripciones
// vivas, dos mensualidades cobrándose, y la base enterándose solo cuando el
// webhook de la segunda revienta contra `suscripcion_una_viva` (0052). Para
// entonces las dos ya cobraron.
//
// Tres candados, y aquí se prueban los tres:
//   1. Se le pregunta a STRIPE (`subscriptions?customer=…&status=all`) antes de
//      crear: es el único que sabe lo que la base todavía no.
//   2. La clave de idempotencia ya NO lleva el price, así que el segundo
//      intento con otro plan choca contra la clave en vez de duplicar el cobro.
//   3. Se deja una FILA PROVISIONAL con el `stripe_subscription_id` en cuanto
//      Stripe contesta, para que el siguiente clic ya no mire una base vacía.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Fila = Record<string, unknown>;
const TABLAS: Record<string, Fila[]> = {};
const inserts: Array<{ tabla: string; valores: Fila }> = [];

function tabla(nombre: string) {
  const api: Record<string, unknown> = {
    select: () => api,
    eq: () => api,
    is: () => api,
    in: () => api,
    limit: () => api,
    order: () => api,
    maybeSingle: () => Promise.resolve({ data: (TABLAS[nombre] ?? [])[0] ?? null, error: null }),
    insert: (v: Fila) => { inserts.push({ tabla: nombre, valores: v }); return Promise.resolve({ error: null }); },
    update: () => api,
    upsert: () => Promise.resolve({ error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res),
  };
  return api;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => tabla(t) }) }));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { cambiarPlan } = await import('./suscripcion');
import type { Suscripcion } from './suscripcion';

const FISCALES = {
  rfc: 'GMX0902279I1',
  razonSocial: 'FLOTA DEMO SA DE CV',
  regimenFiscal: '601',
  codigoPostal: '45615',
  email: 'demo@flota.mx',
};

/** La flota YA es cliente de Stripe (tiene customer), pero la fila local no
 *  tiene `stripe_subscription_id`: exactamente el hueco por el que se colaba
 *  la segunda suscripción. */
const SIN_SUB_LOCAL: Suscripcion = {
  id: 's-1', tenantId: 't-1', planClave: 'demo', planNombre: 'Demo', estado: 'prueba',
  inicio: '2026-08-01', periodoFin: null, vencida: false,
  stripeCustomerId: 'cus_1', stripeSubscriptionId: null,
};

interface Llamada { metodo: string; url: string; cuerpo?: string }

function stubFetch(manejador: (l: Llamada) => Response): Llamada[] {
  const llamadas: Llamada[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const l: Llamada = { metodo: init?.method ?? 'GET', url, cuerpo: init?.body ? String(init.body) : undefined };
    llamadas.push(l);
    return manejador(l);
  }));
  return llamadas;
}

const respuesta = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
  for (const k of Object.keys(TABLAS)) delete TABLAS[k];
  inserts.length = 0;
  logger.info.mockClear(); logger.warn.mockClear(); logger.error.mockClear();
  // El price ya está ligado a un plan: `registrarSuscripcionProvisional` lo
  // necesita para saber qué plan escribir.
  TABLAS.plan = [{ clave: 'flota' }];
});
afterEach(() => { delete process.env.STRIPE_SECRET_KEY; vi.restoreAllMocks(); });

describe('DAT-04 · antes de crear, se le pregunta a Stripe', () => {
  it('con una suscripción viva que la base no conoce, la ACTUALIZA en vez de crear la segunda', async () => {
    const llamadas = stubFetch((l) => {
      if (l.metodo === 'GET' && l.url.includes('/subscriptions?')) {
        // Stripe sí la tiene; la base no.
        return respuesta({ data: [{ id: 'sub_huerfana', status: 'active', items: { data: [{ price: { id: 'price_viejo' } }] } }] });
      }
      if (l.metodo === 'GET' && l.url.endsWith('/subscriptions/sub_huerfana')) {
        return respuesta({ id: 'sub_huerfana', items: { data: [{ id: 'si_1' }] } });
      }
      if (l.metodo === 'POST' && l.url.endsWith('/subscriptions/sub_huerfana')) {
        return respuesta({ id: 'sub_huerfana' });
      }
      throw new Error(`llamada inesperada: ${l.metodo} ${l.url}`);
    });

    const r = await cambiarPlan({
      tenantId: 't-1', priceId: 'price_nuevo', fiscales: FISCALES, suscripcionActual: SIN_SUB_LOCAL,
    });

    expect(r.subscriptionId).toBe('sub_huerfana');
    expect(r.huboCambioDePrice).toBe(true);
    // EL ANCLA DEL BUG: ni un solo POST a crear suscripción o customer.
    expect(llamadas.some((l) => l.metodo === 'POST' && l.url.endsWith('/v1/subscriptions'))).toBe(false);
    expect(llamadas.some((l) => l.url.endsWith('/customers'))).toBe(false);
    // Y la consulta pide TODOS los estados: filtrar por 'active' dejaría fuera
    // `past_due` e `incomplete`, que también cobran o van a cobrar.
    expect(llamadas[0].url).toContain('status=all');
    expect(llamadas[0].url).toContain('customer=cus_1');
  });

  it('con DOS vivas (el doble cobro ya en curso) se PARA y lo dice, en vez de tocar una y esconder la otra', async () => {
    stubFetch((l) => {
      if (l.metodo === 'GET' && l.url.includes('/subscriptions?')) {
        return respuesta({ data: [
          { id: 'sub_a', status: 'active', items: { data: [] } },
          { id: 'sub_b', status: 'past_due', items: { data: [] } },
        ] });
      }
      throw new Error(`llamada inesperada: ${l.metodo} ${l.url}`);
    });

    await expect(cambiarPlan({
      tenantId: 't-1', priceId: 'price_nuevo', fiscales: FISCALES, suscripcionActual: SIN_SUB_LOCAL,
    })).rejects.toThrow(/2 suscripciones vivas/i);
    expect(logger.error).toHaveBeenCalledWith('stripe.suscripciones_duplicadas', expect.anything());
  });

  it('si en Stripe solo hay canceladas, SÍ crea — y deja la fila provisional', async () => {
    stubFetch((l) => {
      if (l.metodo === 'GET' && l.url.includes('/subscriptions?')) {
        return respuesta({ data: [{ id: 'sub_muerta', status: 'canceled', items: { data: [] } }] });
      }
      if (l.metodo === 'POST' && l.url.endsWith('/v1/subscriptions')) {
        return respuesta({ id: 'sub_nueva', latest_invoice: { hosted_invoice_url: 'https://pay/x' } });
      }
      throw new Error(`llamada inesperada: ${l.metodo} ${l.url}`);
    });

    const r = await cambiarPlan({
      tenantId: 't-1', priceId: 'price_nuevo', fiscales: FISCALES, suscripcionActual: SIN_SUB_LOCAL,
    });
    expect(r.subscriptionId).toBe('sub_nueva');

    // LA FILA PROVISIONAL: sin ella, el siguiente clic vuelve a ver la base
    // vacía y vuelve a crear.
    const fila = inserts.find((i) => i.tabla === 'suscripcion')!;
    expect(fila.valores).toMatchObject({
      tenant_id: 't-1', stripe_subscription_id: 'sub_nueva', plan_clave: 'flota',
      // 'prueba', NO 'activa': nadie ha pagado todavía —la factura por
      // transferencia vence en 15 días— y el webhook trae el estado real.
      estado: 'prueba',
    });
  });
});

describe('DAT-04 · la clave de idempotencia ya no lleva el price', () => {
  it('la clave del POST de suscripción es por FLOTA, no por flota+plan', async () => {
    let clave: string | null = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers as HeadersInit);
      if (String(url).endsWith('/v1/subscriptions') && init?.method === 'POST') {
        clave = h.get('Idempotency-Key');
        return respuesta({ id: 'sub_nueva', latest_invoice: null });
      }
      if (String(url).endsWith('/customers')) return respuesta({ id: 'cus_nuevo' });
      throw new Error(`llamada inesperada: ${url}`);
    }));

    await cambiarPlan({ tenantId: 't-1', priceId: 'price_flota', fiscales: FISCALES, suscripcionActual: null });

    expect(clave).toBe('sub-transfer-t-1');
    // Con el price adentro (`sub-transfer-t-1-price_flota`), el segundo clic con
    // OTRO plan era otra clave y Stripe creaba la segunda suscripción viva.
    expect(clave).not.toContain('price_');
  });

  it('el segundo intento con otro plan lo rechaza Stripe, y se traduce a una frase que se entiende', async () => {
    stubFetch((l) => {
      if (l.metodo === 'POST' && l.url.endsWith('/customers')) return respuesta({ id: 'cus_nuevo' });
      if (l.metodo === 'POST' && l.url.endsWith('/v1/subscriptions')) {
        return respuesta({ error: { code: 'idempotency_error', message: 'Keys for idempotent requests…' } }, 400);
      }
      throw new Error(`llamada inesperada: ${l.metodo} ${l.url}`);
    });

    await expect(cambiarPlan({
      tenantId: 't-1', priceId: 'price_otro', fiscales: FISCALES, suscripcionActual: null,
    })).rejects.toThrow(/dos mensualidades/i);
  });

  it('la clave del CUSTOMER cambia si cambian los datos fiscales (un RFC corregido ya no se queda pegado 24 h)', async () => {
    const claves: Array<string | null> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers as HeadersInit);
      if (String(url).endsWith('/customers')) {
        claves.push(h.get('Idempotency-Key'));
        return respuesta({ id: 'cus_nuevo' });
      }
      return respuesta({ id: 'sub_nueva', latest_invoice: null });
    }));

    await cambiarPlan({ tenantId: 't-1', priceId: 'p1', fiscales: FISCALES, suscripcionActual: null });
    await cambiarPlan({
      tenantId: 't-1', priceId: 'p1', suscripcionActual: null,
      fiscales: { ...FISCALES, rfc: 'MAB0902279I1' },
    });

    expect(claves[0]).toMatch(/^customer-t-1-[0-9a-f]{16}$/);
    expect(claves[1]).not.toBe(claves[0]);
  });
});
