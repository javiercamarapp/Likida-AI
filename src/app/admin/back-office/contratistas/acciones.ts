'use server';

import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { anotarAccionAdmin, AVISO_SIN_BITACORA } from '@/lib/admin/acciones_riesgo';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { getT } from '@/lib/i18n/servidor';
import { crearContratista, desactivarContratista } from '@/lib/backoffice/contratistas';
import type { ResultadoAccion } from '@/app/ui-v2/componentes';

const RUTA = '/admin/back-office/contratistas';
const texto = (fd: FormData, k: string): string => String(fd.get(k) ?? '');

/** Alta de un contratista (registro ligero, sin importes). Bitácora `bo_contratista.creado` sin RFC ni datos personales. */
export async function accionCrearContratista(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  const entrada = {
    nombre: texto(fd, 'nombre'), rol: texto(fd, 'rol'), esquema: texto(fd, 'esquema'), rfc: texto(fd, 'rfc'), cfdiVigente: texto(fd, 'cfdiVigente'),
    constanciaEn: texto(fd, 'constanciaEn'), contratoId: texto(fd, 'contratoId'), nota: texto(fd, 'nota'),
  };
  try {
    const r = await crearContratista(entrada, s.userId);
    if (!r.ok) return { error: t(`contratistas.err_${r.error}` as const) };
    revalidatePath(RUTA);
    const anotado = await anotarAccionAdmin({
      actor: s, tenantId: null, accion: 'bo_contratista.creado', entidad: 'bo_contratista', entidadId: r.id, detalle: { esquema: entrada.esquema },
    });
    return { ok: t('contratistas.ok_creado', { nombre: entrada.nombre.trim(), nota: anotado ? '' : AVISO_SIN_BITACORA }) };
  } catch (e) {
    return { error: mensajeParaPantalla(e, t('contratistas.verbo_guardar')) };
  }
}

/** Desactiva un contratista (no se borra). Bitácora `bo_contratista.desactivado`. */
export async function accionDesactivarContratista(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  const id = texto(fd, 'id');
  if (id === '') return { error: t('contratistas.err_no_encontrado') };
  try {
    const r = await desactivarContratista(id);
    if (!r.ok) return { error: t(`contratistas.err_${r.error}` as const) };
    revalidatePath(RUTA);
    const anotado = await anotarAccionAdmin({ actor: s, tenantId: null, accion: 'bo_contratista.desactivado', entidad: 'bo_contratista', entidadId: r.id });
    return { ok: t('contratistas.ok_desactivado', { nota: anotado ? '' : AVISO_SIN_BITACORA }) };
  } catch (e) {
    return { error: mensajeParaPantalla(e, t('contratistas.verbo_desactivar')) };
  }
}
