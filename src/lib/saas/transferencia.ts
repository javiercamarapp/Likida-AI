import { supabaseAdmin } from '@/lib/supabase/admin';
import { DatoInvalido } from '@/lib/likida/errores';
import { logger } from '@/lib/logger';
import { facturapiConfigurado, timbrarMensualidad, enviarPorCorreo } from './facturapi';
import { getDatosFiscales, estanCompletos } from './fiscal';
import { desglosarPrecio, desgloseCuadra } from './iva';

// ═══════════════════════════════════════════════════════════════════════════
// COBRAR POR TRANSFERENCIA A LA CUENTA DE LIKIDA.
//
// Sin pasarela: la flota transfiere a una cuenta bancaria de verdad. Es como
// cobran las siete empresas que se midieron el 4-ago-2026 —Handle, Nowports,
// Yalo, leadsales y las tres de rastreo de flotas—, ninguna con checkout.
//
// LA VERDAD INCÓMODA DE ESTE CAMINO: **un banco no manda webhooks.** BBVA no le
// avisa a la app que entró dinero. No hay nada que "detecte" el pago. Alguien
// mira el estado de cuenta y lo marca, y por eso `conciliar()` exige QUIÉN lo
// marcó y CON QUÉ movimiento del banco. Una factura "pagada" sin eso es la
// palabra de alguien sin nada detrás, y esta tabla decide si un cliente sigue
// con servicio.
//
// LOS DATOS BANCARIOS VIVEN EN EL ENTORNO, NO EN EL CÓDIGO. El repo es PÚBLICO:
// una CLABE ahí queda en el historial de git para siempre, ligando el nombre y
// la cuenta del dueño a un artefacto público. Van en variables de Vercel.
// ═══════════════════════════════════════════════════════════════════════════

export interface DatosBancarios {
  beneficiario: string;
  banco: string;
  clabe: string;
  /** Los últimos 4, para poder enseñar algo sin exponer la cuenta completa. */
  clabeUltimos4: string;
}

/**
 * A dónde transfiere el cliente. `null` si no está configurado.
 *
 * FALLA CERRADO: sin CLABE la pantalla dice qué falta en vez de enseñar unas
 * instrucciones de pago incompletas. Un cliente que transfiere a una cuenta
 * equivocada —o que no transfiere porque el dato estaba a medias— cuesta más
 * que no ofrecer el pago.
 */
export function datosBancarios(): DatosBancarios | null {
  const clabe = (process.env.LIKIDA_CLABE ?? '').replace(/\s/g, '');
  const beneficiario = process.env.LIKIDA_BENEFICIARIO ?? '';
  const banco = process.env.LIKIDA_BANCO ?? '';
  if (!clabe || !beneficiario || !banco) return null;
  if (!clabeValida(clabe)) return null;
  return { beneficiario, banco, clabe, clabeUltimos4: clabe.slice(-4) };
}

/**
 * Valida una CLABE con su dígito verificador.
 *
 * Son 18 dígitos: 3 de banco, 3 de plaza, 11 de cuenta y 1 verificador que se
 * calcula con los pesos 3-7-1. Un dígito mal tecleado da una CLABE que *parece*
 * correcta y que el banco rechaza — o peor, que pertenece a otra persona. Este
 * chequeo es de los baratos que evitan mandar dinero al vacío.
 */
export function clabeValida(clabe: string): boolean {
  const c = clabe.replace(/\D/g, '');
  if (c.length !== 18) return false;
  const pesos = [3, 7, 1];
  let suma = 0;
  for (let i = 0; i < 17; i++) suma += (Number(c[i]) * pesos[i % 3]) % 10;
  return (10 - (suma % 10)) % 10 === Number(c[17]);
}

/**
 * La referencia que el cliente escribe en el concepto de su transferencia.
 *
 * DETERMINISTA a propósito (flota + periodo): reemitir el mismo mes devuelve la
 * MISMA referencia, así que apretar "emitir" dos veces no genera dos códigos
 * para un solo cobro. Corta y sin caracteres raros porque va en el campo de
 * concepto de una app bancaria, que los recorta y a veces los rechaza.
 */
export function referenciaDe(tenantId: string, periodoInicio: string): string {
  const corto = tenantId.replace(/-/g, '').slice(0, 4).toUpperCase();
  const [anio, mes] = periodoInicio.split('-');
  return `LK${corto}${anio}${mes}`;
}

export interface FacturaPorCobrar {
  id: string;
  tenantId: string;
  tenantNombre: string;
  periodoInicio: string;
  periodoFin: string;
  /** EL TOTAL A TRANSFERIR, con IVA. Es la cifra que ve el cliente. */
  monto: number;
  /** Base sin IVA. `null` = sin desglose: no se puede timbrar. */
  subtotal: number | null;
  iva: number | null;
  moneda: string;
  estado: string;
  referencia: string | null;
  cfdiUuid: string | null;
}

