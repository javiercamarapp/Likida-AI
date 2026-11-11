'use server';

import { appUrl } from '@/lib/env';
import { revalidatePath } from 'next/cache';
import type { SessionTenant } from '@/lib/auth/session';
import { getSessionTenant } from '@/lib/auth/session';
import { veredictoMfaDeSesion } from '@/lib/auth/superadmin-mfa';
import { MSG_MFA_SUPERADMIN } from '@/lib/auth/mfa';
import {
  validarProspecto,
  crearProspecto,
  asignarProspecto,
  cambiarEstadoProspecto,
  actualizarNotasProspecto,
  invitarVendedor,
  asignarPendientes,
} from '@/lib/likida/vendedores';
import {
  anotarAccionVendedor, correoDeAccesoDisponible, enviarAccesoVendedor, MENSAJE_SIN_CORREO,
} from '@/lib/likida/vendedores_registro';
import { redactarCorreoFrio } from '@/lib/likida/agentes/redactor';
import { descifrarErrorProvision } from '@/lib/auth/invitar';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import type { ResultadoAccion } from './tablero';
import type { ResultadoForma } from './formas';
import { getT } from '@/lib/i18n/servidor';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';

const RUTA = '/admin/vendedores';
const errorAccesoTr = (t: TSistema = T_SISTEMA_ES) => (t('vendedores_acciones.solo_el_superadmin_administra_la_zona'));

type ResultadoNoNulo = ResultadoAccion | Exclude<ResultadoForma, null>;

/**
 * Toda mutación de la consola pasa por esta puerta. La sesión, el rol y MFA
 * se resuelven antes de invocar `hacer`; por eso un rechazo no alcanza ni la
 * validación del payload ni la base, el LLM o Auth Admin.
 */
async function ejecutarComoSuperadmin<T extends ResultadoNoNulo>(
  hacer: (sesion: SessionTenant) => Promise<T>,
  operacion: string,
  errorAcceso?: string,
  traducirError?: (error: unknown) => unknown,
): Promise<T | { ok: false; error: string }> {
  const { t, idioma } = await getT('admin_sistema');
  const sesion = await getSessionTenant();
  if (sesion?.rol !== 'superadmin') return { ok: false, error: errorAcceso ?? errorAccesoTr(t) };

  const veredicto = await veredictoMfaDeSesion(sesion);
  if (veredicto !== 'ok') return { ok: false, error: MSG_MFA_SUPERADMIN[veredicto] };

  try {
    const resultado = await hacer(sesion);
    revalidatePath(RUTA);
    return resultado;
  } catch (error) {
    return {
      ok: false,
      error: mensajeParaPantalla(traducirError ? traducirError(error) : error, operacion, idioma),
    };
  }
}

export async function accionMover(id: string, a: string): Promise<ResultadoAccion> {
  return ejecutarComoSuperadmin(async (sesion) => {
    await cambiarEstadoProspecto(String(id), String(a));
    await anotarAccionVendedor(sesion, 'prospecto.movido', String(id), { a: String(a) });
    return { ok: true };
  }, 'mover el prospecto');
}

export async function accionAsignar(id: string, vendedorId: string): Promise<ResultadoAccion> {
  return ejecutarComoSuperadmin(async (sesion) => {
    await asignarProspecto(String(id), vendedorId === '' ? null : String(vendedorId));
    await anotarAccionVendedor(sesion, 'prospecto.asignado', String(id), { vendedor: vendedorId === '' ? null : String(vendedorId) });
    return { ok: true };
  }, 'asignar el prospecto');
}

export async function accionNota(id: string, nota: string): Promise<ResultadoAccion> {
  return ejecutarComoSuperadmin(async (sesion) => {
    await actualizarNotasProspecto(String(id), String(nota));
    await anotarAccionVendedor(sesion, 'prospecto.nota', String(id), { largo: String(nota).length });
    return { ok: true };
  }, 'guardar la nota');
}

export async function accionRedactar(id: string): Promise<ResultadoAccion> {
  const { t } = await getT('admin_sistema');
  return ejecutarComoSuperadmin(async (sesion) => {
    // El superadmin de LIKIDA no tiene tenant: su gasto es de plataforma
    // (c5-10), con el techo del runner sobre el gasto medido del día.
    const r = await redactarCorreoFrio(
      String(id),
      sesion.nombre ?? 'Javier',
      'manual',
      sesion.tenantId ? { tenantId: sesion.tenantId } : { plataforma: true },
    );
    return {
      ok: true,
      mensaje: t('vendedores_acciones.quedo_en_la_cola_apruebala_en', { asunto: r.asunto, v: r.aviso ? ` OJO: ${r.aviso}` : '' }),
    };
  }, 'redactar el correo');
}

