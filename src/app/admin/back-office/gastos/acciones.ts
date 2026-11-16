'use server';

import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { anotarAccionAdmin, pasoExtraSuperadmin, AVISO_SIN_BITACORA } from '@/lib/admin/acciones_riesgo';
import { getT } from '@/lib/i18n/servidor';
import type { ResultadoAccion } from '@/app/ui-v2/componentes';
import { anularGasto, conciliarGasto, crearGasto } from '@/lib/backoffice/gastos';
import { crearProveedor } from '@/lib/backoffice/proveedores';
import { crearCuenta, registrarMovimiento, reversarMovimiento } from '@/lib/backoffice/tesoreria';
import { importeDeTexto } from '@/lib/backoffice/utiles-c';
import { textoDeError } from '@/lib/backoffice/texto-error-c';

// Acciones de «Gastos» (gastos propios de Likida, proveedores y tesorería). Todas: puerta propia (`requireSuperadmin`), el traductor SE
// PIDE DENTRO de cada acción (nunca se cierra sobre el del render), huella en la bitácora y `AVISO_SIN_BITACORA` si no se pudo escribir.
// Lo que mueve dinero (conciliar, movimientos de tesorería) pide además el segundo factor reciente (`pasoExtraSuperadmin`).
const RUTA = '/admin/back-office/gastos';
const texto = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

export async function accionCrearGasto(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  try {
    const r = await crearGasto({
      proveedorId: texto(fd, 'proveedorId') || null,
      fecha: texto(fd, 'fecha'),
      concepto: texto(fd, 'concepto'),
      moneda: texto(fd, 'moneda') || 'MXN',
      montoOriginal: importeDeTexto(fd.get('monto'), { dinero: true }) ?? Number.NaN,
      tipoCambio: importeDeTexto(fd.get('tipoCambio')),
      ivaAcreditable: importeDeTexto(fd.get('iva'), { dinero: true }),
      comprobante: texto(fd, 'comprobante') || 'sin_comprobante',
      cfdiUuid: texto(fd, 'cfdiUuid') || null,
      cuentaContable: texto(fd, 'cuentaContable') || null,
      claveIdem: texto(fd, 'claveIdem') || null,
    }, s.userId);
    revalidatePath(RUTA);
    if (r.repetido) return { ok: t('gastos.ok_repetido') };
    const anotado = await anotarAccionAdmin({
      actor: s, tenantId: null, accion: 'bo_gasto.creado', entidad: 'bo_gasto', entidadId: r.id,
      detalle: { moneda: texto(fd, 'moneda') || 'MXN', comprobante: texto(fd, 'comprobante') || 'sin_comprobante' },
    });
    return { ok: t('gastos.ok_creado', { nota: anotado ? '' : AVISO_SIN_BITACORA }) };
  } catch (e) {
    return { error: textoDeError(e, t, 'registrar el gasto') };
  }
}

export async function accionCrearProveedor(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  try {
    const id = await crearProveedor({
      nombre: texto(fd, 'nombre'), rfc: texto(fd, 'rfc') || null, categoria: texto(fd, 'categoria') || null, cadencia: texto(fd, 'cadencia') || null,
    });
    revalidatePath(RUTA);
    const anotado = await anotarAccionAdmin({ actor: s, tenantId: null, accion: 'bo_proveedor.creado', entidad: 'bo_proveedor', entidadId: id });
    return { ok: t('proveedores.ok_creado', { nombre: texto(fd, 'nombre'), nota: anotado ? '' : AVISO_SIN_BITACORA }) };
  } catch (e) {
    return { error: textoDeError(e, t, t('gastos.verbo_alta_proveedor')) };
  }
}

export async function accionConciliarGasto(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  const paso = await pasoExtraSuperadmin('dinero_saas', s);
  if (paso) return { error: paso };
  const id = texto(fd, 'gastoId');
  try {
    await conciliarGasto(id, { referenciaBanco: texto(fd, 'referenciaBanco') || null, tesoreriaMovId: texto(fd, 'movimientoId') || null }, s.userId);
    revalidatePath(RUTA);
    const anotado = await anotarAccionAdmin({ actor: s, tenantId: null, accion: 'bo_gasto.conciliado', entidad: 'bo_gasto', entidadId: id, detalle: { con_referencia_banco: true } });
    return { ok: t('gastos.ok_conciliado', { nota: anotado ? '' : AVISO_SIN_BITACORA }) };
  } catch (e) {
    return { error: textoDeError(e, t, 'conciliar el gasto') };
  }
}

export async function accionAnularGasto(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  const id = texto(fd, 'gastoId');
  try {
    await anularGasto(id, texto(fd, 'motivo'), s.userId);
    revalidatePath(RUTA);
    const anotado = await anotarAccionAdmin({ actor: s, tenantId: null, accion: 'bo_gasto.anulado', entidad: 'bo_gasto', entidadId: id });
    return { ok: t('gastos.ok_anulado', { nota: anotado ? '' : AVISO_SIN_BITACORA }) };
  } catch (e) {
    return { error: textoDeError(e, t, 'anular el gasto') };
  }
}

export async function accionCrearCuentaTesoreria(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  try {
    const id = await crearCuenta({ nombre: texto(fd, 'nombre'), tipo: texto(fd, 'tipo') });
    revalidatePath(RUTA);
    const anotado = await anotarAccionAdmin({ actor: s, tenantId: null, accion: 'bo_tesoreria.cuenta_creada', entidad: 'bo_tesoreria', entidadId: id });
    return { ok: t('tesor.ok_cuenta', { nota: anotado ? '' : AVISO_SIN_BITACORA }) };
  } catch (e) {
    return { error: textoDeError(e, t, t('gastos.verbo_alta_cuenta')) };
  }
}

export async function accionRegistrarMovimiento(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  const paso = await pasoExtraSuperadmin('dinero_saas', s);
  if (paso) return { error: paso };
  try {
    const r = await registrarMovimiento({
      cuentaId: texto(fd, 'cuentaId'),
      fecha: texto(fd, 'fecha'),
      concepto: texto(fd, 'concepto'),
      monto: importeDeTexto(fd.get('monto'), { dinero: true }) ?? Number.NaN,
      nota: texto(fd, 'nota') || null,
      claveIdem: texto(fd, 'claveIdem') || null,
    }, s.userId);
    revalidatePath(RUTA);
    if (r.repetido) return { ok: t('tesor.ok_repetido') };
    const anotado = await anotarAccionAdmin({ actor: s, tenantId: null, accion: 'bo_tesoreria.movimiento', entidad: 'bo_tesoreria', entidadId: r.id, detalle: { concepto: texto(fd, 'concepto') } });
    return { ok: t('tesor.ok_movimiento', { nota: anotado ? '' : AVISO_SIN_BITACORA }) };
  } catch (e) {
    return { error: textoDeError(e, t, 'registrar el movimiento') };
  }
}

export async function accionReversarMovimiento(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  const paso = await pasoExtraSuperadmin('dinero_saas', s);
  if (paso) return { error: paso };
  try {
    const id = await reversarMovimiento(texto(fd, 'movimientoId'), texto(fd, 'motivo'), s.userId);
    revalidatePath(RUTA);
    const anotado = await anotarAccionAdmin({ actor: s, tenantId: null, accion: 'bo_tesoreria.reversa', entidad: 'bo_tesoreria', entidadId: id });
    return { ok: t('tesor.ok_reversa', { nota: anotado ? '' : AVISO_SIN_BITACORA }) };
  } catch (e) {
    return { error: textoDeError(e, t, 'reversar el movimiento') };
  }
}