/**
 * Emite la mensualidad de una flota.
 *
 * NO INVENTA EL MONTO: sale del precio del plan de su suscripción. Si el plan no
 * tiene precio configurado, no se emite nada — cobrar una cifra inventada es el
 * peor error posible de este módulo.
 *
 * Y TAMPOCO INVENTA DE QUÉ LADO ESTÁ EL IVA, que es el mismo error un escalón
 * más abajo. Antes escribía `monto = precio_mensual`, la pantalla le pedía al
 * cliente ESA cifra, y el timbrado tomaba la misma como "subtotal sin IVA" y le
 * sumaba el 16%: el cliente transfería $10,000 y el CFDI salía por $11,600. Ver
 * `lib/saas/iva.ts`. Si el plan no declara el criterio, aquí NO se emite: es la
 * puerta barata: no emitir cuesta un mensaje en /admin; timbrar mal cuesta
 * cancelar un CFDI que ya existe ante el SAT.
 *
 * `monto` queda SIEMPRE como el total con IVA —lo que el cliente transfiere— y
 * el desglose se congela en `subtotal`/`iva`. Congelarlo importa: entre emitir
 * y timbrar pueden pasar semanas y alguien puede cambiar el price del plan;
 * recalcular al timbrar aplicaría el criterio nuevo a un cobro viejo.
 *
 * El índice único `(tenant_id, periodo_inicio, periodo_fin)` de la 0057 impide
 * cobrar el mismo mes dos veces; aquí se traduce ese choque a un mensaje que se
 * entiende, en vez de dejar salir el error de Postgres.
 */
export async function emitirMensualidad(
  tenantId: string,
  periodoInicio: string,
  periodoFin: string,
): Promise<{ id: string; referencia: string; monto: number; subtotal: number; iva: number }> {
  const admin = supabaseAdmin();

  const { data: sus, error: errSus } = await admin
    .from('suscripcion')
    .select('id, plan_clave, plan(precio_mensual, moneda, nombre, precio_iva_incluido)')
    .eq('tenant_id', tenantId)
    .in('estado', ['prueba', 'activa', 'morosa', 'pausada'])
    .maybeSingle();
  if (errSus) throw new Error(`emitirMensualidad.suscripcion: ${errSus.message}`);
  if (!sus) throw new DatoInvalido('Esa flota no tiene una suscripción activa. Primero asígnale un plan.');

  type FilaPlan = {
    precio_mensual?: number | string | null;
    moneda?: string;
    nombre?: string;
    precio_iva_incluido?: boolean | null;
  };
  const rel = sus.plan as FilaPlan | FilaPlan[] | null;
  const plan = Array.isArray(rel) ? rel[0] : rel;
  const precio = plan?.precio_mensual;
  const nombrePlan = plan?.nombre ?? sus.plan_clave;

  if (precio === null || precio === undefined) {
    throw new DatoInvalido(
      `El plan "${nombrePlan}" no tiene precio configurado, así que no hay monto que cobrar. Ponle precio antes de emitir.`,
    );
  }

  // La moneda se guardaba y no la miraba nadie. `mxn()` imprime TODO como pesos,
  // así que una mensualidad en dólares se ve idéntica a una en pesos y el
  // cliente descubre la diferencia cuando ya transfirió.
  const moneda = plan?.moneda ?? 'MXN';
  if (moneda !== 'MXN') {
    throw new DatoInvalido(
      `El plan "${nombrePlan}" está en ${moneda} y todo el cobro por transferencia está en pesos: la pantalla lo ` +
      'imprimiría con signo de peso y la flota transferiría la cifra equivocada. Configura el plan en MXN.',
    );
  }

  // LANZA `DatoInvalido` si el plan no declara el criterio del IVA: sin él no se
  // sabe si el cliente debe transferir el precio o el precio × 1.16.
  let d;
  try {
    d = desglosarPrecio(Number(precio), plan?.precio_iva_incluido ?? null);
  } catch (e) {
    if (e instanceof DatoInvalido) throw new DatoInvalido(`Plan "${nombrePlan}": ${e.message}`);
    throw e;
  }

  const referencia = referenciaDe(tenantId, periodoInicio);
  const { data, error } = await admin
    .from('factura_saas')
    .insert({
      tenant_id: tenantId,
      suscripcion_id: sus.id,
      periodo_inicio: periodoInicio,
      periodo_fin: periodoFin,
      monto: d.total,
      subtotal: d.subtotal,
      iva: d.iva,
      moneda,
      estado: 'pendiente',
      metodo_cobro: 'transferencia',
      referencia,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new DatoInvalido(`Esa flota ya tiene una factura de ese periodo (referencia ${referencia}). No se cobra dos veces el mismo mes.`);
    }
    throw new Error(`emitirMensualidad: ${error.message}`);
  }

  return { id: data!.id as string, referencia, monto: d.total, subtotal: d.subtotal, iva: d.iva };
}

