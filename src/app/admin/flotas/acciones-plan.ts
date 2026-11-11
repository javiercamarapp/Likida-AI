'use server';

import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { pasoExtraSuperadmin, AVISO_SIN_BITACORA } from '@/lib/admin/acciones_riesgo';
import { gestionarSuscripcionDeFlota, OPERACIONES_PLAN, type OperacionPlan, type ResultadoGestionPlan } from '@/lib/saas/asignar-plan';
import type { ResultadoAccion } from '../ui/forma';

import type { TrDe } from '@/lib/i18n/tr_tipos';
import { getT } from '@/lib/i18n/servidor';
// Asignar / cambiar / activar / pausar / cancelar el plan de una flota desde /admin. La puerta (sesión, rol y MFA de entrada) corre
// ANTES de leer el formulario; luego la confirmación extra (step-up reutilizado, apagado hasta encender LIKIDA_TOTP_ESCALONADO);
// la lógica, el anclaje a la flota y la bitácora viven en `lib/saas/asignar-plan.ts`. NO llama a Stripe.

const frase = (t: TrDe<'admin_flotas'>): Record<OperacionPlan, (r: ResultadoGestionPlan) => string> => ({
  asignar: (r) => (r.estadoAntes === null
    ? t('flotas_acciones_plan.plan_asignado_en_estado', { planClave: r.planClave })
    : t('flotas_acciones_plan.plan_cambiado_a_la', { planClave: r.planClave, estadoDespues: r.estadoDespues })),
  activar: () => t('flotas_acciones_plan.suscripcion_activa_la_flota'),
  pausar: () => t('flotas_acciones_plan.suscripcion_pausada'),
  cancelar: () => t('flotas_acciones_plan.suscripcion_cancelada_la_flota'),
});

export async function accionGestionarPlan(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_flotas');
  const s = await requireSuperadmin();
  const tenantId = String(fd.get('tenantId') ?? '');
  const operacion = String(fd.get('operacion') ?? '') as OperacionPlan;
  if (!OPERACIONES_PLAN.includes(operacion)) return { error: t('flotas_acciones_plan.elige_que_hacer_con') };

  const pasoMfa = await pasoExtraSuperadmin('dinero_saas', s, tenantId || null);
  if (pasoMfa) return { error: pasoMfa };

  try {
    const r = await gestionarSuscripcionDeFlota({
      tenantId, operacion, planClave: String(fd.get('planClave') ?? ''), actor: s,
    });
    revalidatePath('/admin/flotas');
    revalidatePath(`/admin/flotas/${tenantId}`);
    revalidatePath('/admin/costos-facturacion');
    revalidatePath('/dashboard/suscripcion');
    if (!r.cambio) return { ok: t('flotas_acciones_plan.sin_cambios_la_suscripcion') };
    return { ok: frase(t)[operacion](r) + (r.bitacora ? '' : AVISO_SIN_BITACORA) };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'mover el plan de la flota') };
  }
}
