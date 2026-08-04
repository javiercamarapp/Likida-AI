import crypto from 'node:crypto';
import { logger } from '@/lib/logger';

// ═══════════════════════════════════════════════════════════════════════════
// STRIPE — lo que Likida le cobra a la flota.
//
// CONTRA LA API REST, SIN EL SDK. No es purismo: son cuatro llamadas
// (checkout, portal, leer un price, leer una suscripción) y un HMAC. El SDK
// mete una dependencia con su propio ciclo de versiones y su propio agente
// HTTP a un proyecto que ya habla con la Graph API de Meta exactamente así.
//
// TODO FALLA CERRADO Y LO DICE. Sin `STRIPE_SECRET_KEY` no se finge que hay
// cobro: `stripeConfigurado()` devuelve false y la pantalla enseña qué falta.
// Un botón "Suscribirme" que no hace nada es peor que no tener botón — el
// cliente cree que ya pagó.
// ═══════════════════════════════════════════════════════════════════════════

const API = 'https://api.stripe.com/v1';

/** Tolerancia del timestamp del webhook. La de Stripe por defecto. */
const TOLERANCIA_S = 300;

export function stripeConfigurado(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function webhookConfigurado(): boolean {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET);
}

/** En qué modo está la llave. Importa enseñarlo: cobrar de a de veras con una
 *  llave de prueba deja al cliente creyendo que pagó y a Likida sin el dinero. */
export function modoStripe(): 'prueba' | 'produccion' | null {
  const k = process.env.STRIPE_SECRET_KEY;
  if (!k) return null;
  return k.startsWith('sk_live') ? 'produccion' : 'prueba';
}

function llave(): string {
  const k = process.env.STRIPE_SECRET_KEY;
  if (!k) throw new Error('STRIPE_SECRET_KEY no configurado');
  return k;
}

/**
 * Stripe recibe form-encoded, incluidos los anidados: `line_items[0][price]`.
 * Se aplana aquí para no repetir el formato en cada llamada.
 */
