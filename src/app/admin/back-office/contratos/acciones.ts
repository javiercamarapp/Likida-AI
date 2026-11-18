'use server';

import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { anotarAccionAdmin, AVISO_SIN_BITACORA } from '@/lib/admin/acciones_riesgo';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { getT } from '@/lib/i18n/servidor';
import { actualizarContrato, crearContrato, terminarContrato, type EntradaContrato } from '@/lib/backoffice/contratos';
import type { ResultadoAccion } from '@/app/ui-v2/componentes';

const RUTA = '/admin/back-office/contratos';
const texto = (fd: FormData, k: string): string => String(fd.get(k) ?? '');

function entradaDe(fd: FormData): EntradaContrato {
  return {
    tipo: texto(fd, 'tipo'), contraparte: texto(fd, 'contraparte'), descripcion: texto(fd, 'descripcion'), firmadoEl: texto(fd, 'firmadoEl'),
    venceEl: texto(fd, 'venceEl'), renovacionAuto: fd.get('renovacionAuto') === 'on', diasAviso: texto(fd, 'diasAviso'), responsable: texto(fd, 'responsable'),
    costoMensual: texto(fd, 'costoMensual'), documentoUrl: texto(fd, 'documentoUrl'), estado: texto(fd, 'estado'),
  };
}

/** Alta o edición de un contrato (la edición lleva `id` oculto). Con bitácora `bo_contrato.creado` / `bo_contrato.actualizado`. */
export async function accionGuardarContrato(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  const id = texto(fd, 'id');
  const entrada = entradaDe(fd);
  try {
    const r = id ? await actualizarContrato(id, entrada) : await crearContrato(entrada, s.userId);
    if (!r.ok) return { error: t(`contratos.err_${r.error}` as const) };
    revalidatePath(RUTA);
    const anotado = await anotarAccionAdmin({
      actor: s, tenantId: null, accion: id ? 'bo_contrato.actualizado' : 'bo_contrato.creado', entidad: 'bo_contrato', entidadId: r.id,
      detalle: { tipo: entrada.tipo, estado: entrada.estado || 'borrador', vence_el: entrada.venceEl || null, con_responsable: texto(fd, 'responsable').trim() !== '' },
    });
    return { ok: t(id ? 'contratos.ok_actualizado' : 'contratos.ok_creado', { nombre: entrada.contraparte.trim(), nota: anotado ? '' : AVISO_SIN_BITACORA }) };
  } catch (e) {
    return { error: mensajeParaPantalla(e, t('contratos.verbo_guardar')) };
  }
}

/** Termina un contrato con motivo obligatorio; la fila queda congelada. Bitácora `bo_contrato.terminado`. */
export async function accionTerminarContrato(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  const id = texto(fd, 'id');
  const motivo = texto(fd, 'motivo');
  if (id === '') return { error: t('contratos.err_no_encontrado') };
  try {
    const r = await terminarContrato(id, motivo);
    if (!r.ok) return { error: t(`contratos.err_${r.error}` as const) };
    revalidatePath(RUTA);
    const anotado = await anotarAccionAdmin({
      actor: s, tenantId: null, accion: 'bo_contrato.terminado', entidad: 'bo_contrato', entidadId: r.id, detalle: { motivo: motivo.trim().slice(0, 500) },
    });
    return { ok: t('contratos.ok_terminado', { nota: anotado ? '' : AVISO_SIN_BITACORA }) };
  } catch (e) {
    return { error: mensajeParaPantalla(e, t('contratos.verbo_terminar')) };
  }
}
