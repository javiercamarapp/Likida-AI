'use server';

import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { appUrl } from '@/lib/env';
import { nombreDeRol } from '@/lib/auth/roles';
import { mensajeDeBaja } from '@/lib/auth/mensaje_baja';
import { pasoExtraSuperadmin } from '@/lib/admin/acciones_riesgo';
import {
  cambiarRolDesdeAdmin, darDeBajaDesdeAdmin, reactivarDesdeAdmin, reenviarAccesoDesdeAdmin, cerrarSesionesDesdeAdmin,
} from '@/lib/auth/gestion_admin';
import { darDeBajaPersonalLikida, reactivarPersonalLikida } from '@/lib/auth/baja_acceso';
import type { ResultadoAccion } from '../ui/forma';

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
  const s = await requireSuperadmin();
  const pasoMfa = await pasoExtraSuperadmin('cambio_rol', s);
  if (pasoMfa) return { error: pasoMfa };
  try {
    const r = await cambiarRolDesdeAdmin(id(fd), String(fd.get('rol') ?? ''), s);
    refrescar();
    const llaves = r.llavesApiSinRevocar
      ? ' ATENCIÓN: NO se pudieron revocar sus llaves de API de Administración y siguen vivas: revócalas a mano.'
      : (r.llavesApiRevocadas?.length ? ` Se revocaron sus llaves de API de Administración: ${r.llavesApiRevocadas.join(', ')}.` : '');
    return { ok: `Rol cambiado: de ${nombreDeRol(r.de)} a ${nombreDeRol(r.a)}. Aplica en su siguiente clic.${llaves}` };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'cambiar el rol') };
  }
}

export async function accionDarDeBajaUsuario(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const s = await requireSuperadmin();
  try {
    const r = await darDeBajaDesdeAdmin(id(fd), s);
    refrescar();
    return { ok: mensajeDeBaja(r).mensaje };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'dar de baja la cuenta') };
  }
}

export async function accionReactivarUsuario(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const s = await requireSuperadmin();
  // Reactivar devuelve el acceso con el rol que la cuenta tenía (puede ser dueño o contador): mismo paso que cambiar el rol.
  const pasoMfa = await pasoExtraSuperadmin('cambio_rol', s);
  if (pasoMfa) return { error: pasoMfa };
  try {
    const r = await reactivarDesdeAdmin(id(fd), s);
    refrescar();
    return r.accesoRestaurado
      ? { ok: 'Cuenta reactivada: ya puede volver a entrar con su correo.' }
      : { error: 'Cuenta reactivada en el panel, pero el servicio de autenticación no confirmó levantar el bloqueo: puede que todavía no pueda entrar. Vuelve a intentarlo en un minuto.' };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'reactivar la cuenta') };
  }
}

export async function accionReenviarAccesoUsuario(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const s = await requireSuperadmin();
  try {
    const r = await reenviarAccesoDesdeAdmin(id(fd), s);
    if (r.enviado) return { ok: `Le mandamos el correo de acceso a ${r.email}. El enlace que le llega vale 60 minutos.` };
    return {
      error: r.motivo === 'sin_configurar'
        ? `NO salió correo: el canal de correo (Resend) no está configurado en este ambiente. Pásale tú la liga del panel, ${appUrl()}.`
        : `El correo de acceso NO salió. Pásale tú la liga del panel, ${appUrl()}, o vuelve a intentar.`,
    };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'reenviar el acceso') };
  }
}

export async function accionCerrarSesionesUsuario(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const s = await requireSuperadmin();
  try {
    const r = await cerrarSesionesDesdeAdmin(id(fd), s);
    return r.sesionesCerradas
      ? { ok: 'Listo: todas sus sesiones quedaron cerradas. Va a tener que volver a entrar con su correo.' }
      : { error: 'No se pudo confirmar el cierre de sesiones — quedó registrado; vuelve a intentarlo.' };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'cerrar sus sesiones') };
  }
}

// ── 4b: PERSONAL DE LIKIDA (superadmin y vendedor). Marcado para revisión del dueño: la lógica y sus candados viven en
// `lib/auth/baja_acceso.ts` (nunca a uno mismo, nunca el último superadmin) y nace apagada (LIKIDA_BAJA_PERSONAL_LIKIDA).
const SIN_ASIENTO = ' OJO: el acto ya se hizo, pero NO se pudo escribir en la bitácora; avísale a quien administra la base.';

export async function accionDarDeBajaPersonalLikida(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const s = await requireSuperadmin();
  const pasoMfa = await pasoExtraSuperadmin('cambio_rol', s);
  if (pasoMfa) return { error: pasoMfa };
  try {
    const r = await darDeBajaPersonalLikida(id(fd), s);
    refrescar();
    const sesion = r.sesionRevocada
      ? ' Sus sesiones quedaron cerradas.'
      : ' La cuenta quedó de baja, pero NO se pudo confirmar el cierre de sus sesiones: vuelve a intentarlo.';
    return { ok: `Baja hecha (${nombreDeRol(r.rol)}).${sesion}${r.bitacora ? '' : SIN_ASIENTO}` };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'dar de baja al personal de Likida') };
  }
}

export async function accionReactivarPersonalLikida(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const s = await requireSuperadmin();
  const pasoMfa = await pasoExtraSuperadmin('cambio_rol', s);
  if (pasoMfa) return { error: pasoMfa };
  try {
    const r = await reactivarPersonalLikida(id(fd), s);
    refrescar();
    return r.accesoRestaurado
      ? { ok: `Cuenta reactivada (${nombreDeRol(r.rol)}): ya puede volver a entrar.${r.bitacora ? '' : SIN_ASIENTO}` }
      : { error: 'Cuenta reactivada en el panel, pero el servicio de autenticación no confirmó levantar el bloqueo. Vuelve a intentarlo en un minuto.' };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'reactivar al personal de Likida') };
  }
}