function aplanar(obj: Record<string, unknown>, prefijo = ''): Array<[string, string]> {
  const salida: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const clave = prefijo ? `${prefijo}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') {
          salida.push(...aplanar(item as Record<string, unknown>, `${clave}[${i}]`));
        } else {
          salida.push([`${clave}[${i}]`, String(item)]);
        }
      });
    } else if (typeof v === 'object') {
      salida.push(...aplanar(v as Record<string, unknown>, clave));
    } else {
      salida.push([clave, String(v)]);
    }
  }
  return salida;
}

/**
 * Una llamada a Stripe.
 *
 * LOS ERRORES SE LANZAN CON EL MENSAJE DE STRIPE, que es el único que dice qué
 * pasó ("No such price: price_xxx"). Quien lo llame decide si enseñarlo o no —
 * `mensajeParaPantalla` ya sabe que un Error crudo no se le enseña al cliente.
 */
async function pedir<T>(
  ruta: string,
  opciones: { metodo?: 'GET' | 'POST'; cuerpo?: Record<string, unknown>; idempotencia?: string } = {},
): Promise<T> {
  const { metodo = 'POST', cuerpo, idempotencia } = opciones;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${llave()}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  // Sin esto, un reintento de red al crear el checkout deja DOS suscripciones.
  if (idempotencia) headers['Idempotency-Key'] = idempotencia;

  const cuerpoStr = cuerpo ? new URLSearchParams(aplanar(cuerpo)).toString() : undefined;
  const url = metodo === 'GET' && cuerpoStr ? `${API}${ruta}?${cuerpoStr}` : `${API}${ruta}`;

  const r = await fetch(url, {
    method: metodo,
    headers,
    body: metodo === 'POST' ? cuerpoStr : undefined,
  });

  const texto = await r.text();
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    throw new Error(`Stripe ${ruta}: respuesta ilegible (${r.status})`);
  }

  if (!r.ok) {
    const err = (json as { error?: { message?: string; code?: string } }).error;
    logger.error('stripe.error', { ruta, status: r.status, code: err?.code });
    throw new Error(`Stripe ${ruta}: ${err?.message ?? `HTTP ${r.status}`}`);
  }
  return json as T;
}

// ── Precio ─────────────────────────────────────────────────────────────────

export interface PrecioStripe {
  id: string;
  /** En pesos, ya dividido entre 100. Stripe cotiza en centavos. */
  montoMensual: number;
  moneda: string;
  recurrente: boolean;
  activo: boolean;
}

/**
 * Lee un price de Stripe. Es lo que hace que la cifra de la pantalla no pueda
 * divergir de la que se cobra: el panel NO deja teclear el monto, lo trae de
 * aquí al guardar el price id.
 *
 * `unit_amount` viene en la unidad mínima (centavos). Dividir mal es un error
 * de dos órdenes de magnitud que se ve plausible: $24.00 en vez de $2,400.00.
 */
export async function leerPrecio(priceId: string): Promise<PrecioStripe> {
  const p = await pedir<{
    id: string;
    unit_amount: number | null;
    currency: string;
    active: boolean;
    recurring: { interval: string } | null;
  }>(`/prices/${encodeURIComponent(priceId)}`, { metodo: 'GET' });

  return {
    id: p.id,
    montoMensual: (p.unit_amount ?? 0) / 100,
    moneda: p.currency.toUpperCase(),
    recurrente: p.recurring !== null,
    activo: p.active,
  };
}

// ── Checkout ───────────────────────────────────────────────────────────────

/**
 * Crea la sesión de pago y devuelve a dónde mandar al cliente.
 *
 * `client_reference_id` y `metadata.tenant_id` llevan LA MISMA flota, a
 * propósito: el webhook necesita saber de quién es el pago y `client_reference_id`
 * no viaja en todos los eventos. Sin eso, un pago entra sin poder atribuirse y
 * queda cobrado sin activarle el plan a nadie.
 */
export async function crearCheckout(opciones: {
  priceId: string;
  tenantId: string;
  email?: string;
  customerId?: string;
  urlExito: string;
  urlCancelar: string;
}): Promise<string> {
  const s = await pedir<{ url: string | null }>('/checkout/sessions', {
    cuerpo: {
      mode: 'subscription',
      line_items: [{ price: opciones.priceId, quantity: 1 }],
      success_url: opciones.urlExito,
      cancel_url: opciones.urlCancelar,
      client_reference_id: opciones.tenantId,
      // Si ya es cliente de Stripe se reusa: si no, cada suscripción crearía un
      // customer nuevo y el historial de la flota quedaría partido en varios.
      customer: opciones.customerId,
      customer_email: opciones.customerId ? undefined : opciones.email,
      subscription_data: { metadata: { tenant_id: opciones.tenantId } },
      metadata: { tenant_id: opciones.tenantId },
    },
    idempotencia: `checkout-${opciones.tenantId}-${opciones.priceId}`,
  });

  if (!s.url) throw new Error('Stripe no devolvió URL de pago.');
  return s.url;
}

/** El portal donde el cliente cambia su tarjeta o cancela, sin escribirle a nadie. */
export async function crearPortal(customerId: string, urlVolver: string): Promise<string> {
  const s = await pedir<{ url: string }>('/billing_portal/sessions', {
    cuerpo: { customer: customerId, return_url: urlVolver },
  });
  return s.url;
}

// ── Webhook ────────────────────────────────────────────────────────────────

/**
 * Valida la firma del webhook de Stripe.
 *
 * NO ES UN HMAC DEL CUERPO A SECAS, y hacerlo así es el error clásico: Stripe
 * firma `${timestamp}.${cuerpo}`. Un HMAC del cuerpo solo NUNCA valida, y el
 * atajo de "entonces me salto la firma" deja un endpoint que cualquiera puede
 * llamar para activarle el plan a su flota gratis.
 *
 * El TIMESTAMP también se comprueba. Sin eso, una petición firmada y capturada
 * hace un año se puede repetir hoy tal cual: la firma sigue siendo válida.
 *
 * Se compara timing-safe y contra TODAS las `v1` del encabezado — durante una
 * rotación de secreto, Stripe manda dos.
 */
export function verificarFirmaStripe(
  cuerpoCrudo: string,
  encabezado: string | null,
  ahoraS: number = Math.floor(Date.now() / 1000),
): boolean {
  const secreto = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secreto || !encabezado) return false;

  let t: string | undefined;
  const firmas: string[] = [];
  for (const parte of encabezado.split(',')) {
    const [k, v] = parte.split('=', 2);
    if (k?.trim() === 't') t = v?.trim();
    else if (k?.trim() === 'v1' && v) firmas.push(v.trim());
  }
  if (!t || firmas.length === 0) return false;

  const ts = Number(t);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(ahoraS - ts) > TOLERANCIA_S) return false;

  const esperada = crypto.createHmac('sha256', secreto).update(`${t}.${cuerpoCrudo}`).digest('hex');
  const b = Buffer.from(esperada);

  return firmas.some((f) => {
    const a = Buffer.from(f);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}
