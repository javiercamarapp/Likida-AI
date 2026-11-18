'use server';

import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { anotarAccionAdmin, pasoExtraSuperadmin, AVISO_SIN_BITACORA } from '@/lib/admin/acciones_riesgo';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { getT, idiomaActual } from '@/lib/i18n/servidor';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import type { ResultadoAccion } from '@/app/ui-v2/componentes';
import {
  cerrarMes, cobradoDelMesAnterior, ErrorCierre, generarBorrador, guardarTipoCambio, leerVistaCierre, marcarListo, reabrirMes,
} from '@/lib/backoffice/cierre';
import { armarUpdateInversionistas, guardarBorradorUpdate } from '@/lib/backoffice/reporte';
import { esPeriodo } from '@/lib/backoffice/periodo';
import { MENSAJE_ERROR_CIERRE, ROTULO_COMPROBACION } from './rotulos';

// Acciones del cierre mensual. Cada una: `getT` DENTRO (jamás cerrar sobre el traductor del render), puerta `requireSuperadmin()`, la operación
// (con su regla en `lib/backoffice/cierre.ts`), `revalidatePath` y la huella en la bitácora. Lo que mueve cifras cerradas pide además el
// segundo factor reciente (`pasoExtraSuperadmin`). Un error conocido sale con su texto; uno desconocido, con el genérico (se loguea completo).

const RUTAS = ['/admin/back-office/cierre', '/admin/back-office'] as const;

function revalidar(): void {
  for (const r of RUTAS) revalidatePath(r);
}

function mensajeDe(e: unknown, t: TrDe<'admin_backoffice'>, operacion: string): string {
  if (e instanceof ErrorCierre) {
    if (e.codigo === 'bloqueantes') return t('cierre.err_bloqueantes', { lista: e.pendientes.map((p) => t(ROTULO_COMPROBACION[p.clave])).join(', ') });
    return t(MENSAJE_ERROR_CIERRE[e.codigo]);
  }
  return mensajeParaPantalla(e, operacion);
}

const periodoDe = (fd: FormData): string => String(fd.get('periodo') ?? '');

/** Calcula el cierre con lo que hay hoy en la base y lo guarda como borrador (estado «abierto»). Repetirlo no duplica nada. */
export async function accionGenerarBorrador(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  const periodo = periodoDe(fd);
  try {
    const r = await generarBorrador(periodo);
    revalidar();
    const anotado = await anotarAccionAdmin({
      actor: s, tenantId: null, accion: 'bo_cierre.borrador', entidad: 'bo_cierre', entidadId: periodo,
      detalle: { neto_cent: r.cierre.netoCent, cobrado_cent: r.cierre.cobradoTotalCent, faltantes: r.cierre.faltantes, bloqueantes_pendientes: r.comprobaciones.filter((c) => c.bloqueante && c.estado !== 'ok').map((c) => c.clave) },
    });
    return { ok: t('cierre.ok_borrador', { nota: anotado ? '' : AVISO_SIN_BITACORA }) };
  } catch (e) {
    return { error: mensajeDe(e, t, t('cierre.op_borrador')) };
  }
}

/** Recalcula y, solo con las comprobaciones bloqueantes en verde y el mes ya terminado, pasa el borrador a «listo». */
export async function accionMarcarListo(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  const periodo = periodoDe(fd);
  try {
    const r = await marcarListo(periodo);
    revalidar();
    const anotado = await anotarAccionAdmin({
      actor: s, tenantId: null, accion: 'bo_cierre.listo', entidad: 'bo_cierre', entidadId: periodo, detalle: { neto_cent: r.cierre.netoCent },
    });
    return { ok: t('cierre.ok_listo', { nota: anotado ? '' : AVISO_SIN_BITACORA }) };
  } catch (e) {
    return { error: mensajeDe(e, t, t('cierre.op_listo')) };
  }
}

