import { supabaseAdmin } from '@/lib/supabase/admin';
import { exigir } from '@/lib/likida/pg';
import { logger } from '@/lib/logger';
import {
  leerPrecio, cambiarPriceDeSuscripcion, crearSuscripcionPorTransferencia,
  type DatosFiscales,
} from './stripe';
import { DatoInvalido } from '@/lib/likida/errores';

// ═══════════════════════════════════════════════════════════════════════════
// LA SUSCRIPCIÓN DE UNA FLOTA A LIKIDA — lectura para el panel y escritura
// desde el webhook de Stripe.
//
// Ojo con el nombre, porque el esquema tiene lo contrario a un paso:
//   · `factura_emitida` (0049) = la flota le factura A SU CLIENTE.
//   · `factura_saas`    (0052) = Likida le factura A LA FLOTA.
// Este archivo es SOLO lo segundo.
//
// TODO FALLA CERRADO. supabase-js reporta los errores POR VALOR: sin `exigir`,
// una base caída se lee como "esta flota no tiene suscripción" y el panel le
// diría a un cliente que paga que no tiene plan.
// ═══════════════════════════════════════════════════════════════════════════

export interface Plan {
  clave: string;
  nombre: string;
  /** NULL = sin precio configurado. NUNCA se inventa: se lee de Stripe. */
  precioMensual: number | null;
  moneda: string;
  /**
   * ¿`precioMensual` ya trae el IVA?
   *
   * `null` = nadie lo declaró, y entonces NO se emite ni se timbra: no se sabe
   * si el cliente debe transferir el precio o el precio × 1.16. Ver
   * `lib/saas/iva.ts`; se llena solo desde el `tax_behavior` del price.
   */
  precioIvaIncluido: boolean | null;
  limiteViajesMes: number | null;
  limiteOperadores: number | null;
  stripePriceId: string | null;
  orden: number;
}

