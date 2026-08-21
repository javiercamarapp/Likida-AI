// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 2, hallazgo real: "cambiar de plan" creaba una SEGUNDA suscripción
// de Stripe sin cancelar/actualizar la primera → doble cobro. La base solo se
// enteraba para BLOQUEARSE (el índice único `suscripcion_una_viva`, 0052), no
// para evitar el segundo cobro: para cuando el webhook de la segunda
// suscripción chocaba contra el índice, Stripe ya había cobrado las dos.
//
// Estas pruebas anclan el fix: `cambiarPlan`, con una suscripción viva,
// ACTUALIZA el price de ESA MISMA suscripción — nunca llama al endpoint que
// crea una nueva (ni a crear un customer) — y si Stripe falla a medio camino,
// no cae a un camino de respaldo que terminaría creando una segunda.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => ({}) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { cambiarPlan } = await import('./suscripcion');
import type { Suscripcion } from './suscripcion';

const FISCALES = {
  rfc: 'GMX0902279I1',
  razonSocial: 'FLOTA DEMO SA DE CV',
  regimenFiscal: '601',
  codigoPostal: '45615',
  email: 'demo@flota.mx',
};

const SUSCRIPCION_VIVA: Suscripcion = {
  id: 's-1',
  tenantId: 't-1',
  planClave: 'basico',
  planNombre: 'Básico',
  estado: 'activa',
  inicio: '2026-01-01',
  periodoFin: '2026-08-31',
  stripeCustomerId: 'cus_viejo',
  stripeSubscriptionId: 'sub_viejo',
};

interface Llamada { metodo: string; url: string; cuerpo?: string }

/** Mockea `fetch` global (lo que usa `pedir` en stripe.ts) y registra cada llamada. */
function stubFetch(manejador: (llamada: Llamada) => Response): Llamada[] {
  const llamadas: Llamada[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const llamada: Llamada = { metodo: init?.method ?? 'GET', url, cuerpo: init?.body ? String(init.body) : undefined };
    llamadas.push(llamada);
    return manejador(llamada);
  }));
  return llamadas;
}

beforeEach(() => { process.env.STRIPE_SECRET_KEY = 'sk_test_abc'; });
afterEach(() => { delete process.env.STRIPE_SECRET_KEY; vi.restoreAllMocks(); });

describe('cambiarPlan — con suscripción viva, ACTUALIZA en vez de crear otra', () => {
  it('solo llama a GET+POST /subscriptions/{id} — jamás a /customers ni a crear una nueva', async () => {
    const llamadas = stubFetch((l) => {
      if (l.metodo === 'GET' && l.url.endsWith('/subscriptions/sub_viejo')) {
        return new Response(JSON.stringify({ id: 'sub_viejo', items: { data: [{ id: 'si_1' }] } }), { status: 200 });
      }
      if (l.metodo === 'POST' && l.url.endsWith('/subscriptions/sub_viejo')) {
        return new Response(JSON.stringify({ id: 'sub_viejo' }), { status: 200 });
      }
      throw new Error(`llamada inesperada a Stripe: ${l.metodo} ${l.url}`);
    });

    const r = await cambiarPlan({
      tenantId: 't-1', priceId: 'price_nuevo', fiscales: FISCALES, suscripcionActual: SUSCRIPCION_VIVA,
    });

    // Sigue siendo LA MISMA suscripción — no una segunda.
    expect(r.subscriptionId).toBe('sub_viejo');
    expect(r.huboCambioDePrice).toBe(true);

    // ANCLA EL BUG: si alguien revierte el fix (vuelve a llamar
    // `crearSuscripcionPorTransferencia` sin más), estas dos aserciones truenan,
    // porque ese camino SIEMPRE crea un customer y una suscripción nueva.
    expect(llamadas.some((l) => l.url.endsWith('/customers'))).toBe(false);
    expect(llamadas.some((l) => l.metodo === 'POST' && l.url.endsWith('/v1/subscriptions'))).toBe(false);

    // Y el update trae el item de la suscripción vieja, no un item nuevo:
    // mandar el price sin el `item.id` agregaría un segundo item a la MISMA
    // suscripción en vez de sustituir el primero.
    const update = llamadas.find((l) => l.metodo === 'POST' && l.url.endsWith('/subscriptions/sub_viejo'))!;
    expect(update.cuerpo).toContain('items%5B0%5D%5Bid%5D=si_1');
    expect(update.cuerpo).toContain('items%5B0%5D%5Bprice%5D=price_nuevo');
  });
});

