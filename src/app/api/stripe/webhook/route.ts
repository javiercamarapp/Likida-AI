import { NextRequest, NextResponse } from 'next/server';
import { verificarFirmaStripe, webhookConfigurado } from '@/lib/saas/stripe';
import {
  marcarEvento, sellarEventoAplicado, aplicarSuscripcion, aplicarFactura, estadoDesdeStripe,
  tenantDeCustomer, planDePrice,
} from '@/lib/saas/suscripcion';
import { bodyExcede } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { registrarEventoSeguridad } from '@/lib/seguridad/eventos';

const MAX_BODY = 256 * 1024;

export const runtime = 'nodejs';
export const maxDuration = 60;

// ═══════════════════════════════════════════════════════════════════════════
// EL WEBHOOK DE STRIPE — lo que convierte un pago en un plan activo.
//
// ESTE ENDPOINT ES PÚBLICO Y CAMBIA QUIÉN TIENE PLAN PAGADO. Sin firma válida,
// cualquiera puede llamarlo y activarse el plan Empresa gratis; por eso lo
// primero es el HMAC y por eso NO hay modo "sin secreto configurado": si falta
// `STRIPE_WEBHOOK_SECRET` se contesta 503 y no se procesa nada. Un endpoint que
// acepta sin verificar porque "todavía no está configurado" es una puerta
// abierta que nadie recuerda cerrar.
//
// SE CONTESTA 200 SOLO SI SE APLICÓ. Stripe reintenta ante cualquier no-2xx, y
// eso es exactamente lo que se quiere cuando la base falló: el evento vuelve.
// Contestar 200 "para que deje de insistir" pierde el pago en silencio.
// ═══════════════════════════════════════════════════════════════════════════

interface EventoStripe {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export async function POST(req: NextRequest) {
  if (!webhookConfigurado()) {
    logger.error('stripe.webhook.sin_secreto', {});
    return new NextResponse('Stripe webhook no configurado', { status: 503 });
  }

  if (bodyExcede(req, MAX_BODY)) return new NextResponse('Payload too large', { status: 413 });
  const crudo = await req.text();
  if (crudo.length > MAX_BODY) return new NextResponse('Payload too large', { status: 413 });

  // La firma va sobre el cuerpo EXACTO como llegó. Cualquier `JSON.parse` +
  // `stringify` antes de esto cambia bytes y la firma deja de validar.
  if (!verificarFirmaStripe(crudo, req.headers.get('stripe-signature'))) {
    logger.warn('stripe.webhook.firma_invalida', {});
    void registrarEventoSeguridad({ origen: 'stripe_webhook', tipo: 'firma_invalida', severidad: 'alta' });
    return new NextResponse('Firma inválida', { status: 401 });
  }

  let evt: EventoStripe;
  try {
    evt = JSON.parse(crudo) as EventoStripe;
  } catch {
    return new NextResponse('JSON inválido', { status: 400 });
  }

