'use server';

import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { rolAsignableExigeStepUp } from '@/lib/auth/stepup';
import { altaDeUsuarioDesdeAdmin, fraseDeAlta, ROLES_ALTA_ADMIN } from '@/lib/auth/gestion_admin';
import { pasoExtraSuperadmin } from '@/lib/admin/acciones_riesgo';
import { appUrl } from '@/lib/env';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import type { ResultadoAccion } from '../../../ui-v2/componentes';
import { getT } from '@/lib/i18n/servidor';

// ADM-7 (auditoría 24): EL RESULTADO SE VE. El éxito ya no redirige a una URL que nadie lee ni los errores se pierden: es un server
// action para `useActionState` (`FormaConAviso`), los inputs conservan lo escrito y el mensaje de captura sale VERBATIM. Aquí el «ese
// correo ya tiene cuenta» SÍ se dice con todas sus letras: esta puerta es de Likida, no de un cliente (SEG-7).
// Extraída de page.tsx (una acción es un endpoint propio: re-gatea con `requireSuperadmin`).

const ROLES_VALIDOS = new Set<string>(ROLES_ALTA_ADMIN);

export async function accionNuevoAcceso(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
  const sesion = await requireSuperadmin();
  const { t } = await getT('resto');
  const tenantId = String(formData.get('tenantId') ?? '');
  const email = String(formData.get('email') ?? '').trim();
  const nombre = String(formData.get('nombre') ?? '').trim() || undefined;
  const rol = String(formData.get('rol') ?? '');
  if (!tenantId || !email || !rol) return { error: t('ctl.nu_faltan') };
  // ADM-12 (auditoría 24): LISTA BLANCA de tres roles, no negar `superadmin`: con una lista negra `rol=vendedor` entraba con `tenant_id`
  // y un vendedor es personal de LIKIDA, que por contrato va con tenant nulo (`provisionar.ts`).
  if (!ROLES_VALIDOS.has(rol)) {
    return { error: t('ctl.nu_rol_invalido') };
  }
  const telefono = String(formData.get('telefono') ?? '').trim() || undefined;
  // Repartir acceso de dueño o contador es repartir acceso a dinero: mismo segundo factor reciente que el panel del dueño (apagado hasta
  // encender LIKIDA_TOTP_ESCALONADO). Va ANTES de crear nada.
  if (rolAsignableExigeStepUp(rol)) {
    const pasoMfa = await pasoExtraSuperadmin('cambio_rol', sesion, tenantId);
    if (pasoMfa) return { error: pasoMfa };
  }
  try {
    // Alta + asiento `usuario.provisionado` + correo de acceso por Resend (lib/auth/gestion_admin.ts).
    const r = await altaDeUsuarioDesdeAdmin({ tenantId, email, nombre, rol, telefono, actor: sesion });
    revalidatePath('/admin/equipo');
    revalidatePath(`/admin/flotas/${tenantId}`);
    const f = fraseDeAlta(email, r, appUrl());
    return f.ok ? { ok: f.texto } : { error: f.texto };
  } catch (e) {
    return { error: mensajeParaPantalla(e, t('ctl.nu_verbo_alta')) };
  }
}
