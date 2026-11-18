'use server';

import { revalidatePath } from 'next/cache';
import { getSessionTenant } from '@/lib/auth/session';
import { veredictoMfaDeSesion } from '@/lib/auth/superadmin-mfa';
import { MSG_MFA_SUPERADMIN } from '@/lib/auth/mfa';
import { pausarCampana, refrescarGastoMeta } from '@/lib/admin/campanas';
import { mensajeDeFalla } from '../mensaje-falla';
import { getT } from '@/lib/i18n/servidor';
import type { AccionCampana } from './campanas';

async function ejecutarComoSuperadmin(
  hacer: (userId: string) => Promise<AccionCampana>,
  errorAcceso: string,
): Promise<AccionCampana> {
  const sesion = await getSessionTenant();
  if (sesion?.rol !== 'superadmin') return { ok: false, error: errorAcceso };

  const veredicto = await veredictoMfaDeSesion(sesion);
  if (veredicto !== 'ok') return { ok: false, error: MSG_MFA_SUPERADMIN[veredicto] };

  return hacer(sesion.userId);
}

export async function accionPausarCampana(id: string): Promise<AccionCampana> {
  const { t } = await getT('admin_flotas');
  return ejecutarComoSuperadmin(async (userId) => {
    try {
      const r = await pausarCampana(String(id), userId);
      revalidatePath('/admin/crecimiento');
      return { ok: true, mensaje: r.mensaje };
    } catch (e) {
      return { ok: false, error: await mensajeDeFalla(e, 'verbo.crec_pausar_campana') };
    }
  }, t('cf6.acc_solo_pausa'));
}

export async function accionRefrescarGasto(): Promise<AccionCampana> {
  const { t, tp } = await getT('admin_flotas');
  return ejecutarComoSuperadmin(async () => {
    try {
      const r = await refrescarGastoMeta();
      revalidatePath('/admin/crecimiento');
      if (!r.configurada) {
        return { ok: false, error: t('cf6.acc_meta_sin_config') };
      }
      const fallo = r.fallidas.length > 0
        ? t('cf6.acc_fallaron', { lista: r.fallidas.map((f) => `${f.nombre} (${f.motivo})`).join(', ') })
        : '';
      // A37-S22-03: las que no alcanzaron en el presupuesto de tiempo se DICEN.
      const faltan = r.pendientes > 0
        ? t('cf6.acc_pendientes', { n: r.pendientes })
        : '';
      return {
        ok: true,
        mensaje: `${tp('cf6.acc_gasto_medido', r.medidas)}${fallo}${faltan}.`,
      };
    } catch (e) {
      return { ok: false, error: await mensajeDeFalla(e, 'verbo.crec_medir_gasto') };
    }
  }, t('cf6.acc_solo_mide'));
}
