'use server';

import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { appUrl } from '@/lib/env';
import { nombreDeRolTr } from '@/lib/i18n/rotulos_tr';
import { mensajeDeBaja } from '@/lib/auth/mensaje_baja';
import { pasoExtraSuperadmin } from '@/lib/admin/acciones_riesgo';
import {
  cambiarRolDesdeAdmin, darDeBajaDesdeAdmin, reactivarDesdeAdmin, reenviarAccesoDesdeAdmin, cerrarSesionesDesdeAdmin,
} from '@/lib/auth/gestion_admin';
import { darDeBajaPersonalLikida, reactivarPersonalLikida } from '@/lib/auth/baja_acceso';
import type { ResultadoAccion } from '../ui/forma';
import { getT } from '@/lib/i18n/servidor';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';

// Gestión de personas de las flotas desde /admin: cambiar rol, dar de baja, reactivar, reenviar el acceso y cerrar sesiones. Misma lógica
// que /dashboard/usuarios?tenant=… (`usuarios_escritura.ts`), con la flota leída de la base por el id de la persona. Cada acción re-gatea
// con `requireSuperadmin` (una server action es un endpoint), y las que dan o devuelven privilegios piden el mismo segundo factor reciente que
// el panel del dueño (`cambio_rol`; apagado hasta que se encienda LIKIDA_TOTP_ESCALONADO). La bitácora `usuario.*` la asienta usuarios_escritura.
// Las páginas que las usan (Equipo, ficha de la flota) las importan; aquí no hay pantalla.

const id = (fd: FormData) => String(fd.get('id') ?? '');

function refrescar() {
  revalidatePath('/admin/equipo');
  revalidatePath('/admin/flotas');
}

export async function accionCambiarRolUsuario(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t, idioma } = await getT('admin_sistema');
  const s = await requireSuperadmin();
  const pasoMfa = await pasoExtraSuperadmin('cambio_rol', s);
  if (pasoMfa) return { error: pasoMfa };
  try {
    const r = await cambiarRolDesdeAdmin(id(fd), String(fd.get('rol') ?? ''), s);
    refrescar();
    const llaves = r.llavesApiSinRevocar
      ? t('usuarios_acciones.atencion_no_se_pudieron_revocar_sus')
      : (r.llavesApiRevocadas?.length ? t('usuarios_acciones.se_revocaron_sus_llaves_de_api', { r: r.llavesApiRevocadas.join(', ') }) : '');
    return { ok: t('usuarios_acciones.rol_cambiado_de_a_aplica_en', { nombreDeRol: nombreDeRolTr(r.de, t), nombreDeRol2: nombreDeRolTr(r.a, t), llaves }) };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'cambiar el rol', idioma) };
  }
}

export async function accionDarDeBajaUsuario(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { idioma } = await getT('admin_sistema');
  const s = await requireSuperadmin();
  try {
    const r = await darDeBajaDesdeAdmin(id(fd), s);
    refrescar();
    return { ok: mensajeDeBaja(r).mensaje };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'dar de baja la cuenta', idioma) };
  }
}

export async function accionReactivarUsuario(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t, idioma } = await getT('admin_sistema');
  const s = await requireSuperadmin();
  // Reactivar devuelve el acceso con el rol que la cuenta tenía (puede ser dueño o contador): mismo paso que cambiar el rol.
  const pasoMfa = await pasoExtraSuperadmin('cambio_rol', s);
  if (pasoMfa) return { error: pasoMfa };
  try {
    const r = await reactivarDesdeAdmin(id(fd), s);
    refrescar();
    return r.accesoRestaurado
      ? { ok: t('usuarios_acciones.cuenta_reactivada_ya_puede_volver_a') }
      : { error: t('usuarios_acciones.cuenta_reactivada_en_el_panel_pero') };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'reactivar la cuenta', idioma) };
  }
}

export async function accionReenviarAccesoUsuario(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t, idioma } = await getT('admin_sistema');
  const s = await requireSuperadmin();
  try {
    const r = await reenviarAccesoDesdeAdmin(id(fd), s);
    if (r.enviado) return { ok: t('usuarios_acciones.le_mandamos_el_correo_de_acceso', { email: r.email }) };
    return {
      error: r.motivo === 'sin_configurar'
        ? t('usuarios_acciones.no_salio_correo_el_canal_de', { appUrl: appUrl() })
        : t('usuarios_acciones.el_correo_de_acceso_no_salio', { appUrl: appUrl() }),
    };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'reenviar el acceso', idioma) };
  }
}

export async function accionCerrarSesionesUsuario(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t, idioma } = await getT('admin_sistema');
  const s = await requireSuperadmin();
  try {
    const r = await cerrarSesionesDesdeAdmin(id(fd), s);
    return r.sesionesCerradas
      ? { ok: t('usuarios_acciones.listo_todas_sus_sesiones_quedaron_cerradas') }
      : { error: t('usuarios_acciones.no_se_pudo_confirmar_el_cierre') };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'cerrar sus sesiones', idioma) };
  }
}

// ── 4b: PERSONAL DE LIKIDA (superadmin y vendedor). Marcado para revisión del dueño: la lógica y sus candados viven en
// `lib/auth/baja_acceso.ts` (nunca a uno mismo, nunca el último superadmin) y nace apagada (LIKIDA_BAJA_PERSONAL_LIKIDA).
const sinAsiento = (t: TSistema = T_SISTEMA_ES) => (t('usuarios_acciones.ojo_el_acto_ya_se_hizo'));

export async function accionDarDeBajaPersonalLikida(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t, idioma } = await getT('admin_sistema');
  const s = await requireSuperadmin();
  const pasoMfa = await pasoExtraSuperadmin('cambio_rol', s);
  if (pasoMfa) return { error: pasoMfa };
  try {
    const r = await darDeBajaPersonalLikida(id(fd), s);
    refrescar();
    const sesion = r.sesionRevocada
      ? t('usuarios_acciones.sus_sesiones_quedaron_cerradas')
      : t('usuarios_acciones.la_cuenta_quedo_de_baja_pero');
    return { ok: t('usuarios_acciones.baja_hecha', { rol: nombreDeRolTr(r.rol, t), sesion, asiento: r.bitacora ? '' : sinAsiento(t) }) };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'dar de baja al personal de Likida', idioma) };
  }
}

export async function accionReactivarPersonalLikida(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t, idioma } = await getT('admin_sistema');
  const s = await requireSuperadmin();
  const pasoMfa = await pasoExtraSuperadmin('cambio_rol', s);
  if (pasoMfa) return { error: pasoMfa };
  try {
    const r = await reactivarPersonalLikida(id(fd), s);
    refrescar();
    return r.accesoRestaurado
      ? { ok: t('usuarios_acciones.cuenta_reactivada_rol', { rol: nombreDeRolTr(r.rol, t), asiento: r.bitacora ? '' : sinAsiento(t) }) }
      : { error: t('usuarios_acciones.cuenta_reactivada_en_el_panel_pero_2') };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'reactivar al personal de Likida', idioma) };
  }
}
