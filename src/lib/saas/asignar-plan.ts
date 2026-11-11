import { supabaseAdmin } from '@/lib/supabase/admin';
import { datoInvalido } from '@/lib/likida/errores';
import { esUuidValido } from '@/lib/likida/intake/cfdi';
import { anotarAccionAdmin, type ActorAdmin } from '@/lib/admin/acciones_riesgo';

// ═══════════════════════════════════════════════════════════════════════════
// ASIGNAR / CAMBIAR / ACTIVAR / PAUSAR / CANCELAR EL PLAN DE UNA FLOTA, DESDE /admin.
//
// El hueco (FUNC-DINERO, P0): solo la flota podía suscribirse (Stripe, desde
// /dashboard/suscripcion). `emitirMensualidad` exige una suscripción viva y
// ninguna pantalla de Likida podía crearla: con las 4 flotas de hoy
// (`tenant.plan = 'demo'`, 0 filas en `suscripcion`) el botón «Emitir la
// mensualidad» fallaba para todas.
//
// ── QUÉ HACE ─────────────────────────────────────────────────────────────
// Escribe la fila de `suscripcion` SIN id de Stripe, que es justo la que
// `emitirMensualidad` sabe cobrar por transferencia. NO llama a Stripe, ni real
// ni de prueba. El estado inicial es `prueba` a propósito (el mismo criterio de
// `registrarSuscripcionProvisional`): todavía nadie pagó, y `getMrr` solo cuenta
// `activa`, así que el MRR no se infla al asignar. `activar` es el acto
// explícito que dice «esta flota ya está cobrándose».
//
// ── LO QUE FALLA CERRADO Y SE DICE ───────────────────────────────────────
//  · Un plan sin price LIGADO (sin `stripe_price_id`), sin precio mayor a cero,
//    fuera de MXN o sin el criterio de IVA no se asigna: no habría mensualidad
//    que emitir, y una suscripción que no se puede cobrar se ve contratada.
//  · Una suscripción CON id de Stripe no se toca desde aquí: moverle el estado
//    en la base sin moverlo en Stripe la dejaría diciendo una cosa mientras
//    Stripe cobra otra, y el siguiente webhook pisaría el cambio. Se gestiona en
//    Stripe (o la flota, desde su panel).
//  · Un cambio que otro hizo mientras tanto (el estado ya no es el que se leyó)
//    no se pisa: el UPDATE lleva el estado leído en su WHERE y, si no toca fila,
//    se pide recargar.
//
// IDEMPOTENTE: repetir el mismo acto (mismo plan, mismo estado destino) no
// escribe, no asienta bitácora y devuelve `cambio: false`; los reintentos
// de una pantalla lenta no duplican nada. El índice `suscripcion_una_viva` (0052)
// es la última red contra dos altas simultáneas: su choque (23505) se resuelve
// releyendo, no con un error de Postgres.
// ═══════════════════════════════════════════════════════════════════════════

export type OperacionPlan = 'asignar' | 'activar' | 'pausar' | 'cancelar';
export const OPERACIONES_PLAN: readonly OperacionPlan[] = ['asignar', 'activar', 'pausar', 'cancelar'];

const VIVAS = ['prueba', 'activa', 'morosa', 'pausada'] as const;
/** El plan al que cae `tenant.plan` cuando la flota queda sin suscripción: el mismo que escribe el webhook al cancelar (DAT-40). */
const PLAN_SIN_SUSCRIPCION = 'demo';

export interface ResultadoGestionPlan {
  operacion: OperacionPlan;
  /** `false` = ya estaba así: no se escribió ni se asentó nada. */
  cambio: boolean;
  suscripcionId: string;
  planClave: string;
  estadoAntes: string | null;
  estadoDespues: string;
  /** `false` = el acto se hizo pero la bitácora no pudo escribir (quien llama lo dice en pantalla). */
  bitacora: boolean;
}

interface SuscripcionViva {
  id: string;
  planClave: string;
  estado: string;
  stripeSubscriptionId: string | null;
}

async function leerSuscripcionViva(tenantId: string): Promise<SuscripcionViva | null> {
  const { data, error } = await supabaseAdmin()
    .from('suscripcion')
    .select('id, plan_clave, estado, stripe_subscription_id')
    .eq('tenant_id', tenantId)
    .in('estado', [...VIVAS])
    .maybeSingle();
  if (error) throw new Error(`gestionarSuscripcion.leer: ${error.message}`);
  if (!data) return null;
  return {
    id: String(data.id),
    planClave: String(data.plan_clave),
    estado: String(data.estado),
    stripeSubscriptionId: (data.stripe_subscription_id as string | null) ?? null,
  };
}