/** listo → cerrado, firmado por quien cierra. Exige el segundo factor reciente: un mes cerrado alimenta al contador y a los inversionistas. */
export async function accionCerrarMes(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  const pasoMfa = await pasoExtraSuperadmin('dinero_saas', s);
  if (pasoMfa) return { error: pasoMfa };
  const periodo = periodoDe(fd);
  try {
    const r = await cerrarMes(periodo, s.userId);
    revalidar();
    const anotado = await anotarAccionAdmin({
      actor: s, tenantId: null, accion: 'bo_cierre.cerrado', entidad: 'bo_cierre', entidadId: periodo,
      detalle: { neto_cent: r.cierre.netoCent, cobrado_cent: r.cierre.cobradoTotalCent, tipo_cambio: r.cierre.tipoCambio },
    });
    return { ok: t('cierre.ok_cerrado', { nota: anotado ? '' : AVISO_SIN_BITACORA }) };
  } catch (e) {
    return { error: mensajeDe(e, t, t('cierre.op_cerrar')) };
  }
}

/** Reabre un mes cerrado. El motivo es obligatorio y queda en la base (fila de reapertura) y en la bitácora. */
export async function accionReabrirMes(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  const pasoMfa = await pasoExtraSuperadmin('dinero_saas', s);
  if (pasoMfa) return { error: pasoMfa };
  const periodo = periodoDe(fd);
  const motivo = String(fd.get('motivo') ?? '').trim();
  try {
    await reabrirMes(periodo, motivo, s.userId);
    revalidar();
    const anotado = await anotarAccionAdmin({
      actor: s, tenantId: null, accion: 'bo_cierre.reabierto', entidad: 'bo_cierre', entidadId: periodo, detalle: { motivo },
    });
    return { ok: t('cierre.ok_reabierto', { nota: anotado ? '' : AVISO_SIN_BITACORA }) };
  } catch (e) {
    return { error: mensajeDe(e, t, t('cierre.op_reabrir')) };
  }
}

/** El tipo de cambio USD→MXN del mes: uno solo, capturado a mano. Cambiarlo devuelve el mes a «abierto» (el neto cambia). */
export async function accionGuardarTipoCambio(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  const periodo = periodoDe(fd);
  const valor = Number(String(fd.get('tipoCambio') ?? '').trim().replace(',', '.'));
  try {
    await guardarTipoCambio(periodo, valor);
    revalidar();
    const anotado = await anotarAccionAdmin({
      actor: s, tenantId: null, accion: 'bo_cierre.tipo_cambio', entidad: 'bo_cierre', entidadId: periodo, detalle: { tipo_cambio: valor },
    });
    return { ok: t('cierre.ok_tipo_cambio', { nota: anotado ? '' : AVISO_SIN_BITACORA }) };
  } catch (e) {
    return { error: mensajeDe(e, t, t('cierre.op_tipo_cambio')) };
  }
}

/** Guarda el borrador del update a inversionistas. Se recalcula aquí con el cierre del servidor (no se confía en el texto del navegador) y
 *  pasa la guardia de números; si no pasa, no se guarda. NUNCA envía nada. */
export async function accionGuardarUpdate(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  const periodo = periodoDe(fd);
  try {
    if (!esPeriodo(periodo)) throw new ErrorCierre('periodo_invalido');
    const idioma = (await idiomaActual()) === 'en' ? 'en' : 'es';
    const [vista, anterior] = await Promise.all([leerVistaCierre(periodo), cobradoDelMesAnterior(periodo)]);
    const r = armarUpdateInversionistas(vista.cierre, t, { idioma, cobradoMesAnteriorCent: anterior });
    if (!r.ok) return { error: t('reporte.err_guardia', { cifras: r.fuera.join(', ') }) };
    await guardarBorradorUpdate(periodo, r.markdown);
    revalidar();
    const anotado = await anotarAccionAdmin({
      actor: s, tenantId: null, accion: 'bo_cierre.update_guardado', entidad: 'bo_cierre', entidadId: periodo, detalle: { caracteres: r.markdown.length },
    });
    return { ok: t('reporte.ok_guardado', { nota: anotado ? '' : AVISO_SIN_BITACORA }) };
  } catch (e) {
    return { error: mensajeDe(e, t, t('reporte.op_guardar')) };
  }
}