  try {
    // Candado ANTES de aplicar: el insert es la carrera ganada, no un select.
    // CICLO DE VIDA (0132): 'aplicada' contesta repetido; 'pendiente' es un
    // intento anterior muerto a medias y se RE-aplica (los apliques son
    // idempotentes); la marca NO se borra jamás — la "marca huérfana" dejó
    // de existir como modo de falla.
    const marca = await marcarEvento(evt.id, evt.type, evt.data?.object ?? null);
    if (marca === 'aplicada') return NextResponse.json({ ok: true, repetido: true });

    await aplicar(evt);
    await sellarEventoAplicado(evt.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    // 500 A PROPÓSITO: que Stripe reintente. La fila queda con
    // `aplicado_en = null`, así que el reintento entra como 'pendiente' y
    // vuelve a aplicar — nada que borrar, nada que quede huérfano.
    logger.error('stripe.webhook.fallo', {
      id: evt.id, tipo: evt.type, err: e instanceof Error ? e.message : String(e),
    });
    return new NextResponse('Error al aplicar', { status: 500 });
  }
}

// ── La distinción que sostiene este switch ─────────────────────────────────
// · "Evento que NO nos concierne" (el default): se contesta 200 y se ignora.
//   Stripe manda decenas de tipos; no reconocerlos no es un fallo.
// · "Evento que SÍ nos concierne pero cuya lógica falló" (sin tenant, price
//   sin plan): se LANZA. Un `return` aquí dejaría el evento marcado como
//   aplicado + 200 → Stripe JAMÁS lo reintenta y el pago se pierde en
//   silencio. Lanzando, el catch del POST desmarca y contesta 500, y el
//   reintento de Stripe (con backoff de días) vuelve a intentar — que además
//   es el camino que SÍ se arregla solo: un invoice que llegó antes que su
//   subscription resuelve el tenant al reintento, y un price recién creado
//   aplica en cuanto /admin lo liga al plan.
// ───────────────────────────────────────────────────────────────────────────
async function aplicar(evt: EventoStripe): Promise<void> {
  const obj = evt.data?.object ?? {};

  switch (evt.type) {
    // El checkout terminó. Trae `client_reference_id` con la flota; es el único
    // evento que la sabe con certeza sin consultar nada.
    case 'checkout.session.completed': {
      const tenantId = (obj.client_reference_id as string) ?? (obj.metadata as Record<string, string>)?.tenant_id;
      const subId = obj.subscription as string | null;
      if (!tenantId || !subId) {
        // `crearCheckout` SIEMPRE manda client_reference_id + metadata.tenant_id
        // y solo crea checkouts de suscripción: que falte cualquiera de los dos
        // es un pago real que no se puede atribuir, no un evento ajeno.
        logger.error('stripe.checkout.sin_atribucion', { evt: evt.id, tenantId: tenantId ?? null, subId });
        throw new Error(`checkout ${evt.id} sin flota o sin suscripción atribuible — un pago real quedaría sin aplicar; se lanza para que Stripe lo reintente`);
      }
      // El estado real lo trae `customer.subscription.*`, que Stripe manda
      // junto con este. Aquí solo se ata el customer para no perderlo.
      logger.info('stripe.checkout.ok', { tenantId, subId });
      return;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subId = obj.id as string;
      const customerId = (obj.customer as string) ?? null;
      const meta = (obj.metadata as Record<string, string>) ?? {};
      const tenantId = meta.tenant_id ?? (customerId ? await tenantDeCustomer(customerId) : null);

      if (!tenantId) {
        // Sin flota no se puede atribuir. NO se inventa una: activarle el plan
        // a la flota equivocada es peor que no activárselo a nadie. Pero
        // tampoco se traga: se lanza para que el reintento vuelva — cuando el
        // customer ya esté atado (el checkout puede llegar después), resuelve.
        logger.error('stripe.suscripcion.sin_tenant', { evt: evt.id, subId, customerId });
        throw new Error(`suscripción ${subId} sin flota atribuible (customer ${customerId ?? 'ausente'} desconocido) — sin lanzar, el plan pagado no se activaría nunca`);
      }

      const item = (obj.items as { data?: Array<{ price?: { id?: string } }> })?.data?.[0];
      const priceId = item?.price?.id;
      const planClave = priceId ? await planDePrice(priceId) : null;
      if (!planClave) {
        // Un price sin plan en la base es configuración incompleta, no un
        // evento ajeno: se lanza para que el reintento aplique en cuanto
        // /admin ligue el price al plan.
        logger.error('stripe.suscripcion.price_desconocido', { evt: evt.id, priceId });
        throw new Error(`price ${priceId ?? 'ausente'} sin plan que le corresponda — no se sabe qué plan activar; se lanza para que Stripe reintente cuando el price esté ligado`);
      }

      const finUnix = obj.current_period_end as number | undefined;
      await aplicarSuscripcion({
        tenantId,
        stripeSubscriptionId: subId,
        stripeCustomerId: customerId,
        planClave,
        estado: evt.type === 'customer.subscription.deleted'
          ? 'cancelada'
          : estadoDesdeStripe(obj.status as string),
        periodoFin: finUnix ? new Date(finUnix * 1000).toISOString().slice(0, 10) : null,
      });
      return;
    }

    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const customerId = obj.customer as string | null;
      const tenantId = ((obj.metadata as Record<string, string>)?.tenant_id)
        ?? (customerId ? await tenantDeCustomer(customerId) : null);
      if (!tenantId) {
        // El invoice puede llegar ANTES que el subscription que ata el
        // customer: al reintento de Stripe el tenant ya resuelve. Tragarse
        // este caso dejaría el cobro real sin registrar para siempre.
        logger.error('stripe.factura.sin_tenant', { evt: evt.id, customerId });
        throw new Error(`factura ${String(obj.id)} sin flota atribuible (customer ${customerId ?? 'ausente'} desconocido) — se lanza para que el reintento la registre cuando el customer esté atado`);
      }

      const linea = (obj.lines as { data?: Array<{ period?: { start?: number; end?: number } }> })?.data?.[0];
      const ini = linea?.period?.start;
      const fin = linea?.period?.end;
      const hoy = new Date().toISOString().slice(0, 10);

      await aplicarFactura({
        tenantId,
        stripeInvoiceId: obj.id as string,
        // Donde el cliente ve la CLABE y la referencia de su transferencia.
        // Se guarda también en el cobro fallido: es justo cuando la necesita.
        urlPago: (obj.hosted_invoice_url as string) ?? null,
        periodoInicio: ini ? new Date(ini * 1000).toISOString().slice(0, 10) : hoy,
        periodoFin: fin ? new Date(fin * 1000).toISOString().slice(0, 10) : hoy,
        // `amount_paid`/`amount_due` vienen en centavos. Dividir mal es un error
        // de dos órdenes de magnitud que se ve plausible.
        monto: Number(obj.amount_paid ?? obj.amount_due ?? 0) / 100,
        moneda: String(obj.currency ?? 'mxn').toUpperCase(),
        pagada: evt.type === 'invoice.paid',
      });
      return;
    }

    default:
      // No es un error: Stripe manda decenas de tipos y solo importan estos.
      logger.info('stripe.evento_ignorado', { tipo: evt.type });
  }
}