/** El plan debe poder cobrarse por `emitirMensualidad`: price ligado, precio > 0, en pesos y con el criterio de IVA declarado. */
async function leerPlanCobrable(planClave: string): Promise<{ clave: string; nombre: string }> {
  if (!planClave.trim()) throw datoInvalido('asignar_plan.elige_un_plan');
  const { data, error } = await supabaseAdmin()
    .from('plan')
    .select('clave, nombre, precio_mensual, moneda, precio_iva_incluido, stripe_price_id, activo')
    .eq('clave', planClave)
    .maybeSingle();
  if (error) throw new Error(`gestionarSuscripcion.plan: ${error.message}`);
  if (!data || data.activo === false) throw datoInvalido('asignar_plan.ese_plan_no_existe_o');
  const nombre = String(data.nombre ?? data.clave);
  if (!data.stripe_price_id) {
    throw datoInvalido('asignar_plan.el_plan_no_tiene_un', { nombre });
  }
  const precio = data.precio_mensual === null || data.precio_mensual === undefined ? null : Number(data.precio_mensual);
  if (precio === null || !(precio > 0)) {
    throw datoInvalido('asignar_plan.el_plan_no_tiene_precio', { nombre });
  }
  if ((data.moneda ?? 'MXN') !== 'MXN') {
    throw datoInvalido('asignar_plan.el_plan_esta_en_y', { nombre, v: String(data.moneda) });
  }
  if (data.precio_iva_incluido === null || data.precio_iva_incluido === undefined) {
    throw datoInvalido('asignar_plan.el_plan_no_declara_si', { nombre });
  }
  return { clave: String(data.clave), nombre };
}

async function sincronizarPlanDelTenant(tenantId: string, planClave: string): Promise<void> {
  const { error } = await supabaseAdmin().from('tenant').update({ plan: planClave }).eq('id', tenantId);
  if (error) throw new Error(`gestionarSuscripcion.tenant_plan: ${error.message}`);
}

function exigirGestionLocal(sus: SuscripcionViva): void {
  if (sus.stripeSubscriptionId) {
    throw datoInvalido('asignar_plan.esa_flota_cobra_por_stripe', { v: sus.stripeSubscriptionId.slice(0, 14) });
  }
}

