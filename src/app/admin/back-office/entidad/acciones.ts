'use server';

import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { anotarAccionAdmin, pasoExtraSuperadmin, AVISO_SIN_BITACORA } from '@/lib/admin/acciones_riesgo';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { getT } from '@/lib/i18n/servidor';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import type { ResultadoAccion } from '@/app/ui-v2/componentes';
import {
  EntidadNoDisponible, guardarEntidad, leerEntidad, validarEntidad, type CampoEntidad, type Entidad, type ErrorCampoEntidad,
} from '@/lib/backoffice/entidad';

// La entidad legal propia de Likida (bo_entidad). Es la llave que destraba toda la contabilidad fiscal, así que cambiar el RFC pide el
// segundo factor reciente (el mismo paso que cambiar el RFC de una flota) y deja huella en la bitácora. Nada se rellena ni se infiere.

type Tr = TrDe<'admin_backoffice'>;

const MENSAJE_CAMPO: Record<ErrorCampoEntidad, Parameters<Tr>[0]> = {
  razon_social_larga: 'comun.ent_err_razon_larga',
  razon_social_falta: 'comun.ent_err_razon_falta',
  rfc_forma: 'comun.ent_err_rfc_forma',
  rfc_digito: 'comun.ent_err_rfc_digito',
  rfc_generico: 'comun.ent_err_rfc_generico',
  regimen_largo: 'comun.ent_err_regimen',
  cp_invalido: 'comun.ent_err_cp',
  fecha_invalida: 'comun.ent_err_fecha',
  fecha_futura: 'comun.ent_err_fecha_futura',
};

const CAMPOS: readonly CampoEntidad[] = ['razonSocial', 'rfc', 'regimenFiscal', 'domicilioFiscalCp', 'constituidaEl'];

export async function accionGuardarEntidad(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();

  const v = validarEntidad({
    razonSocial: fd.get('razonSocial'), rfc: fd.get('rfc'), regimenFiscal: fd.get('regimenFiscal'),
    domicilioFiscalCp: fd.get('domicilioFiscalCp'), constituidaEl: fd.get('constituidaEl'),
  });
  if (!v.ok) return { error: (Object.values(v.errores) as ErrorCampoEntidad[]).map((codigo) => t(MENSAJE_CAMPO[codigo])).join(' ') };

  // Lo que había: un RFC distinto al guardado exige el segundo factor; una entidad que no se pudo leer NO se sobrescribe a ciegas.
  const previo = await leerEntidad();
  if (previo.estado === 'error') return { error: t('comun.ent_err_leer') };
  if (previo.estado === 'no_disponible') return { error: t('comun.ent_err_tabla') };
  const antes: Entidad | null = previo.dato;
  if (v.valor.rfc !== (antes?.rfc ?? null)) {
    const pasoMfa = await pasoExtraSuperadmin('perfil_fiscal', s);
    if (pasoMfa) return { error: pasoMfa };
  }

  try {
    await guardarEntidad(v.valor, s.userId);
    for (const ruta of ['/admin/back-office', '/admin/back-office/entidad', '/admin/back-office/cierre', '/admin/back-office/contabilidad', '/admin/back-office/gastos', '/admin/back-office/contratos']) revalidatePath(ruta);
    const cambiados = CAMPOS.filter((c) => (antes?.[c] ?? null) !== v.valor[c]);
    const anotado = await anotarAccionAdmin({
      actor: s, tenantId: null, accion: 'bo_entidad.guardada', entidad: 'bo_entidad', entidadId: '1',
      detalle: { campos_cambiados: cambiados, con_rfc: v.valor.rfc !== null },
    });
    return { ok: t('comun.ent_ok', { nota: anotado ? '' : AVISO_SIN_BITACORA }) };
  } catch (e) {
    if (e instanceof EntidadNoDisponible) return { error: t('comun.ent_err_tabla') };
    return { error: mensajeParaPantalla(e, t('comun.ent_op_guardar')) };
  }
}
