import { supabaseAdmin } from '@/lib/supabase/admin';
import { DatoInvalido } from '@/lib/cuadra/errores';

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
  monto: number;
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
 * El índice único `(tenant_id, periodo_inicio, periodo_fin)` de la 0057 impide
 * cobrar el mismo mes dos veces; aquí se traduce ese choque a un mensaje que se
 * entiende, en vez de dejar salir el error de Postgres.
 */
export async function emitirMensualidad(
  tenantId: string,
  periodoInicio: string,
  periodoFin: string,
): Promise<{ id: string; referencia: string; monto: number }> {
  const admin = supabaseAdmin();

  const { data: sus, error: errSus } = await admin
    .from('suscripcion')
    .select('id, plan_clave, plan(precio_mensual, moneda, nombre)')
    .eq('tenant_id', tenantId)
    .in('estado', ['prueba', 'activa', 'morosa', 'pausada'])
    .maybeSingle();
  if (errSus) throw new Error(`emitirMensualidad.suscripcion: ${errSus.message}`);
  if (!sus) throw new DatoInvalido('Esa flota no tiene una suscripción activa. Primero asígnale un plan.');

  const rel = sus.plan as { precio_mensual?: number | string | null; moneda?: string; nombre?: string }
    | Array<{ precio_mensual?: number | string | null; moneda?: string; nombre?: string }> | null;
  const plan = Array.isArray(rel) ? rel[0] : rel;
  const precio = plan?.precio_mensual;

  if (precio === null || precio === undefined) {
    throw new DatoInvalido(
      `El plan "${plan?.nombre ?? sus.plan_clave}" no tiene precio configurado, así que no hay monto que cobrar. Ponle precio antes de emitir.`,
    );
  }

  const referencia = referenciaDe(tenantId, periodoInicio);
  const { data, error } = await admin
    .from('factura_saas')
    .insert({
      tenant_id: tenantId,
      suscripcion_id: sus.id,
      periodo_inicio: periodoInicio,
      periodo_fin: periodoFin,
      monto: Number(precio),
      moneda: plan?.moneda ?? 'MXN',
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

  return { id: data!.id as string, referencia, monto: Number(precio) };
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

/** Lo que está por cobrarse, para la pantalla de Javier. */
export async function getPorCobrar(): Promise<FacturaPorCobrar[]> {
  const { data, error } = await supabaseAdmin()
    .from('factura_saas')
    .select('id, tenant_id, periodo_inicio, periodo_fin, monto, moneda, estado, referencia, cfdi_uuid, tenant(nombre)')
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
      moneda: (f.moneda as string) ?? 'MXN',
      estado: f.estado as string,
      referencia: (f.referencia as string) || null,
      cfdiUuid: (f.cfdi_uuid as string) || null,
    };
  });
}