/** Mueve el estado de una suscripción local con compare-and-set sobre el estado leído. `false` = otro la cambió mientras tanto. */
async function moverEstado(
  sus: SuscripcionViva, tenantId: string, destino: 'activa' | 'pausada' | 'cancelada',
): Promise<boolean> {
  const cambios: Record<string, unknown> = { estado: destino };
  if (destino === 'cancelada') cambios.cancelada_en = new Date().toISOString();
  const { data, error } = await supabaseAdmin()
    .from('suscripcion')
    .update(cambios)
    .eq('id', sus.id)
    .eq('tenant_id', tenantId)
    .eq('estado', sus.estado)
    .is('stripe_subscription_id', null)
    .select('id');
  if (error) throw new Error(`gestionarSuscripcion.estado: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}


/**
 * Gestiona la suscripción de UNA flota. `tenantId` viene del objetivo elegido por el superadmin; todo UPDATE va anclado a él.
 * La puerta (`requireSuperadmin`) y la confirmación extra viven en la acción de servidor que llama; la bitácora, aquí.
 */
export async function gestionarSuscripcionDeFlota(p: {
  tenantId: string;
  operacion: OperacionPlan;
  planClave?: string;
  actor: ActorAdmin;
}): Promise<ResultadoGestionPlan> {
  const { tenantId, operacion, actor } = p;
  if (!esUuidValido(tenantId)) throw datoInvalido('asignar_plan.elige_una_flota');
  if (!OPERACIONES_PLAN.includes(operacion)) throw datoInvalido('asignar_plan.esa_operacion_no_existe');

  const { data: t, error: errT } = await supabaseAdmin().from('tenant').select('id, plan').eq('id', tenantId).maybeSingle();
  if (errT) throw new Error(`gestionarSuscripcion.tenant: ${errT.message}`);
  if (!t) throw datoInvalido('asignar_plan.esa_flota_ya_no_existe');

  const sus = await leerSuscripcionViva(tenantId);

  const asentar = async (accion: string, id: string, detalle: Record<string, unknown>): Promise<boolean> => anotarAccionAdmin({
    actor, tenantId, accion, entidad: 'suscripcion', entidadId: id, detalle,
  });

  if (operacion === 'asignar') {
    const plan = await leerPlanCobrable(String(p.planClave ?? ''));
    if (sus) {
      exigirGestionLocal(sus);
      if (sus.planClave === plan.clave) {
        // Idempotente: ya tiene ese plan. Se repara tenant.plan por si un intento anterior murió entre los dos escritos.
        await sincronizarPlanDelTenant(tenantId, plan.clave);
        return { operacion, cambio: false, suscripcionId: sus.id, planClave: plan.clave, estadoAntes: sus.estado, estadoDespues: sus.estado, bitacora: true };
      }
      const { data, error } = await supabaseAdmin()
        .from('suscripcion')
        .update({ plan_clave: plan.clave })
        .eq('id', sus.id)
        .eq('tenant_id', tenantId)
        .eq('plan_clave', sus.planClave)
        .eq('estado', sus.estado)
        .is('stripe_subscription_id', null)
        .select('id');
      if (error) throw new Error(`gestionarSuscripcion.cambiar: ${error.message}`);
      if (!Array.isArray(data) || data.length === 0) throw datoInvalido('asignar_plan.conflicto');
      await sincronizarPlanDelTenant(tenantId, plan.clave);
      const bitacora = await asentar('suscripcion.plan_cambiado', sus.id, { de: sus.planClave, a: plan.clave, estado: sus.estado });
      return { operacion, cambio: true, suscripcionId: sus.id, planClave: plan.clave, estadoAntes: sus.estado, estadoDespues: sus.estado, bitacora };
    }

    const { data: nueva, error: errIns } = await supabaseAdmin()
      .from('suscripcion')
      .insert({ tenant_id: tenantId, plan_clave: plan.clave, estado: 'prueba' })
      .select('id')
      .maybeSingle();
    if (errIns) {
      // 23505 = `suscripcion_una_viva`: otra petición (u otra pestaña) la creó entre la lectura y el insert. Se resuelve releyendo.
      if ((errIns as { code?: string }).code === '23505') {
        const ganadora = await leerSuscripcionViva(tenantId);
        if (ganadora && ganadora.planClave === plan.clave && !ganadora.stripeSubscriptionId) {
          await sincronizarPlanDelTenant(tenantId, plan.clave);
          return { operacion, cambio: false, suscripcionId: ganadora.id, planClave: plan.clave, estadoAntes: ganadora.estado, estadoDespues: ganadora.estado, bitacora: true };
        }
        throw datoInvalido('asignar_plan.conflicto');
      }
      throw new Error(`gestionarSuscripcion.crear: ${errIns.message}`);
    }
    if (!nueva) throw new Error('gestionarSuscripcion.crear: la base no devolvió la suscripción creada');
    const id = String(nueva.id);
    await sincronizarPlanDelTenant(tenantId, plan.clave);
    const bitacora = await asentar('suscripcion.asignada', id, { plan: plan.clave, estado: 'prueba', plan_anterior_tenant: (t.plan as string | null) ?? null });
    return { operacion, cambio: true, suscripcionId: id, planClave: plan.clave, estadoAntes: null, estadoDespues: 'prueba', bitacora };
  }

  // activar / pausar / cancelar actúan sobre la suscripción viva que ya existe.
  if (!sus) throw datoInvalido('asignar_plan.esa_flota_no_tiene_una');
  exigirGestionLocal(sus);

  const destino = operacion === 'activar' ? 'activa' : operacion === 'pausar' ? 'pausada' : 'cancelada';
  if (sus.estado === destino) {
    return { operacion, cambio: false, suscripcionId: sus.id, planClave: sus.planClave, estadoAntes: sus.estado, estadoDespues: sus.estado, bitacora: true };
  }
  if (!(await moverEstado(sus, tenantId, destino))) throw datoInvalido('asignar_plan.conflicto');
  if (operacion === 'cancelar') await sincronizarPlanDelTenant(tenantId, PLAN_SIN_SUSCRIPCION);
  const accion = operacion === 'activar' ? 'suscripcion.activada' : operacion === 'pausar' ? 'suscripcion.pausada' : 'suscripcion.cancelada';
  const bitacora = await asentar(accion, sus.id, { plan: sus.planClave, de: sus.estado, a: destino });
  return { operacion, cambio: true, suscripcionId: sus.id, planClave: sus.planClave, estadoAntes: sus.estado, estadoDespues: destino, bitacora };
}
