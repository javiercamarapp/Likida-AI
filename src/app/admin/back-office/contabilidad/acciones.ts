'use server';

import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { anotarAccionAdmin, pasoExtraSuperadmin, AVISO_SIN_BITACORA } from '@/lib/admin/acciones_riesgo';
import { hoyMx, mxn } from '@/lib/formato';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { getT } from '@/lib/i18n/servidor';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import type { ResultadoAccion } from '@/app/ui-v2/componentes';
import {
  ErrorLibro, leerCuentas, leerEntidad, leerObligaciones, leerPaqueteDelMes, marcarPaqueteListo, marcarPresentada, registrarAsiento, reversarAsiento,
} from '@/lib/backoffice/contabilidad';
import { candadoDeEntidad, esFechaIso } from '@/lib/backoffice/fiscal';
import { aPesos, lineasDeFormulario, validarAsiento, type ErrorAsiento, type SoporteAsiento } from '@/lib/backoffice/libro';
import type { MotivoNoListo } from '@/lib/backoffice/paquete-contable';

// Acciones de la pantalla /admin/back-office/contabilidad. Cada una: `getT` DENTRO (nunca se cierra sobre el traductor del render),
// `requireSuperadmin()`, paso extra si mueve el libro, operación, `revalidatePath` y huella en la bitácora (`bo_obligacion.*`, `bo_asiento.*`).
// El sistema NUNCA presenta ante el SAT: «presentada» la marca una persona con el acuse en la mano.

const RUTA = '/admin/back-office/contabilidad';
type T = TrDe<'admin_backoffice'>;

const CLAVE = /^[a-z0-9_]{3,60}$/;
const PERIODO = /^\d{4}-(0[1-9]|1[0-2])-01$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOPORTES: readonly SoporteAsiento[] = ['ninguno', 'cfdi', 'invoice_extranjero'];

const texto = (fd: FormData, campo: string): string => String(fd.get(campo) ?? '').trim();

/** El texto que ve la persona cuando la base rechaza o falla; los códigos de Postgres del libro se dicen en su idioma. */
function textoDeError(e: unknown, t: T, verbo: string): string {
  if (e instanceof ErrorLibro) {
    if (e.codigo === 'ausente') return t('bo.no_disponible');
    if (e.codigo === 'P0431') return t('contab.err_periodo_cerrado');
    if (e.codigo === 'P0430') return t('contab.err_no_cuadra');
    if (e.codigo === '42501') return t('contab.err_definitivo');
    if (e.codigo === '22023') return t('contab.err_rechazo_base', { detalle: e.detalle });
  }
  return mensajeParaPantalla(e, verbo);
}

function textoDeErrorAsiento(err: ErrorAsiento, t: T): string {
  switch (err.tipo) {
    case 'pocas_lineas': return t('contab.err_as_pocas');
    case 'cuenta_invalida': return t('contab.err_as_cuenta_invalida', { cuenta: err.cuenta });
    case 'cuenta_inexistente': return t('contab.err_as_cuenta_inexistente', { cuenta: err.cuenta });
    case 'cuenta_inactiva': return t('contab.err_as_cuenta_inactiva', { cuenta: err.cuenta });
    case 'monto_invalido': return t('contab.err_as_monto', { cuenta: err.cuenta });
    case 'debe_y_haber': return t('contab.err_as_ambos', { cuenta: err.cuenta });
    case 'descuadre': return t('contab.err_as_descuadre', { debe: mxn(aPesos(err.debeCent)), haber: mxn(aPesos(err.haberCent)) });
  }
}

const textoNoListo = (m: MotivoNoListo, t: T): string => (m === 'comprobacion_bloqueante' ? t('contab.nolisto_comprobacion') : t('contab.nolisto_vacio'));

