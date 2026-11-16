'use server';

import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { anotarAccionAdmin, pasoExtraSuperadmin, AVISO_SIN_BITACORA } from '@/lib/admin/acciones_riesgo';
import { getT } from '@/lib/i18n/servidor';
import { mxn } from '@/lib/formato';
import type { ResultadoAccion } from '@/app/ui-v2/componentes';
import { devengarPeriodo } from '@/lib/backoffice/comisiones';
import { autorizarPago, marcarPagado, registrarCfdiHonorarios } from '@/lib/backoffice/pago-vendedor';
import { importeDeTexto } from '@/lib/backoffice/utiles-c';
import { textoDeError } from '@/lib/backoffice/texto-error-c';

// Acciones de «Comisiones». El sistema CALCULA y REGISTRA; un humano autoriza y paga. Nunca genera una orden de transferencia ni escribe
// al vendedor. Todas piden `requireSuperadmin` y el segundo factor reciente (mueven dinero), y el traductor SE PIDE DENTRO de cada acción.
const RUTAS = ['/admin/back-office/comisiones', '/admin/back-office'] as const;
const texto = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();
const refrescar = () => { for (const r of RUTAS) revalidatePath(r); };

export async function accionDevengarPeriodo(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  const paso = await pasoExtraSuperadmin('dinero_saas', s);
  if (paso) return { error: paso };
  const periodo = texto(fd, 'periodo');
  try {
    const r = await devengarPeriodo(periodo, s.userId);
    refrescar();
    const anotado = await anotarAccionAdmin({
      actor: s, tenantId: null, accion: 'bo_comision.devengado', entidad: 'bo_comision', entidadId: periodo,
      detalle: { devengos: r.devengos, clawbacks: r.clawbacks, ya_existian: r.yaExistian, facturas_leidas: r.facturasLeidas },
    });
    const nota = anotado ? '' : AVISO_SIN_BITACORA;
    if (r.clientesCerrados === 0) return { ok: t('comis.ok_sin_clientes', { nota }) };
    if (r.devengos === 0 && r.clawbacks === 0) return { ok: t('comis.ok_sin_cambios', { ya: r.yaExistian, nota }) };
    return { ok: t('comis.ok_devengado', { devengos: r.devengos, ya: r.yaExistian, clawbacks: r.clawbacks, monto: mxn(r.devengadoCent / 100), nota }) };
  } catch (e) {
    return { error: textoDeError(e, t, 'devengar el periodo') };
  }
}

export async function accionRegistrarCfdi(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  const paso = await pasoExtraSuperadmin('dinero_saas', s);
  if (paso) return { error: paso };
  try {
    const r = await registrarCfdiHonorarios({ vendedorId: texto(fd, 'vendedorId'), periodo: texto(fd, 'periodo'), cfdiUuid: texto(fd, 'cfdiUuid'), recibidoEn: texto(fd, 'recibidoEn') }, s.userId);
    refrescar();
    const anotado = await anotarAccionAdmin({ actor: s, tenantId: null, accion: 'bo_pago_vendedor.cfdi_registrado', entidad: 'bo_pago_vendedor', entidadId: r.pagoId });
    return { ok: t('vend_pago.ok_cfdi', { monto: mxn(r.montoCent / 100), nota: anotado ? '' : AVISO_SIN_BITACORA }) };
  } catch (e) {
    return { error: textoDeError(e, t, t('comis.verbo_registrar_cfdi')) };
  }
}

export async function accionAutorizarPago(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  const paso = await pasoExtraSuperadmin('dinero_saas', s);
  if (paso) return { error: paso };
  const id = texto(fd, 'pagoId');
  try {
    const r = await autorizarPago(id, importeDeTexto(fd.get('monto'), { dinero: true }), s.userId);
    refrescar();
    const anotado = await anotarAccionAdmin({ actor: s, tenantId: null, accion: 'bo_pago_vendedor.autorizado', entidad: 'bo_pago_vendedor', entidadId: id, detalle: { monto_cent: r.montoCent } });
    return { ok: t('vend_pago.ok_autorizado', { monto: mxn(r.montoCent / 100), nota: anotado ? '' : AVISO_SIN_BITACORA }) };
  } catch (e) {
    return { error: textoDeError(e, t, 'autorizar el pago') };
  }
}

export async function accionMarcarPagado(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  const paso = await pasoExtraSuperadmin('dinero_saas', s);
  if (paso) return { error: paso };
  const id = texto(fd, 'pagoId');
  try {
    await marcarPagado(id, { referenciaBanco: texto(fd, 'referenciaBanco') || null, pagadoEn: texto(fd, 'pagadoEn'), tesoreriaMovId: texto(fd, 'movimientoId') || null }, s.userId);
    refrescar();
    const anotado = await anotarAccionAdmin({ actor: s, tenantId: null, accion: 'bo_pago_vendedor.pagado', entidad: 'bo_pago_vendedor', entidadId: id, detalle: { con_referencia_banco: true } });
    return { ok: t('vend_pago.ok_pagado', { nota: anotado ? '' : AVISO_SIN_BITACORA }) };
  } catch (e) {
    return { error: textoDeError(e, t, 'marcar el pago') };
  }
}