export interface Suscripcion {
  id: string;
  tenantId: string;
  planClave: string;
  planNombre: string;
  estado: 'prueba' | 'activa' | 'morosa' | 'pausada' | 'cancelada';
  inicio: string;
  periodoFin: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export interface FacturaSaas {
  id: string;
  periodoInicio: string;
  periodoFin: string;
  /** EL TOTAL QUE SE TRANSFIERE, con IVA. Es lo que se enseña en pantalla. */
  monto: number;
  /** Base sin IVA. `null` = factura sin desglose (anterior a la 0065, o de
   *  Stripe): no se puede timbrar sin saber cuál de las dos cifras era. */
  subtotal: number | null;
  /** IVA trasladado. `null` va siempre junto con `subtotal` null. */
  iva: number | null;
  moneda: string;
  estado: 'pendiente' | 'pagada' | 'fallida' | 'cancelada';
  pagadaEn: string | null;
  /** Donde el cliente ve la CLABE para transferir. */
  urlPago: string | null;
  /** Folio fiscal. `null` = cobrada pero SIN TIMBRAR: pagó y no puede deducir. */
  cfdiUuid: string | null;
  /** Lo que el cliente escribe en el concepto de su transferencia (0057). */
  referencia: string | null;
}

function fila<T>(r: { data: unknown; error: { message: string } | null }, consulta: string): T | null {
  return exigir(r as { data: T | null; error: { message: string } | null }, consulta);
}

// ── Lectura ────────────────────────────────────────────────────────────────

export async function getPlanes(): Promise<Plan[]> {
  const r = await supabaseAdmin()
    .from('plan')
    .select('clave, nombre, precio_mensual, moneda, precio_iva_incluido, limite_viajes_mes, limite_operadores, stripe_price_id, orden')
    .eq('activo', true)
    .order('orden');

  const datos = fila<Array<Record<string, unknown>>>(r, 'getPlanes') ?? [];
  return datos.map((p) => ({
    clave: p.clave as string,
    nombre: p.nombre as string,
    // `null` y `0` son cosas distintas: sin configurar vs. gratis.
    precioMensual: p.precio_mensual === null ? null : Number(p.precio_mensual),
    moneda: (p.moneda as string) ?? 'MXN',
    // Igual que arriba: `null` y `false` son cosas distintas. `undefined` (una
    // base sin la 0065 aplicada) cae en `null`, que es el lado que no cobra.
    precioIvaIncluido: p.precio_iva_incluido === null || p.precio_iva_incluido === undefined
      ? null
      : Boolean(p.precio_iva_incluido),
    limiteViajesMes: p.limite_viajes_mes === null ? null : Number(p.limite_viajes_mes),
    limiteOperadores: p.limite_operadores === null ? null : Number(p.limite_operadores),
    stripePriceId: (p.stripe_price_id as string) || null,
    orden: Number(p.orden ?? 0),
  }));
}

/**
 * La suscripción VIVA de la flota, o null si nunca ha tenido una.
 *
 * "Viva" son los cuatro estados que no son `cancelada` — el mismo criterio del
 * índice único de la 0052. Una cancelada NO se devuelve como si fuera la
 * actual: el panel diría "tu plan es Flota" de alguien que ya se fue.
 */
export async function getSuscripcion(tenantId: string): Promise<Suscripcion | null> {
  const r = await supabaseAdmin()
    .from('suscripcion')
    .select('id, tenant_id, plan_clave, estado, inicio, periodo_fin, stripe_customer_id, stripe_subscription_id, plan(nombre)')
    .eq('tenant_id', tenantId)
    .in('estado', ['prueba', 'activa', 'morosa', 'pausada'])
    .maybeSingle();

  const s = fila<Record<string, unknown>>(r, 'getSuscripcion');
  if (!s) return null;

  const planRel = s.plan as { nombre?: string } | Array<{ nombre?: string }> | null;
  const nombre = Array.isArray(planRel) ? planRel[0]?.nombre : planRel?.nombre;

  return {
    id: s.id as string,
    tenantId: s.tenant_id as string,
    planClave: s.plan_clave as string,
    planNombre: nombre ?? (s.plan_clave as string),
    estado: s.estado as Suscripcion['estado'],
    inicio: s.inicio as string,
    periodoFin: (s.periodo_fin as string) || null,
    stripeCustomerId: (s.stripe_customer_id as string) || null,
    stripeSubscriptionId: (s.stripe_subscription_id as string) || null,
  };
}

export async function getFacturasSaas(tenantId: string, limite = 12): Promise<FacturaSaas[]> {
  const r = await supabaseAdmin()
    .from('factura_saas')
    .select('id, periodo_inicio, periodo_fin, monto, subtotal, iva, moneda, estado, pagada_en, url_pago, cfdi_uuid, referencia')
    .eq('tenant_id', tenantId)
    .order('periodo_fin', { ascending: false })
    .limit(limite);

  const datos = fila<Array<Record<string, unknown>>>(r, 'getFacturasSaas') ?? [];
  return datos.map((f) => ({
    id: f.id as string,
    periodoInicio: f.periodo_inicio as string,
    periodoFin: f.periodo_fin as string,
    monto: Number(f.monto),
    subtotal: f.subtotal === null || f.subtotal === undefined ? null : Number(f.subtotal),
    iva: f.iva === null || f.iva === undefined ? null : Number(f.iva),
    moneda: (f.moneda as string) ?? 'MXN',
    estado: f.estado as FacturaSaas['estado'],
    pagadaEn: (f.pagada_en as string) || null,
    urlPago: (f.url_pago as string) || null,
    cfdiUuid: (f.cfdi_uuid as string) || null,
    referencia: (f.referencia as string) || null,
  }));
}

export interface UsoDelPlan {
  viajesMes: number;
  operadores: number;
  limiteViajesMes: number | null;
  limiteOperadores: number | null;
}

/**
 * Cuánto lleva usado la flota este mes contra su límite.
 *
 * SE ENSEÑA, NO SE BLOQUEA. Cortarle la liquidación a una flota a medio mes por
 * pasarse del plan es el peor momento posible para descubrir un límite: sus
 * choferes ya mandaron los comprobantes y el contralor ya cuenta con el cierre.
 * El límite sirve para hablar de subir de plan, no para apagar el producto.
 *
 * `null` en el límite es SIN LÍMITE, no cero.
 */
export async function getUso(tenantId: string, plan: Plan | null, hoy = new Date()): Promise<UsoDelPlan> {
  const inicioMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)).toISOString();
  const admin = supabaseAdmin();

  const [viajes, operadores] = await Promise.all([
    admin.from('viaje').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).gte('created_at', inicioMes),
    admin.from('operador').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('activo', true),
  ]);

  if (viajes.error) throw new Error(`getUso.viaje: ${viajes.error.message}`);
  if (operadores.error) throw new Error(`getUso.operador: ${operadores.error.message}`);

  return {
    viajesMes: viajes.count ?? 0,
    operadores: operadores.count ?? 0,
    limiteViajesMes: plan?.limiteViajesMes ?? null,
    limiteOperadores: plan?.limiteOperadores ?? null,
  };
}