/** «Presentada»: la marca una persona con el acuse. Sin RFC propio no hay nada que presentar. */
export async function accionMarcarPresentada(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  try {
    const [clave, periodo] = texto(fd, 'obligacion').split('|');
    if (!clave || !periodo || !CLAVE.test(clave) || !PERIODO.test(periodo)) return { error: t('contab.err_obligacion') };
    const acuse = texto(fd, 'acuseRef');
    if (acuse.length < 3 || acuse.length > 120) return { error: t('contab.err_acuse') };
    const presentadaEn = texto(fd, 'presentadaEn') || hoyMx();
    if (!esFechaIso(presentadaEn) || presentadaEn > hoyMx()) return { error: t('contab.err_fecha') };

    if (candadoDeEntidad(await leerEntidad()).bloqueado) return { error: t('fiscal.err_candado_presentar') };
    const catalogo = await leerObligaciones();
    if (catalogo.estado !== 'ok') return { error: t('bo.no_disponible') };
    const ob = catalogo.dato.find((o) => o.clave === clave);
    if (!ob || ob.periodicidad === 'evento') return { error: t('contab.err_obligacion') };

    const resultado = await marcarPresentada({ clave, periodo, presentadaPor: s.nombre ?? s.userId, presentadaEn, acuseRef: acuse, nota: texto(fd, 'nota') || null });
    revalidatePath(RUTA);
    const anotado = await anotarAccionAdmin({
      actor: s, tenantId: null, accion: 'bo_obligacion.presentada', entidad: 'bo_obligacion', entidadId: `${clave}:${periodo}`,
      detalle: { clave, periodo, presentada_en: presentadaEn, acuse_ref: acuse, repetida: resultado === 'ya_estaba' },
    });
    return { ok: (resultado === 'ya_estaba' ? t('contab.ok_presentada_ya', { nombre: ob.nombre }) : t('contab.ok_presentada', { nombre: ob.nombre, periodo: periodo.slice(0, 7) })) + (anotado ? '' : AVISO_SIN_BITACORA) };
  } catch (e) {
    return { error: textoDeError(e, t, t('contab.verbo_presentar')) };
  }
}

/** «Paquete listo» del mes: solo con entidad (RFC), sin comprobaciones bloqueantes en rojo y con movimientos. No presenta nada. */
export async function accionGenerarPaquete(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  try {
    const periodo = texto(fd, 'periodo');
    if (!PERIODO.test(periodo)) return { error: t('contab.err_periodo') };
    const datos = await leerPaqueteDelMes(periodo);
    if (datos.candado.bloqueado) return { error: t('fiscal.err_candado_paquete') };
    if (!datos.paquete || datos.paquete.bloqueado !== false) return { error: t('bo.no_disponible') };
    if (!datos.paquete.listo) {
      return { error: t('contab.err_paquete_no_listo', { motivos: datos.paquete.motivosNoListo.map((m) => textoNoListo(m, t)).join(', ') }) };
    }
    const claves = await marcarPaqueteListo(periodo);
    revalidatePath(RUTA);
    const anotado = await anotarAccionAdmin({
      actor: s, tenantId: null, accion: 'bo_obligacion.paquete_listo', entidad: 'bo_obligacion', entidadId: periodo,
      detalle: { periodo, claves, advertencias: datos.paquete.advertencias, movimientos: datos.paquete.movimientos.length, sin_cfdi: datos.paquete.movimientosSinCfdi },
    });
    return { ok: t('contab.ok_paquete', { n: claves.length, avisos: datos.paquete.advertencias.length }) + (anotado ? '' : AVISO_SIN_BITACORA) };
  } catch (e) {
    return { error: textoDeError(e, t, t('contab.verbo_paquete')) };
  }
}

