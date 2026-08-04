import { NextRequest, NextResponse } from 'next/server';
import { verificarFirmaStripe, webhookConfigurado } from '@/lib/saas/stripe';
import {
  marcarEvento, aplicarSuscripcion, aplicarFactura, estadoDesdeStripe,
  tenantDeCustomer, planDePrice,
} from '@/lib/saas/suscripcion';
import { bodyExcede } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';

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
    const nuevo = await marcarEvento(evt.id, evt.type, evt.data?.object ?? null);
    if (!nuevo) return NextResponse.json({ ok: true, repetido: true });

    await aplicar(evt);
    return NextResponse.json({ ok: true });
  } catch (e) {
    // 500 A PROPÓSITO: que Stripe reintente. El evento quedó marcado, así que
    // el reintento lo vería como repetido y NO se volvería a aplicar — por eso
    // se borra la marca antes de rendirse.
    logger.error('stripe.webhook.fallo', {
      id: evt.id, tipo: evt.type, err: e instanceof Error ? e.message : String(e),
    });
    await desmarcar(evt.id);
    return new NextResponse('Error al aplicar', { status: 500 });
  }
}

async function desmarcar(id: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import('@/lib/supabase/admin');
    await supabaseAdmin().from('evento_stripe').delete().eq('id', id);
  } catch (e) {
    // Si ni esto se puede, el evento queda marcado sin aplicar y el reintento
    // lo saltará. Se loguea fuerte porque es el caso que deja un pago cobrado
    // sin plan activo, y se arregla a mano desde /admin.
    logger.error('stripe.webhook.marca_huerfana', { id, err: e instanceof Error ? e.message : String(e) });
  }
}

async function aplicar(evt: EventoStripe): Promise<void> {
  const obj = evt.data?.object ?? {};

  switch (evt.type) {
    // El checkout terminó. Trae `client_reference_id` con la flota; es el único
    // evento que la sabe con certeza sin consultar nada.
    case 'checkout.session.completed': {
      const tenantId = (obj.client_reference_id as string) ?? (obj.metadata as Record<string, string>)?.tenant_id;
      const subId = obj.subscription as string | null;
      if (!tenantId || !subId) {
        logger.warn('stripe.checkout.sin_atribucion', { evt: evt.id });
        return;
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
        // a la flota equivocada es peor que no activárselo a nadie.
        logger.error('stripe.suscripcion.sin_tenant', { evt: evt.id, subId, customerId });
        return;
      }

      const item = (obj.items as { data?: Array<{ price?: { id?: string } }> })?.data?.[0];
      const priceId = item?.price?.id;
      const planClave = priceId ? await planDePrice(priceId) : null;
      if (!planClave) {
        logger.error('stripe.suscripcion.price_desconocido', { evt: evt.id, priceId });
        return;
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
        logger.error('stripe.factura.sin_tenant', { evt: evt.id, customerId });
        return;
      }

      const linea = (obj.lines as { data?: Array<{ period?: { start?: number; end?: number } }> })?.data?.[0];
      const ini = linea?.period?.start;
      const fin = linea?.period?.end;
      const hoy = new Date().toISOString().slice(0, 10);

      await aplicarFactura({
        tenantId,
        stripeInvoiceId: obj.id as string,
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
