// A37-S61-05: las claves de idempotencia de Stripe duran 24 h. Un A->B->A, o una
// recontratación reciente, devolvía la respuesta guardada SIN ejecutar y la
// acción respondía ok. Datos sintéticos.
import { describe, it, expect, afterEach, vi } from 'vitest';

const { cambiarPriceDeSuscripcion, crearSuscripcionPorTransferencia } = await import('./stripe');

const ORIGINAL = { ...process.env };
afterEach(() => { process.env = { ...ORIGINAL }; vi.restoreAllMocks(); vi.useRealTimers(); });

interface Llamada { url: string; metodo: string; clave: string | null }

/** Stripe simulado: GET devuelve `item` con `precioActual`; POST usa `respuestaPost`. */
function simularStripe(opts: { precioActual: string; respuestaPost: (clave: string | null) => unknown }): Llamada[] {
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  const llamadas: Llamada[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const h = (init.headers ?? {}) as Record<string, string>;
    const metodo = init.method ?? 'GET';
    llamadas.push({ url, metodo, clave: h['Idempotency-Key'] ?? null });
    const cuerpo = metodo === 'GET'
      ? { id: 'sub_1', status: 'active', items: { data: [{ id: 'si_1', price: { id: opts.precioActual } }] } }
      : opts.respuestaPost(h['Idempotency-Key'] ?? null);
    return { ok: true, status: 200, text: async () => JSON.stringify(cuerpo) } as Response;
  }));
  return llamadas;
}

describe('A37-S61-05 cambiarPriceDeSuscripcion', () => {
  it('A->B->A: el tercer cambio NO repite la clave del primero', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T10:00:00Z'));
    const claves: string[] = [];
    for (const [desde, hasta] of [['price_A', 'price_B'], ['price_B', 'price_A'], ['price_A', 'price_B']]) {
      const llamadas = simularStripe({
        precioActual: desde,
        respuestaPost: () => ({ id: 'sub_1', status: 'active', items: { data: [{ id: 'si_1', price: { id: hasta } }] } }),
      });
      await cambiarPriceDeSuscripcion({ subscriptionId: 'sub_1', priceId: hasta });
      claves.push(llamadas.find((l) => l.metodo === 'POST')!.clave!);
      vi.setSystemTime(new Date(Date.now() + 5 * 60_000));
    }
    expect(claves[2]).not.toBe(claves[0]);
  });

  it('si la respuesta no trae el price pedido, falla en vez de reportar éxito', async () => {
    simularStripe({
      precioActual: 'price_A',
      // respuesta guardada de un cambio anterior: sigue en price_A
      respuestaPost: () => ({ id: 'sub_1', status: 'active', items: { data: [{ id: 'si_1', price: { id: 'price_A' } }] } }),
    });
    await expect(cambiarPriceDeSuscripcion({ subscriptionId: 'sub_1', priceId: 'price_B' })).rejects.toThrow(/price/i);
  });

  it('si la suscripción ya está en el price pedido no manda el POST', async () => {
    const llamadas = simularStripe({ precioActual: 'price_B', respuestaPost: () => ({}) });
    const r = await cambiarPriceDeSuscripcion({ subscriptionId: 'sub_1', priceId: 'price_B' });
    expect(r.subscriptionId).toBe('sub_1');
    expect(llamadas.some((l) => l.metodo === 'POST')).toBe(false);
  });
});

describe('A37-S61-05 crearSuscripcionPorTransferencia', () => {
  const fiscales = {
    rfc: 'XAXX010101000', razonSocial: 'Flota Sintetica SA', regimenFiscal: '601', codigoPostal: '01000', email: 'a@b.test',
  };
  it('una recontratación que Stripe contesta con una suscripción cancelada NO se reporta como creada', async () => {
    simularStripe({
      precioActual: 'x',
      respuestaPost: () => ({ id: 'sub_vieja', status: 'canceled', latest_invoice: null }),
    });
    await expect(
      crearSuscripcionPorTransferencia({ priceId: 'price_A', tenantId: 't1', fiscales, customerId: 'cus_1' }),
    ).rejects.toThrow(/cancelad/i);
  });
});