describe('cambiarPlan — sin suscripción viva, sí crea una (primera contratación)', () => {
  it('crea customer + suscripción nueva cuando la flota no tenía ninguna', async () => {
    const llamadas = stubFetch((l) => {
      if (l.metodo === 'POST' && l.url.endsWith('/customers')) {
        return new Response(JSON.stringify({ id: 'cus_nuevo' }), { status: 200 });
      }
      if (l.metodo === 'POST' && l.url.endsWith('/v1/subscriptions')) {
        return new Response(JSON.stringify({ id: 'sub_nuevo', latest_invoice: null }), { status: 200 });
      }
      throw new Error(`llamada inesperada a Stripe: ${l.metodo} ${l.url}`);
    });

    const r = await cambiarPlan({
      tenantId: 't-1', priceId: 'price_x', fiscales: FISCALES, suscripcionActual: null,
    });

    expect(r.subscriptionId).toBe('sub_nuevo');
    expect(r.huboCambioDePrice).toBe(false);
    expect(llamadas.some((l) => l.url.endsWith('/customers'))).toBe(true);
  });
});

describe('cambiarPlan — Stripe falla a medio camino: NO deja doble cobro', () => {
  it('si actualizar la suscripción existente falla, NO cae a crear una nueva de respaldo', async () => {
    const llamadas = stubFetch((l) => {
      if (l.metodo === 'GET' && l.url.endsWith('/subscriptions/sub_viejo')) {
        return new Response(JSON.stringify({ id: 'sub_viejo', items: { data: [{ id: 'si_1' }] } }), { status: 200 });
      }
      if (l.metodo === 'POST' && l.url.endsWith('/subscriptions/sub_viejo')) {
        return new Response(JSON.stringify({ error: { message: 'No such price: price_nuevo' } }), { status: 400 });
      }
      throw new Error(`llamada inesperada a Stripe: ${l.metodo} ${l.url}`);
    });

    await expect(cambiarPlan({
      tenantId: 't-1', priceId: 'price_nuevo', fiscales: FISCALES, suscripcionActual: SUSCRIPCION_VIVA,
    })).rejects.toThrow(/No such price/);

    // Fallar cerrado: nunca se intentó un camino de respaldo que hubiera
    // dejado una segunda suscripción viva cobrando junto con la primera.
    expect(llamadas.some((l) => l.url.endsWith('/customers'))).toBe(false);
    expect(llamadas.some((l) => l.metodo === 'POST' && l.url.endsWith('/v1/subscriptions'))).toBe(false);
  });

  it('si leer la suscripción vieja falla (sin item que reemplazar), tampoco cae a crear una nueva', async () => {
    const llamadas = stubFetch((l) => {
      if (l.metodo === 'GET' && l.url.endsWith('/subscriptions/sub_viejo')) {
        // Una suscripción sin items — no debería pasar, pero si pasa no se
        // debe agregar un item "a ciegas": se rechaza en vez de adivinar.
        return new Response(JSON.stringify({ id: 'sub_viejo', items: { data: [] } }), { status: 200 });
      }
      throw new Error(`llamada inesperada a Stripe: ${l.metodo} ${l.url}`);
    });

    await expect(cambiarPlan({
      tenantId: 't-1', priceId: 'price_nuevo', fiscales: FISCALES, suscripcionActual: SUSCRIPCION_VIVA,
    })).rejects.toThrow(/ningún item/);

    expect(llamadas.some((l) => l.url.endsWith('/customers'))).toBe(false);
    expect(llamadas.some((l) => l.metodo === 'POST' && l.url.endsWith('/v1/subscriptions'))).toBe(false);
  });
});