export async function accionCrearProspecto(
  _previo: ResultadoForma,
  fd: FormData,
): Promise<ResultadoForma> {
  const { t } = await getT('admin_sistema');
  return ejecutarComoSuperadmin(async () => {
    const v = validarProspecto({
      empresa: String(fd.get('empresa') ?? ''),
      contactoNombre: String(fd.get('contacto') ?? ''),
      telefono: String(fd.get('telefono') ?? ''),
      correo: String(fd.get('correo') ?? ''),
      ciudad: String(fd.get('ciudad') ?? ''),
      vacante: String(fd.get('vacante') ?? ''),
      notas: String(fd.get('notas') ?? ''),
      vendedorId: String(fd.get('vendedor') ?? ''),
    });
    await crearProspecto(v, 'manual');
    return {
      ok: true,
      mensaje: t('vendedores_acciones.entro_al_tablero', { empresa: v.empresa, v: v.vendedorId ? '' : t('vendedores_acciones.sin_vendedor_lo_puede_tomar') }),
    };
  }, t('vendedores_acciones.dar_de_alta_el_prospecto'), t('vendedores_acciones.solo_el_superadmin_da_de_alta'));
}

export async function accionInvitar(
  _previo: ResultadoForma,
  fd: FormData,
): Promise<ResultadoForma> {
  const { t } = await getT('admin_sistema');
  return ejecutarComoSuperadmin(async (sesion) => {
    // Falla CERRADA: sin correo saliente no se crea la cuenta (nadie le avisaría al vendedor ni le llegaría su enlace).
    if (!correoDeAccesoDisponible()) return { ok: false, error: MENSAJE_SIN_CORREO };
    const { userId, email } = await invitarVendedor(
      String(fd.get('email') ?? ''),
      String(fd.get('nombre') ?? ''),
    );
    await anotarAccionVendedor(sesion, 'vendedor.invitado', userId, {});
    const envio = await enviarAccesoVendedor(email, sesion.nombre);
    if (!envio.enviado) {
      // La cuenta ya existe; el correo no salió. Se dice tal cual, sin verde.
      return {
        ok: false,
        error: t('vendedores_acciones.ya_tiene_cuenta_pero_el_correo', { email, appUrl: appUrl() }),
      };
    }
    return {
      ok: true,
      mensaje: t('vendedores_acciones.le_mandamos_la_invitacion_a_entra', { email }),
    };
  }, 'invitar al vendedor', t('vendedores_acciones.solo_el_superadmin_invita_vendedores'),
  (error) => descifrarErrorProvision(error) ?? error);
}

// Sin parámetros a propósito: el botón no captura nada — una función de
// menos parámetros es asignable a `AccionForma`.
export async function accionRepartir(): Promise<ResultadoForma> {
  const { t } = await getT('admin_sistema');
  return ejecutarComoSuperadmin(async () => {
    const r = await asignarPendientes();
    if (r.apagado) {
      return { ok: false, error: t('vendedores_acciones.el_asignador_agente_ventas_esta_apagado') };
    }
    if (r.sinVendedores) {
      return { ok: false, error: t('vendedores_acciones.no_hay_vendedores_a_quienes_repartir') };
    }
    if (r.pendientes === 0) {
      return { ok: true, mensaje: t('vendedores_acciones.no_habia_prospectos_pendientes_sin_vendedor') };
    }
    if (r.repartidos === 0) {
      return { ok: false, error: t('vendedores_acciones.no_se_pudo_repartir_ninguno_revisa') };
    }
    const detalle = r.porVendedor.map((v) => `${v.nombre} (${v.n})`).join(', ');
    return {
      ok: true,
      mensaje: t('vendedores_acciones.repartio_de_la_corrida_quedo_en', { repartidos: r.repartidos, pendientes: r.pendientes, detalle }),
    };
  }, 'repartir los pendientes', t('vendedores_acciones.solo_el_superadmin_corre_el_asignador'));
}