// ── Escritura desde /admin ─────────────────────────────────────────────────

/**
 * Liga un plan con su price de Stripe Y COPIA EL MONTO DESDE STRIPE.
 *
 * El monto NO se teclea. Si se capturaran por separado, la pantalla podría
 * decir "$2,400/mes" mientras Stripe cobra otra cosa, y esa diferencia la
 * descubre el cliente en su estado de cuenta — con toda la razón de reclamar.
 * Aquí Stripe es la verdad y la base la espeja.
 *
 * Se rechaza un price que no sea recurrente: un pago único puesto como
 * mensualidad cobra una vez y deja a la flota con el plan activo para siempre.
 *
 * SE RECHAZA TAMBIÉN LO QUE NO SEA MXN. Todo el producto imprime dinero con
 * `mxn()`, así que un price en USD se pintaría idéntico a uno en pesos: la
 * pantalla diría "$10,000" de un cobro de 10,000 DÓLARES. La moneda se guardaba
 * pero no la miraba nadie, y la única señal de la diferencia era un texto de
 * confirmación que se lee una vez y se cierra.
 *
 * EL `tax_behavior` VIAJA CON EL MONTO. Se copia como `precio_iva_incluido` por
 * la misma razón que el monto no se teclea: es la otra mitad de "cuánto se
 * cobra", y capturada aparte divergiría. Un price con `tax_behavior:
 * 'unspecified'` SÍ se guarda —el precio es real y la pantalla lo enseña— pero
 * queda con el criterio en `null`, y con eso `emitirMensualidad` se niega. Se
 * prefiere guardar y bloquear a rechazar el guardado: así /admin puede decir
 * qué falta en vez de dejar el plan como si no tuviera precio, que es otro
 * problema y se ve igual.
 */
export async function guardarPriceDePlan(
  planClave: string,
  priceId: string,
): Promise<{ montoMensual: number; moneda: string; ivaIncluido: boolean | null }> {
  const limpio = priceId.trim();
  if (!limpio) throw new DatoInvalido('Falta el ID del price de Stripe.');
  if (!limpio.startsWith('price_')) {
    throw new DatoInvalido(`"${limpio}" no parece un price de Stripe: empiezan con "price_". Un product (prod_…) no sirve para cobrar.`);
  }

  const precio = await leerPrecio(limpio);
  if (!precio.recurrente) {
    throw new DatoInvalido('Ese price es de pago único, no de suscripción. Cobraría una vez y la flota se quedaría con el plan activo para siempre.');
  }
  if (!precio.activo) {
    throw new DatoInvalido('Ese price está archivado en Stripe: no se puede cobrar con él.');
  }
  if (precio.moneda !== 'MXN') {
    throw new DatoInvalido(
      `Ese price cobra en ${precio.moneda}, no en pesos. Todo el panel imprime con formato de peso mexicano, así que ` +
      `un price en ${precio.moneda} se vería idéntico a uno en MXN y el cliente descubriría la diferencia en su ` +
      'estado de cuenta. Crea el price en MXN.',
    );
  }

  const r = await supabaseAdmin()
    .from('plan')
    .update({
      stripe_price_id: precio.id,
      precio_mensual: precio.montoMensual,
      moneda: precio.moneda,
      precio_iva_incluido: precio.ivaIncluido,
    })
    .eq('clave', planClave);

  if (r.error) throw new Error(`guardarPriceDePlan: ${r.error.message}`);
  return { montoMensual: precio.montoMensual, moneda: precio.moneda, ivaIncluido: precio.ivaIncluido };
}

// ── Escritura desde /dashboard/suscripcion ──────────────────────────────────

