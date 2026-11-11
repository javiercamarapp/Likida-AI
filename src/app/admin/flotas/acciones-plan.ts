'use server';

import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { pasoExtraSuperadmin, AVISO_SIN_BITACORA } from '@/lib/admin/acciones_riesgo';
import { gestionarSuscripcionDeFlota, OPERACIONES_PLAN, type OperacionPlan, type ResultadoGestionPlan } from '@/lib/saas/asignar-plan';
import type { ResultadoAccion } from '../ui/forma';

// Asignar / cambiar / activar / pausar / cancelar el plan de una flota desde /admin. La puerta (sesión, rol y MFA de entrada) corre
// ANTES de leer el formulario; luego la confirmación extra (step-up reutilizado, apagado hasta encender LIKIDA_TOTP_ESCALONADO);
// la lógica, el anclaje a la flota y la bitácora viven en `lib/saas/asignar-plan.ts`. NO llama a Stripe.

const FRASE: Record<OperacionPlan, (r: ResultadoGestionPlan) => string> = {
  asignar: (r) => (r.estadoAntes === null
    ? `Plan ${r.planClave} asignado en estado «prueba»: ya se le puede emitir la mensualidad. Actívalo cuando la flota quede cobrándose (cuenta para el MRR solo como «activa»).`
    : `Plan cambiado a ${r.planClave} (la suscripción sigue «${r.estadoDespues}»).`),
  activar: () => 'Suscripción activa: la flota cuenta ya para el MRR.',
  pausar: () => 'Suscripción pausada.',
  cancelar: () => 'Suscripción cancelada. La flota vuelve al plan de demostración; no se borra nada de su historial de cobro.',
};

export async function accionGestionarPlan(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const s = await requireSuperadmin();
  const tenantId = String(fd.get('tenantId') ?? '');
  const operacion = String(fd.get('operacion') ?? '') as OperacionPlan;
  if (!OPERACIONES_PLAN.includes(operacion)) return { error: 'Elige qué hacer con el plan.' };

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
    if (!r.cambio) return { ok: 'Sin cambios: la suscripción ya estaba así.' };
    return { ok: FRASE[operacion](r) + (r.bitacora ? '' : AVISO_SIN_BITACORA) };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'mover el plan de la flota') };
  }
}