/** Asiento manual: con motivo, partida doble validada aquí Y en la base, e idempotente por la clave que trae el formulario. */
export async function accionRegistrarAsientoManual(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  // Mueve el libro de dinero: pide el segundo factor reciente (apagado mientras no se encienda la palanca).
  const paso = await pasoExtraSuperadmin('dinero_saas', s);
  if (paso) return { error: paso };
  try {
    const claveIdem = texto(fd, 'claveIdem');
    if (claveIdem.length < 8 || claveIdem.length > 200) return { error: t('contab.err_clave_idem') };
    const fecha = texto(fd, 'fecha');
    if (!esFechaIso(fecha) || fecha > hoyMx()) return { error: t('contab.err_fecha') };
    const descripcion = texto(fd, 'descripcion');
    if (descripcion.length < 3 || descripcion.length > 200) return { error: t('contab.err_descripcion') };
    const motivo = texto(fd, 'motivo');
    if (motivo.length < 5 || motivo.length > 200) return { error: t('contab.err_motivo') };
    const soporte = texto(fd, 'soporte') as SoporteAsiento;
    if (!SOPORTES.includes(soporte)) return { error: t('contab.err_soporte') };
    const soporteRef = texto(fd, 'soporteRef');
    if (soporte === 'cfdi' && !soporteRef) return { error: t('contab.err_soporte_ref') };
    if (soporteRef.length > 80) return { error: t('contab.err_soporte_ref') };

    const { lineas, errores } = lineasDeFormulario((campo) => String(fd.get(campo) ?? ''));
    const mal = errores[0];
    if (mal) return { error: mal.tipo === 'monto_ilegible' ? t('contab.err_monto', { n: mal.n }) : t('contab.err_decimales', { n: mal.n }) };
    const cuentas = await leerCuentas();
    if (cuentas.estado !== 'ok') return { error: t('bo.no_disponible') };
    const invalidos = validarAsiento(lineas, cuentas.dato);
    if (invalidos.length > 0) return { error: textoDeErrorAsiento(invalidos[0], t) };

    const { id } = await registrarAsiento({
      claveIdem, fecha, descripcion: `${descripcion} · ${motivo}`, lineas, actor: s.userId, soporte, soporteRef: soporteRef || null,
    });
    revalidatePath(RUTA);
    const totalCent = lineas.reduce((x, l) => x + l.debeCent, 0);
    const anotado = await anotarAccionAdmin({
      actor: s, tenantId: null, accion: 'bo_asiento.registrado', entidad: 'bo_asiento', entidadId: id,
      detalle: { fecha, lineas: lineas.length, total_cent: totalCent, soporte, motivo },
    });
    return { ok: t('contab.ok_asiento', { n: lineas.length, total: mxn(aPesos(totalCent)) }) + (anotado ? '' : AVISO_SIN_BITACORA) };
  } catch (e) {
    return { error: textoDeError(e, t, t('contab.verbo_asiento')) };
  }
}

/** Reversa enlazada de un asiento manual: con motivo, una sola vez, idempotente por la clave del formulario. */
export async function accionReversarAsiento(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_backoffice');
  const s = await requireSuperadmin();
  const paso = await pasoExtraSuperadmin('dinero_saas', s);
  if (paso) return { error: paso };
  try {
    const asientoId = texto(fd, 'asientoId');
    if (!UUID.test(asientoId)) return { error: t('contab.err_asiento_id') };
    const motivo = texto(fd, 'motivo');
    if (motivo.length < 5 || motivo.length > 200) return { error: t('contab.err_motivo') };
    const claveIdem = texto(fd, 'claveIdem');
    if (claveIdem.length < 8 || claveIdem.length > 200) return { error: t('contab.err_clave_idem') };

    const { id } = await reversarAsiento({ asientoId, motivo, actor: s.userId, claveIdem, fecha: hoyMx() });
    revalidatePath(RUTA);
    const anotado = await anotarAccionAdmin({
      actor: s, tenantId: null, accion: 'bo_asiento.reversado', entidad: 'bo_asiento', entidadId: id,
      detalle: { original: asientoId, motivo },
    });
    return { ok: t('contab.ok_reversa') + (anotado ? '' : AVISO_SIN_BITACORA) };
  } catch (e) {
    return { error: textoDeError(e, t, t('contab.verbo_reversa')) };
  }
}