/**
 * Da una factura por pagada — el paso que ningún webhook puede hacer aquí.
 *
 * EXIGE LA REFERENCIA DEL BANCO. Sin ella "pagada" es una afirmación sin
 * evidencia, y el día que un cliente reclame que sí pagó no hay con qué
 * contrastar. Es el mismo criterio que la bitácora de la 0053: las operaciones
 * que mueven dinero dejan rastro de quién y con qué.
 */
export async function conciliar(
  facturaId: string,
  referenciaBanco: string,
  actorId: string,
): Promise<void> {
  const ref = referenciaBanco.trim();
  if (ref.length < 3) {
    throw new DatoInvalido('Pon la referencia del movimiento del banco: es la prueba de que el dinero existe.');
  }

  const admin = supabaseAdmin();
  const { data: f, error: errLee } = await admin
    .from('factura_saas')
    .select('estado')
    .eq('id', facturaId)
    .maybeSingle();
  if (errLee) throw new Error(`conciliar.leer: ${errLee.message}`);
  if (!f) throw new DatoInvalido('Esa factura ya no existe.');
  if (f.estado === 'pagada') throw new DatoInvalido('Esa factura ya estaba marcada como pagada.');

  const ahora = new Date().toISOString();
  const { error } = await admin
    .from('factura_saas')
    .update({
      estado: 'pagada',
      pagada_en: ahora,
      conciliada_por: actorId,
      conciliada_en: ahora,
      referencia_banco: ref,
    })
    .eq('id', facturaId);
  if (error) throw new Error(`conciliar: ${error.message}`);
}

/**
 * Timbra el CFDI de una factura YA PAGADA.
 *
 * SEPARADO DE `conciliar()` A PROPÓSITO, aunque se llamen juntos. Marcar el pago
 * es un hecho del banco y no puede fallar porque el PAC esté caído; timbrar crea
 * un documento fiscal REAL ante el SAT. Si fueran la misma operación, un error
 * del PAC obligaría a decidir entre perder la conciliación o dejar el cobro sin
 * registrar — y las dos son malas.
 *
 * NO REINTENTA A CIEGAS y por eso comprueba `cfdi_uuid` primero: cada timbrado
 * exitoso consume un folio y crea un CFDI de verdad. Timbrar dos veces la misma
 * mensualidad obliga a cancelar uno, y una cancelación fuera de plazo se le
 * queda al cliente en su contabilidad. El índice único de la 0056 es la última
 * red, pero la primera es esta comprobación.
 *
 * SE NIEGA A TIMBRAR SIN DESGLOSE. `factura_saas.monto` es el TOTAL con IVA, y
 * lo que Facturapi espera como precio del concepto es la BASE (timbra con
 * `tax_included: false`, o sea que le suma el 16% a lo que reciba). Mandarle el
 * total produce un CFDI 16% más alto que el depósito. Una factura sin
 * `subtotal`/`iva` guardados —las anteriores a la 0065 y las que registra el
 * webhook de Stripe— no dice cuál de las dos cifras era, así que aquí se para:
 * un CFDI mal emitido es irreversible y no timbrar no lo es.
 */