/**
 * CONTRATA o CAMBIA de plan por transferencia — la misma acción del panel de
 * la flota para las dos cosas (auditoría 2, hallazgo real: "cambiar de plan
 * crea una segunda suscripción sin cancelar la primera").
 *
 * SI YA HAY UNA SUSCRIPCIÓN VIVA CON ID DE STRIPE, se ACTUALIZA el price de
 * ESA MISMA suscripción (`cambiarPriceDeSuscripcion`) — nunca se crea una
 * segunda. Antes de este fix, la pantalla llamaba directo a
 * `crearSuscripcionPorTransferencia`, que SIEMPRE crea una suscripción nueva:
 * la flota terminaba con dos suscripciones vivas en Stripe, cada una cobrando
 * su mensualidad, y la base solo se enteraba cuando el webhook de la segunda
 * chocaba contra el índice único de la 0052 ("una viva por tenant") — para
 * entonces las dos ya habían cobrado.
 *
 * SI NO HAY SUSCRIPCIÓN VIVA (primera contratación) o la que hay no tiene id
 * de Stripe (la de prueba que se crea a mano), se crea una nueva como antes.
 *
 * FALLA CERRADO A PROPÓSITO: esta función NO toca la base. El estado real
 * —qué plan, qué precio, qué periodo— lo escribe `aplicarSuscripcion` cuando
 * llega el webhook (`customer.subscription.updated`/`.created`), que es la
 * única fuente que sabe si Stripe de verdad cobró. Si la llamada a Stripe
 * truena a la mitad, no queda ninguna fila en `suscripcion` diciendo que hay
 * un plan nuevo, ni una segunda suscripción cobrando: el panel simplemente
 * sigue enseñando el plan y el precio de antes hasta que el reintento (del
 * usuario, dando clic de nuevo) tenga éxito.
 */
export async function cambiarPlan(opciones: {
  tenantId: string;
  priceId: string;
  fiscales: DatosFiscales;
  suscripcionActual: Suscripcion | null;
}): Promise<{ subscriptionId: string; customerId: string | null; urlFactura: string | null; huboCambioDePrice: boolean }> {
  const { tenantId, priceId, fiscales, suscripcionActual } = opciones;

  if (suscripcionActual?.stripeSubscriptionId) {
    const r = await cambiarPriceDeSuscripcion({
      subscriptionId: suscripcionActual.stripeSubscriptionId,
      priceId,
    });
    return {
      subscriptionId: r.subscriptionId,
      customerId: suscripcionActual.stripeCustomerId,
      // No hay factura nueva que enseñar: se actualizó la suscripción, no se
      // creó una. El próximo cobro de Stripe (con la prorrata, si aplica)
      // llega por el webhook de siempre.
      urlFactura: null,
      huboCambioDePrice: true,
    };
  }

  const r = await crearSuscripcionPorTransferencia({
    priceId,
    tenantId,
    fiscales,
    customerId: suscripcionActual?.stripeCustomerId ?? undefined,
  });
  return { subscriptionId: r.subscriptionId, customerId: r.customerId, urlFactura: r.urlFactura, huboCambioDePrice: false };
}

// ── Escritura desde el webhook ─────────────────────────────────────────────

/**
 * El CICLO DE VIDA del evento (0132, auditoría 5) — antes esto era un booleano
 * y la marca se BORRABA si aplicar fallaba; si el delete también fallaba
 * quedaba la "marca huérfana": evento marcado que nunca se aplicó y que el
 * reintento de Stripe saltaría para siempre.
 *
 * Ahora la marca no se borra jamás y `aplicado_en` dice la verdad:
 *  · 'nueva'     → el insert ganó (el candado sigue siendo la llave primaria;
 *                  un select antes tendría la carrera justo en medio);
 *  · 'pendiente' → ya estaba PERO sin aplicar: un intento anterior murió a
 *                  medias — se RE-aplica (aplicarSuscripcion/aplicarFactura
 *                  son idempotentes: fijan estado, no acumulan);
 *  · 'aplicada'  → ya estaba y aplicada: el reintento contesta "repetido".
 */
export type MarcaEvento = 'nueva' | 'pendiente' | 'aplicada';

