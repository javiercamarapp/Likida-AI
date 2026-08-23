import crypto from 'node:crypto';
import { logger } from '@/lib/logger';
import { DatoInvalido } from '@/lib/likida/errores';

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

/** Tope por llamada a la API de Stripe (RES-12). Env por si un día hace falta
 *  moverlo sin desplegar. */
export const TIMEOUT_STRIPE_MS = Number(process.env.LIKIDA_TIMEOUT_STRIPE_MS) || 15_000;

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
 * IMPIDE OPERAR EN PRODUCCIÓN CON UNA LLAVE DE PRUEBA (auditoría prod
 * 22-ago-2026, DAT-32).
 *
 * Es el mismo candado que `facturapi.ts` ya tenía, y falta aquí por el mismo
 * motivo por el que allá hacía falta: una `sk_test` pegada por error en
 * producción NO falla. Crea customers, crea suscripciones, devuelve URLs de
 * factura con la misma forma que las reales — y no cobra un peso. La flota ve
 * "Suscripción creada", transfiere a una CLABE de sandbox que no existe, y
 * nadie se entera hasta que alguien pregunta por qué no ha entrado dinero.
 *
 * `modoStripe()` ya sabía distinguirlas y solo lo usaba la pantalla para pintar
 * un aviso amarillo. Un aviso se lee una vez y se cierra; esto se para.
 */
export function exigirLlaveCoherente(): void {
  const entorno = process.env.VERCEL_ENV ?? process.env.NODE_ENV;
  if (entorno === 'production' && modoStripe() === 'prueba') {
    throw new DatoInvalido(
      'La llave de Stripe en producción es de PRUEBA (sk_test). Con ella se crean suscripciones que se ven ' +
      'reales y no cobran nada: la flota creería que ya contrató. No se opera hasta poner la llave sk_live.',
    );
  }
}

/**
 * ¿El evento viene del MISMO modo (prueba/producción) que la llave con la que
 * operamos? (DAT-32)
 *
 * La firma del webhook no lo contesta: el secreto es del ENDPOINT, y un mismo
 * secreto pegado en los dos modos —o un endpoint de prueba apuntando a
 * producción— entrega eventos de sandbox que la base no distingue de los
 * reales. `livemode` es el único campo que lo dice, y un evento sin `livemode`
 * no es un evento de Stripe: se rechaza igual.
 *
 * Sin llave no hay modo con el cual comparar, así que tampoco se aplica: no se
 * escribe un cobro que nadie puede confirmar.
 */
export function eventoEnModoDeLaLlave(livemode: unknown): boolean {
  const modo = modoStripe();
  if (modo === null) return false;
  if (typeof livemode !== 'boolean') return false;
  return livemode === (modo === 'produccion');
}

/**
 * El error de Stripe CON SU CÓDIGO. `pedir` lanzaba un Error pelón con el
 * mensaje adentro, y quien lo atrapaba solo podía hacer `includes()` sobre un
 * texto que Stripe puede reescribir cuando quiera. El código sí es contrato
 * (`idempotency_error`, `resource_missing`, …).
 */
export class ErrorStripe extends Error {
  constructor(mensaje: string, readonly codigo: string | null, readonly status: number) {
    super(mensaje);
    this.name = 'ErrorStripe';
  }
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
  // DAT-32: antes de hablar con Stripe, que la llave sea del modo del entorno.
  // Va aquí y no en cada llamador porque el que se olvide de ponerlo es
  // exactamente el camino que va a cobrar en falso.
  exigirLlaveCoherente();
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
    // ── TECHO (auditoría prod 22-ago-2026, RES-12) ────────────────────────
    //
    // Sin señal, este `fetch` heredaba el default de undici —300 s— dentro de
    // rutas que tienen 60. Un Stripe lento se llevaba la invocación entera y
    // el usuario veía un timeout de la plataforma sin un solo log nuestro.
    // 15 s: la API de Stripe contesta en cientos de ms; 15 ya es "está mal".
    // El `Idempotency-Key` de arriba es lo que hace seguro rendirse pronto —
    // un reintento sobre la misma llave no crea una segunda suscripción.
    signal: AbortSignal.timeout(TIMEOUT_STRIPE_MS),
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
    throw new ErrorStripe(
      `Stripe ${ruta}: ${err?.message ?? `HTTP ${r.status}`}`,
      err?.code ?? null,
      r.status,
    );
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
  /**
   * ¿`montoMensual` ya trae el IVA?
   *
   * `true` = sí (`tax_behavior: 'inclusive'`), `false` = el IVA va encima
   * (`'exclusive'`), `null` = Stripe NO lo declara (`'unspecified'`, que es el
   * default cuando nadie configuró impuestos en el price).
   *
   * `null` no es "no lleva IVA": es "no se sabe", y con eso no se puede ni
   * cobrar ni timbrar. Ver `lib/saas/iva.ts`.
   */
  ivaIncluido: boolean | null;
}