export async function timbrarFactura(facturaId: string): Promise<{ uuid: string } | { pendiente: string }> {
  if (!facturapiConfigurado()) {
    return { pendiente: 'El timbrado no está conectado todavía (falta FACTURAPI_SECRET_KEY). El cobro es válido; el CFDI se emite cuando se configure.' };
  }

  const admin = supabaseAdmin();
  const { data: f, error } = await admin
    .from('factura_saas')
    .select('id, tenant_id, estado, monto, subtotal, iva, moneda, periodo_inicio, periodo_fin, referencia, cfdi_uuid')
    .eq('id', facturaId)
    .maybeSingle();
  if (error) throw new Error(`timbrarFactura.leer: ${error.message}`);
  if (!f) throw new DatoInvalido('Esa factura ya no existe.');
  if (f.cfdi_uuid) throw new DatoInvalido(`Esa factura ya está timbrada (UUID ${String(f.cfdi_uuid).slice(0, 8)}…). Timbrarla otra vez crearía un segundo CFDI que habría que cancelar.`);
  if (f.estado !== 'pagada') throw new DatoInvalido('Solo se timbra lo que ya está pagado.');

  const total = Number(f.monto);
  const subtotal = f.subtotal === null || f.subtotal === undefined ? null : Number(f.subtotal);
  const iva = f.iva === null || f.iva === undefined ? null : Number(f.iva);

  if (subtotal === null || iva === null) {
    throw new DatoInvalido(
      'Esta factura no trae el desglose de IVA guardado, así que no se sabe si el monto cobrado ya lo incluía. ' +
      'Timbrar a ciegas emite un CFDI que puede salir 16% arriba o abajo del depósito, y eso solo se corrige ' +
      'cancelándolo ante el SAT. Emítela de nuevo desde /admin con el plan ya declarando su criterio de IVA, o ' +
      'timbra esta a mano en Facturapi.',
    );
  }
  // La base ya lo garantiza con un CHECK; se vuelve a comprobar aquí porque una
  // corrección a mano en Supabase no pasa por este código y el timbrado no se
  // puede deshacer.
  if (!desgloseCuadra(total, subtotal, iva)) {
    throw new DatoInvalido(
      `El desglose de esta factura no cuadra: subtotal ${subtotal} + IVA ${iva} no da el total ${total} que se cobró. ` +
      'No se timbra un CFDI por una cifra que no es la que entró al banco.',
    );
  }

  const fiscales = await getDatosFiscales(f.tenant_id as string);
  if (!estanCompletos(fiscales)) {
    throw new DatoInvalido('Esa flota no tiene sus datos fiscales completos: sin RFC, razón social, régimen, código postal y uso de CFDI el SAT rechaza el timbrado.');
  }

  const cfdi = await timbrarMensualidad({
    receptor: {
      rfc: fiscales!.rfc!, razonSocial: fiscales!.razonSocial!,
      regimenFiscal: fiscales!.regimenFiscal!, codigoPostal: fiscales!.codigoPostal!,
      usoCfdi: fiscales!.usoCfdi!,
    },
    // LA BASE, no el total: Facturapi timbra con `tax_included: false`.
    subtotal,
    // Para que, si el PAC devuelve otro total, quede en el log con nombre y
    // apellido en vez de descubrirse cuando el contador del cliente concilie.
    totalEsperado: total,
    periodoInicio: f.periodo_inicio as string,
    periodoFin: f.periodo_fin as string,
    referencia: (f.referencia as string) ?? undefined,
  });

  // El CFDI YA EXISTE ante el SAT en este punto. Si guardarlo falla, se loguea
  // fuerte y se devuelve igual: perder el UUID en nuestra base es un problema
  // de registro; volver a timbrar sería un problema fiscal del cliente.
  const { error: errGuardar } = await admin
    .from('factura_saas')
    .update({ cfdi_uuid: cfdi.uuid, cfdi_xml_url: cfdi.urlXml, timbrada_en: new Date().toISOString() })
    .eq('id', facturaId);
  if (errGuardar) {
    logger.error('facturapi.uuid_sin_guardar', { facturaId, uuid: cfdi.uuid, err: errGuardar.message });
  }

  await enviarPorCorreo(cfdi.id);
  return { uuid: cfdi.uuid };
}

/** Lo que está por cobrarse, para la pantalla de Javier. */
export async function getPorCobrar(): Promise<FacturaPorCobrar[]> {
  const { data, error } = await supabaseAdmin()
    .from('factura_saas')
    .select('id, tenant_id, periodo_inicio, periodo_fin, monto, subtotal, iva, moneda, estado, referencia, cfdi_uuid, tenant(nombre)')
    .in('estado', ['pendiente', 'fallida'])
    .order('periodo_fin', { ascending: false })
    .limit(50);

  if (error) throw new Error(`getPorCobrar: ${error.message}`);
  return (data ?? []).map((f) => {
    const t = f.tenant as { nombre?: string } | Array<{ nombre?: string }> | null;
    const nombre = Array.isArray(t) ? t[0]?.nombre : t?.nombre;
    return {
      id: f.id as string,
      tenantId: f.tenant_id as string,
      tenantNombre: nombre ?? '—',
      periodoInicio: f.periodo_inicio as string,
      periodoFin: f.periodo_fin as string,
      monto: Number(f.monto),
      subtotal: f.subtotal === null || f.subtotal === undefined ? null : Number(f.subtotal),
      iva: f.iva === null || f.iva === undefined ? null : Number(f.iva),
      moneda: (f.moneda as string) ?? 'MXN',
      estado: f.estado as string,
      referencia: (f.referencia as string) || null,
      cfdiUuid: (f.cfdi_uuid as string) || null,
    };
  });
}