export async function marcarEvento(id: string, tipo: string, payload: unknown): Promise<MarcaEvento> {
  const { error } = await supabaseAdmin()
    .from('evento_stripe')
    .insert({ id, tipo, payload: payload ?? null, aplicado_en: null });

  if (!error) return 'nueva';
  // 23505 = unique_violation: ya estaba. ¿Aplicada o a medio morir?
  if ((error as { code?: string }).code === '23505') {
    const { data, error: eSel } = await supabaseAdmin()
      .from('evento_stripe').select('aplicado_en').eq('id', id).maybeSingle();
    // Si ni leer se puede, se lanza: el 500 hace que Stripe reintente, que es
    // exactamente el comportamiento seguro cuando no sabemos en qué quedó.
    if (eSel) throw new Error(`marcarEvento/leer: ${eSel.message}`);
    if (data?.aplicado_en) {
      logger.info('stripe.evento_repetido', { id, tipo });
      return 'aplicada';
    }
    logger.warn('stripe.evento_pendiente_reaplicando', { id, tipo });
    return 'pendiente';
  }
  throw new Error(`marcarEvento: ${error.message}`);
}

/**
 * Sella el evento como aplicado. Si el sello falla, el evento SÍ se aplicó:
 * se loguea fuerte y NO se lanza — un 500 aquí haría que Stripe reintentara
 * un aplique ya hecho (inofensivo por idempotencia, pero ruido); y la fila
 * sin sello queda visible en la base para el reconciliador, no solo en un log.
 */
export async function sellarEventoAplicado(id: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('evento_stripe').update({ aplicado_en: new Date().toISOString() }).eq('id', id);
  if (error) logger.error('stripe.evento_sin_sello', { id, err: error.message });
}

/** Mapea el estado de Stripe al dominio de `suscripcion.estado` (0052). */
export function estadoDesdeStripe(estadoStripe: string): Suscripcion['estado'] {
  switch (estadoStripe) {
    case 'trialing': return 'prueba';
    case 'active': return 'activa';
    // `past_due` y `unpaid` son moroso: la flota SIGUE trabajando y hay que
    // cobrarle, no apagarle el producto.
    case 'past_due':
    case 'unpaid': return 'morosa';
    case 'paused': return 'pausada';
    case 'canceled':
    case 'incomplete_expired': return 'cancelada';
    // `incomplete` es un checkout que no terminó de pagarse: todavía no es una
    // suscripción viva. Se trata como prueba para no activarle el plan a quien
    // no completó el pago.
    default: return 'prueba';
  }
}

/**
 * Aplica el estado de una suscripción de Stripe a la base.
 *
 * UPSERT POR `stripe_subscription_id`, no por tenant: una flota puede haber
 * cancelado y vuelto a contratar, y la anterior tiene que seguir siendo
 * auditable en vez de sobrescribirse.
 */