/**
 * Lee un price de Stripe. Es lo que hace que la cifra de la pantalla no pueda
 * divergir de la que se cobra: el panel NO deja teclear el monto, lo trae de
 * aquí al guardar el price id.
 *
 * `unit_amount` viene en la unidad mínima (centavos). Dividir mal es un error
 * de dos órdenes de magnitud que se ve plausible: $24.00 en vez de $2,400.00.
 *
 * SE TRAE TAMBIÉN EL `tax_behavior`, Y ES LA MITAD QUE FALTABA. El monto solo
 * no dice cuánto cobrar: $10,000 con el IVA adentro y $10,000 con el IVA aparte
 * son $10,000 y $11,600 en la cuenta del cliente. Ese campo es la única fuente
 * que puede resolverlo —está en el price, junto al monto— y por eso viaja con
 * él en vez de capturarse aparte, exactamente por el mismo motivo que el monto
 * no se teclea: dos cifras capturadas por separado divergen.
 */
export async function leerPrecio(priceId: string): Promise<PrecioStripe> {
  const p = await pedir<{
    id: string;
    unit_amount: number | null;
    currency: string;
    active: boolean;
    recurring: { interval: string } | null;
    tax_behavior?: string | null;
  }>(`/prices/${encodeURIComponent(priceId)}`, { metodo: 'GET' });

  return {
    id: p.id,
    montoMensual: (p.unit_amount ?? 0) / 100,
    moneda: p.currency.toUpperCase(),
    recurrente: p.recurring !== null,
    activo: p.active,
    // Cualquier valor que no sea uno de los dos explícitos cae en `null`. Un
    // `tax_behavior` nuevo de Stripe que aquí se leyera como "exclusive" por
    // descarte volvería a producir el CFDI de más.
    ivaIncluido: p.tax_behavior === 'inclusive' ? true : p.tax_behavior === 'exclusive' ? false : null,
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

// ── Cobro por TRANSFERENCIA (SPEI) ─────────────────────────────────────────

export interface DatosFiscales {
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  codigoPostal: string;
  email: string;
}

/**
 * Crea la suscripción que la flota paga por TRANSFERENCIA, no con tarjeta.
 *
 * POR QUÉ ESTE CAMINO Y NO EL CHECKOUT. Medido el 4-ago-2026 en siete empresas
 * del mercado —competidores de IA, Nowports, Yalo, leadsales y las tres de rastreo de
 * flotas—: ninguna publica precio ni tiene pasarela en su sitio. Se cotiza, se
 * factura y se cobra por SPEI. Un contralor no paga la mensualidad con tarjeta.
 *
 * Y ES QUE NO SE PUEDE HACER CON CHECKOUT, aunque se quisiera: la propia
 * documentación de Stripe dice que las transferencias bancarias NO son
 * compatibles con Checkout en modo suscripción. El camino es
 * `collection_method: send_invoice` — Stripe emite la factura con la CLABE y la
 * referencia, y el webhook `invoice.paid` avisa cuando el dinero llega.
 *
 * LOS DATOS FISCALES SE EXIGEN ANTES DE COBRAR, no después. Cobrarle a alguien
 * a quien luego no le puedes facturar es el peor orden posible: ya tienes su
 * dinero y no lo puede deducir. El RFC va como `tax_id` del customer para que
 * la factura de Stripe ya salga a su nombre.
 *
 * OJO: esto NO emite el CFDI. Stripe cobra; el CFDI lo timbra un PAC, y eso es
 * una integración aparte que necesita el CSD del SAT de Likida.
 */
export async function crearSuscripcionPorTransferencia(opciones: {
  priceId: string;
  tenantId: string;
  fiscales: DatosFiscales;
  customerId?: string;
  /** Días que tiene la flota para transferir antes de que la factura venza. */
  diasParaPagar?: number;
}): Promise<{ subscriptionId: string; customerId: string; urlFactura: string | null }> {
  const { fiscales, diasParaPagar = 15 } = opciones;

  let customerId = opciones.customerId;
  if (!customerId) {
    const c = await pedir<{ id: string }>('/customers', {
      cuerpo: {
        name: fiscales.razonSocial,
        email: fiscales.email,
        address: { postal_code: fiscales.codigoPostal, country: 'MX' },
        // `mx_rfc` es el tipo de tax id que Stripe usa para México: hace que su
        // propia factura salga con el RFC del receptor.
        tax_id_data: [{ type: 'mx_rfc', value: fiscales.rfc }],
        metadata: { tenant_id: opciones.tenantId, regimen_fiscal: fiscales.regimenFiscal },
      },
      // LA CLAVE INCLUYE LOS DATOS, no solo la flota (DAT-40). Era
      // `customer-${tenantId}` a secas: un RFC mal tecleado se quedaba pegado
      // 24 horas —lo que dura una clave en Stripe—, porque el reintento con el
      // RFC corregido llega con la MISMA clave y parámetros distintos, y eso
      // Stripe lo contesta con un error que nadie entiende ("Keys for
      // idempotent requests can only be used with the same parameters").
      // Con el hash adentro: mismo dato = misma clave (reintento seguro), dato
      // corregido = clave nueva (pasa).
      idempotencia: `customer-${opciones.tenantId}-${huella(fiscales)}`,
    });
    customerId = c.id;
  }

  const s = await pedir<{
    id: string;
    latest_invoice: { hosted_invoice_url?: string | null } | string | null;
  }>('/subscriptions', {
    cuerpo: {
      customer: customerId,
      items: [{ price: opciones.priceId }],
      collection_method: 'send_invoice',
      days_until_due: diasParaPagar,
      payment_settings: {
        payment_method_types: ['customer_balance'],
        payment_method_options: {
          customer_balance: {
            funding_type: 'bank_transfer',
            bank_transfer: { type: 'mx_bank_transfer' },
          },
        },
      },
      metadata: { tenant_id: opciones.tenantId },
      'expand[]': 'latest_invoice',
    },
    // ── LA CLAVE YA NO LLEVA EL PRICE (DAT-04) ──────────────────────────────
    //
    // Con el price adentro, "contratar Flota" y "contratar Empresa" eran dos
    // claves distintas: el segundo clic —el de quien no vio reflejado el
    // primero porque el webhook aún no llegaba— creaba una SEGUNDA suscripción
    // VIVA en Stripe. Las dos cobran. La base ni se entera: la fila local nace
    // con el webhook, y el de la segunda revienta contra `suscripcion_una_viva`.
    //
    // Sin el price, el segundo intento con otro plan choca contra la clave y
    // Stripe lo RECHAZA en vez de duplicar el cobro; `crearSuscripcionPorTransferencia`
    // traduce ese rechazo abajo a una frase que se entiende. Fallar cerrado en
    // el peor caso es un mensaje; el bug era una mensualidad de más al mes,
    // todos los meses, sin que nadie la viera.
    idempotencia: `sub-transfer-${opciones.tenantId}`,
  }).catch((e: unknown) => {
    if (e instanceof ErrorStripe && e.codigo === 'idempotency_error') {
      throw new DatoInvalido(
        'Ya se mandó una contratación para esta flota hace un momento y todavía no se refleja. No se crea una ' +
        'segunda suscripción: serían dos mensualidades cobrándose a la vez. Espera a que aparezca (o recarga) y, ' +
        'si querías otro plan, cámbialo desde el plan que quede.',
      );
    }
    throw e;
  });

  const inv = s.latest_invoice;
  const urlFactura = inv && typeof inv === 'object' ? (inv.hosted_invoice_url ?? null) : null;
  return { subscriptionId: s.id, customerId, urlFactura };
}

/** Los datos con los que se creó el customer, resumidos a 16 hex. Cambia si
 *  cambia cualquiera: es lo que separa "reintento" de "corrección". */
function huella(f: DatosFiscales): string {
  const material = [f.rfc, f.razonSocial, f.regimenFiscal, f.codigoPostal, f.email].join('|');
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 16);
}

// ── Lo que Stripe SÍ sabe y la base puede no saber ─────────────────────────

export interface SuscripcionStripe {
  id: string;
  /** El estado crudo de Stripe (`active`, `canceled`, `incomplete`…). */
  status: string;
  priceId: string | null;
}

/** Los estados de Stripe en los que una suscripción SIGUE PUDIENDO COBRAR.
 *  `incomplete` entra a propósito: todavía no cobró, pero puede hacerlo — y
 *  crear otra al lado sería exactamente el doble cobro que esto evita. */
const VIVAS = new Set(['trialing', 'active', 'past_due', 'unpaid', 'paused', 'incomplete']);

export function suscripcionVivaEnStripe(status: string): boolean {
  return VIVAS.has(status);
}

/**
 * TODAS las suscripciones de un customer, vivas y muertas (DAT-04).
 *
 * LA BASE NO ES LA FUENTE DE LA VERDAD DE STRIPE. La fila local nace cuando
 * llega el webhook, así que entre el clic y el webhook —o para siempre, si el
 * webhook falló— hay una suscripción cobrando que aquí no existe. Decidir
 * "crear o actualizar" mirando solo la base es decidirlo con los ojos cerrados:
 * es lo que producía la segunda suscripción viva.
 *
 * `status=all` a propósito: filtrar por 'active' dejaría fuera `past_due` e
 * `incomplete`, que también cobran o van a cobrar.
 */
export async function suscripcionesDeCustomer(customerId: string): Promise<SuscripcionStripe[]> {
  const r = await pedir<{
    data?: Array<{ id: string; status: string; items?: { data?: Array<{ price?: { id?: string } }> } }>;
  }>('/subscriptions', {
    metodo: 'GET',
    cuerpo: { customer: customerId, status: 'all', limit: 100 },
  });

  return (r.data ?? []).map((s) => ({
    id: s.id,
    status: s.status,
    priceId: s.items?.data?.[0]?.price?.id ?? null,
  }));
}

/**
 * CAMBIA EL PRICE DE UNA SUSCRIPCIÓN QUE YA EXISTE, en vez de crear una nueva.
 *
 * ES EL CAMINO CANÓNICO PARA "CAMBIAR DE PLAN" (auditoría 2, hallazgo real).
 * `crearSuscripcionPorTransferencia` SIEMPRE crea un objeto de suscripción
 * nuevo en Stripe; si "cambiar de plan" la llamara sin más, la flota terminaría
 * con DOS suscripciones vivas —la vieja nadie la tocó— y Stripe le cobraría
 * las dos mensualidades. El índice único de la 0052 ("una viva por tenant")
 * solo se entera de eso cuando el webhook intenta insertar la segunda fila y
 * revienta la restricción: para entonces las dos ya cobraron.
 *
 * Actualizar el PRICE de la MISMA suscripción evita el doble cobro por
 * construcción — sigue habiendo un solo objeto de Stripe, con el mismo
 * `collection_method: send_invoice` y los mismos `payment_settings` que ya
 * tenía (no se repiten aquí: Stripe los conserva si no se mandan).
 *
 * Se lee la suscripción primero porque el update pide el `item.id` a
 * reemplazar, no solo el price nuevo — mandar el price solo AGREGARÍA un
 * segundo item a la misma suscripción en vez de sustituir el primero, que es
 * su propia variante del mismo bug.
 */
export async function cambiarPriceDeSuscripcion(opciones: {
  subscriptionId: string;
  priceId: string;
}): Promise<{ subscriptionId: string }> {
  const actual = await pedir<{ id: string; items: { data: Array<{ id: string }> } }>(
    `/subscriptions/${encodeURIComponent(opciones.subscriptionId)}`,
    { metodo: 'GET' },
  );

  const itemId = actual.items?.data?.[0]?.id;
  if (!itemId) {
    throw new Error(`Stripe subscriptions/${opciones.subscriptionId}: no tiene ningún item que reemplazar.`);
  }

  const s = await pedir<{ id: string }>(`/subscriptions/${encodeURIComponent(opciones.subscriptionId)}`, {
    cuerpo: { items: [{ id: itemId, price: opciones.priceId }] },
    // Sin esto, un reintento de red mandaría el mismo cambio dos veces — inofensivo
    // aquí porque es idempotente por naturaleza (fija el price, no lo acumula),
    // pero la misma disciplina que el resto del archivo.
    idempotencia: `sub-update-${opciones.subscriptionId}-${opciones.priceId}`,
  });

  return { subscriptionId: s.id };
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