export async function aplicarSuscripcion(datos: {
  tenantId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string | null;
  planClave: string;
  estado: Suscripcion['estado'];
  periodoFin: string | null;
  /**
   * `evt.created` del evento que trae este estado (segundos Unix). Es lo único
   * que ordena dos eventos de la MISMA suscripción; ver `ordenAplicado`.
   * Opcional para no romper a los llamadores que no lo tengan: sin él se
   * aplica como siempre (el comportamiento de antes de RES-11).
   */
  eventoCreadoUnix?: number;
}): Promise<void> {
  const admin = supabaseAdmin();

  // ── STRIPE NO PROMETE ORDEN (auditoría prod 22-ago-2026, RES-11) ────────
  //
  // La documentación lo dice sin rodeos: los eventos pueden llegar
  // desordenados. Y el reintento lo agrava — un `customer.subscription.deleted`
  // entregado bien, seguido del reintento de un `.updated` de hace dos días,
  // dejaba a una flota CANCELADA de vuelta en 'activa'. Esta función fija
  // estado (no acumula), así que el último en escribir gana, y el último en
  // llegar no es el último en pasar.
  //
  // El orden se guarda por suscripción y se compara aquí. Un evento más viejo
  // que el ya aplicado se descarta CON LOG: no es un fallo (no se lanza, el
  // webhook lo sella y contesta 200 — reintentarlo daría el mismo resultado).
  if (datos.eventoCreadoUnix !== undefined) {
    const ultimo = await ordenAplicado(datos.stripeSubscriptionId);
    if (ultimo !== null && datos.eventoCreadoUnix < ultimo) {
      logger.warn('stripe.evento_fuera_de_orden', {
        sub: datos.stripeSubscriptionId, creado: datos.eventoCreadoUnix, ultimoAplicado: ultimo,
        estadoQueTraia: datos.estado,
      });
      return;
    }
  }

  const existente = await admin
    .from('suscripcion')
    .select('id')
    .eq('stripe_subscription_id', datos.stripeSubscriptionId)
    .maybeSingle();
  if (existente.error) throw new Error(`aplicarSuscripcion.buscar: ${existente.error.message}`);

  const campos = {
    tenant_id: datos.tenantId,
    plan_clave: datos.planClave,
    estado: datos.estado,
    periodo_fin: datos.periodoFin,
    stripe_customer_id: datos.stripeCustomerId,
    stripe_subscription_id: datos.stripeSubscriptionId,
    // El check `suscripcion_cancelada_coherente` exige que las dos cosas vayan
    // juntas: sin esto, marcar 'cancelada' revienta la restricción.
    cancelada_en: datos.estado === 'cancelada' ? new Date().toISOString() : null,
  };

  if (existente.data) {
    const r = await admin.from('suscripcion').update(campos).eq('id', (existente.data as { id: string }).id);
    if (r.error) throw new Error(`aplicarSuscripcion.update: ${r.error.message}`);
  } else {
    // Si la flota tenía una suscripción viva SIN id de Stripe (la de prueba que
    // se le creó a mano), se cierra: el índice único de la 0052 solo deja una
    // viva por tenant y sin esto el insert choca.
    const previa = await admin
      .from('suscripcion')
      .select('id')
      .eq('tenant_id', datos.tenantId)
      .is('stripe_subscription_id', null)
      .in('estado', ['prueba', 'activa', 'morosa', 'pausada'])
      .maybeSingle();
    if (previa.error) throw new Error(`aplicarSuscripcion.previa: ${previa.error.message}`);
    if (previa.data && datos.estado !== 'cancelada') {
      const c = await admin
        .from('suscripcion')
        .update({ estado: 'cancelada', cancelada_en: new Date().toISOString() })
        .eq('id', (previa.data as { id: string }).id);
      if (c.error) throw new Error(`aplicarSuscripcion.cerrar_previa: ${c.error.message}`);
    }

    const r = await admin.from('suscripcion').insert(campos);
    if (r.error) throw new Error(`aplicarSuscripcion.insert: ${r.error.message}`);
  }

  // `tenant.plan` se mantiene a la par: existe desde la 0001 y varias pantallas
  // lo leen sin consultar `suscripcion`. Desincronizarlos haría que una flota
  // morosa siguiera viéndose como del plan que ya no paga.
  const t = await admin.from('tenant').update({ plan: datos.planClave }).eq('id', datos.tenantId);
  if (t.error) logger.warn('stripe.tenant_plan', { err: t.error.message });

  // El sello del orden va AL FINAL: si algo de arriba falló, la función lanzó
  // y el reintento de Stripe tiene que poder volver a aplicar este mismo
  // evento — con el sello puesto antes, el reintento se vería a sí mismo como
  // "ya hay uno igual de nuevo" solo si fuera estrictamente menor, pero
  // sellar lo que no se aplicó es exactamente la clase de mentira que la
  // marca huérfana de la 0132 vino a matar.
  if (datos.eventoCreadoUnix !== undefined) {
    await sellarOrden(datos.stripeSubscriptionId, datos.eventoCreadoUnix);
  }
}

// ── EL LEDGER DE ORDEN, DENTRO DE `evento_stripe` ──────────────────────────
//
// SIN MIGRACIÓN Y SIN TABLA NUEVA, y sin ensuciar ninguna medición: la marca
// vive en una fila de `evento_stripe` con un id que NINGÚN evento de Stripe
// puede tener (los suyos empiezan con `evt_`) y con `aplicado_en` SIEMPRE
// puesto — el SLO de /admin cuenta las filas con `aplicado_en is null`
// (`admin/slo.ts`), así que estas no lo mueven ni un dígito.
//
// Se lee por llave primaria y se escribe por upsert: nada de consultas por
// camino jsonb, que es donde un filtro mal escrito se lee como "no hay nada"
// y apagaría la protección en silencio.

const llaveOrden = (subId: string) => `orden:${subId}`;

/** `created` (Unix) del último evento APLICADO de esa suscripción, o `null`
 *  si no hay marca todavía o si no se pudo leer (en la duda, se aplica: dejar
 *  de aplicar un evento real es peor que aplicar uno viejo). */
async function ordenAplicado(subId: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin()
    .from('evento_stripe').select('payload').eq('id', llaveOrden(subId)).maybeSingle();
  if (error) {
    logger.warn('stripe.orden_ilegible', { sub: subId, err: error.message });
    return null;
  }
  const created = (data?.payload as { created?: unknown } | null)?.created;
  return typeof created === 'number' ? created : null;
}

/** Deja la marca del evento recién aplicado. Nunca lanza: perder la marca
 *  degrada la protección de orden, no el cobro. */
async function sellarOrden(subId: string, creadoUnix: number): Promise<void> {
  const { error } = await supabaseAdmin().from('evento_stripe').upsert({
    id: llaveOrden(subId),
    tipo: 'orden_suscripcion',
    payload: { created: creadoUnix, sub: subId },
    // SIEMPRE sellada: esta fila no es un evento pendiente de aplicar.
    aplicado_en: new Date().toISOString(),
  });
  if (error) logger.warn('stripe.orden_no_sellada', { sub: subId, err: error.message });
}

/**
 * Registra una factura de Likida a la flota. Idempotente por el índice único.
 *
 * `subtotal`/`iva` son OPCIONALES y por default quedan en `null`: la factura de
 * Stripe trae el total cobrado, y de dónde salió su IVA lo sabe Stripe, no este
 * código. Una factura sin desglose NO se puede timbrar (`timbrarFactura` se
 * niega), que es lo correcto: el CFDI de esa mensualidad tendría que salir de
 * la misma aritmética con la que se cobró, y aquí no está.
 */
export async function aplicarFactura(datos: {
  tenantId: string;
  stripeInvoiceId: string;
  periodoInicio: string;
  periodoFin: string;
  /** El TOTAL cobrado, con impuestos. */
  monto: number;
  /** Base sin IVA, si se conoce. Va junto con `iva` o no va ninguno. */
  subtotal?: number | null;
  iva?: number | null;
  moneda: string;
  pagada: boolean;
  /** El instante en que STRIPE registró el pago (`status_transitions.paid_at`).
   *  `null`/ausente cae al reloj de este proceso, que es lo que había antes.
   *  DAT-23: sellar con `new Date()` fecha el REINTENTO del webhook, no el
   *  cobro — y un reintento que cruza la medianoche mueve el cobro de mes. */
  pagadaEn?: string | null;
  urlPago?: string | null;
}): Promise<void> {
  // El CHECK `factura_saas_desglose_coherente` (0065) exige que los dos vayan
  // juntos: medio desglose se vería tan completo como uno entero.
  const hayDesglose = datos.subtotal !== null && datos.subtotal !== undefined
    && datos.iva !== null && datos.iva !== undefined;

  const { error } = await supabaseAdmin().from('factura_saas').upsert(
    {
      tenant_id: datos.tenantId,
      periodo_inicio: datos.periodoInicio,
      periodo_fin: datos.periodoFin,
      monto: datos.monto,
      subtotal: hayDesglose ? datos.subtotal : null,
      iva: hayDesglose ? datos.iva : null,
      moneda: datos.moneda,
      estado: datos.pagada ? 'pagada' : 'fallida',
      pagada_en: datos.pagada ? (datos.pagadaEn ?? new Date().toISOString()) : null,
      stripe_invoice_id: datos.stripeInvoiceId,
      url_pago: datos.urlPago ?? null,
    },
    { onConflict: 'stripe_invoice_id' },
  );
  if (error) throw new Error(`aplicarFactura: ${error.message}`);
}

/** La flota dueña de un customer de Stripe, para los eventos que no traen metadata. */
export async function tenantDeCustomer(customerId: string): Promise<string | null> {
  const r = await supabaseAdmin()
    .from('suscripcion')
    .select('tenant_id')
    .eq('stripe_customer_id', customerId)
    .order('creada_en', { ascending: false })
    .limit(1)
    .maybeSingle();
  const s = fila<{ tenant_id: string }>(r, 'tenantDeCustomer');
  return s?.tenant_id ?? null;
}

/** El plan que corresponde a un price de Stripe. */
export async function planDePrice(priceId: string): Promise<string | null> {
  const r = await supabaseAdmin()
    .from('plan')
    .select('clave')
    .eq('stripe_price_id', priceId)
    .maybeSingle();
  const p = fila<{ clave: string }>(r, 'planDePrice');
  return p?.clave ?? null;
}
