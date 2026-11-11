'use server';

import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { crearFlota, mensajeParaPantalla } from '@/lib/likida/administracion';
import { actualizarFacilidad15 } from '@/lib/likida/repo';
import { pasoExtraSuperadmin } from '@/lib/admin/acciones_riesgo';
import { altaDeUsuarioDesdeAdmin, fraseDeAlta } from '@/lib/auth/gestion_admin';
import { gestionarSuscripcionDeFlota } from '@/lib/saas/asignar-plan';
import { appUrl } from '@/lib/env';
import type { ResultadoAccion } from '../ui/forma';

import { getT } from '@/lib/i18n/servidor';
// Las dos acciones de servidor de Clientes, extraídas de page.tsx (una acción es un endpoint propio: cada una re-gatea con
// `requireSuperadmin`). `accionCrearFlota` ahora (1) deja que el alta elija plan, (2) da de alta al dueño con la MISMA ruta que
// «Nuevo acceso» (correo de acceso + asiento `usuario.provisionado`) y (3) no es "todo o nada" a ciegas: si la flota ya quedó creada
// y falló el dueño o el plan, lo DICE y manda a terminar desde la ficha, en vez de invitar a reintentar el formulario (que
// crearía una SEGUNDA flota con el mismo nombre).

/** ¿Vienen los CINCO del receptor? Es la condición exacta de `getFiscalDeFlota`. */
function fiscalListo(fd: FormData): boolean {
  return ['rfc', 'razonSocial', 'regimenFiscal', 'codigoPostalFiscal', 'usoCfdi']
    .every((c) => String(fd.get(c) ?? '').trim().length > 0);
}

const texto = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

export async function accionCrearFlota(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_flotas');
  const s = await requireSuperadmin();
  const nombre = texto(fd, 'nombre');
  const emailAdmin = texto(fd, 'emailAdmin');
  const planClave = texto(fd, 'planClave');

  // Los pasos de confirmación reforzada (apagados hasta encender LIKIDA_TOTP_ESCALONADO) van ANTES de crear nada: una flota a medias
  // por un segundo factor vencido sería justo el estado que esta acción trata de evitar.
  if (emailAdmin) {
    const paso = await pasoExtraSuperadmin('cambio_rol', s);
    if (paso) return { error: paso };
  }
  if (planClave) {
    const paso = await pasoExtraSuperadmin('dinero_saas', s);
    if (paso) return { error: paso };
  }

  let tenantId: string;
  try {
    ({ tenantId } = await crearFlota(
      {
        nombre,
        rfc: texto(fd, 'rfc'),
        ciudad: texto(fd, 'ciudad'),
        dedicacionExclusivaCarga: fd.get('dedicacionExclusivaCarga') === 'on' ? true : undefined,
        regimenFiscal: texto(fd, 'regimenFiscal') || undefined,
        razonSocial: texto(fd, 'razonSocial') || undefined,
        codigoPostalFiscal: texto(fd, 'codigoPostalFiscal') || undefined,
        usoCfdi: texto(fd, 'usoCfdi') || undefined,
      },
      { id: s.userId },
    ));
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'dar de alta la flota') };
  }
  revalidatePath('/admin/flotas');

  const hechos: string[] = [t('flotas_acciones.dada_de_alta', { nombre })];
  const pendientes: string[] = [];
  let fallo = false;

  if (emailAdmin) {
    try {
      const r = await altaDeUsuarioDesdeAdmin({
        tenantId, email: emailAdmin, nombre: texto(fd, 'nombreAdmin') || undefined, rol: 'flota_admin',
        telefono: texto(fd, 'telefonoAdmin') || undefined, actor: s,
      });
      const f = fraseDeAlta(emailAdmin, r, appUrl());
      (f.ok ? hechos : pendientes).push(f.texto);
      if (!f.ok) fallo = true;
      revalidatePath('/admin/equipo');
    } catch (e) {
      fallo = true;
      pendientes.push(t('flotas_acciones.no_se_pudo_dar', { e: mensajeParaPantalla(e, 'dar de alta al administrador') }));
    }
  } else {
    pendientes.push(t('flotas_acciones.todavia_no_tiene_a'));
  }

  if (planClave) {
    try {
      const r = await gestionarSuscripcionDeFlota({ tenantId, operacion: 'asignar', planClave, actor: s });
      hechos.push(t('flotas_acciones.plan_asignado_en_estado', { planClave: r.planClave }));
      revalidatePath(`/admin/flotas/${tenantId}`);
    } catch (e) {
      fallo = true;
      pendientes.push(t('flotas_acciones.no_se_pudo_asignar', { e: mensajeParaPantalla(e, 'asignar el plan') }));
    }
  }

  if (!fiscalListo(fd)) {
    // SE DICE SI PUEDE FACTURAR O NO, aquí y ahora: un "listo" mudo escondió el hueco semanas.
    pendientes.push(t('flotas_acciones.le_faltan_datos_fiscales'));
  }

  const cuerpo = [...hechos, ...pendientes].join(' ');
  // Un FALLO (dueño, correo o plan) es aviso rojo; faltar datos fiscales o no haber pedido dueño no lo es.
  return fallo ? { error: t('flotas_acciones.la_flota_ya_existe', { cuerpo }) } : { ok: cuerpo };
}

// AUDITORÍA 14: la declaración del 15% (RFA 2.9) se puede VER y CORREGIR.
export async function accionFacilidad(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t } = await getT('admin_flotas');
  const s = await requireSuperadmin();
  const flotaId = String(fd.get('flotaId') ?? '');
  const ded = fd.get('ded') === 'si' ? true : fd.get('ded') === 'no' ? false : undefined;
  const reg = fd.get('reg') === 'si' ? true : fd.get('reg') === 'no' ? false : undefined;
  if (!flotaId) return { error: t('flotas_acciones.falta_la_flota') };
  try {
    // AUDITORÍA 28, FIS-A3: `actualizarFacilidad15` escribe también `tenant.perfil` (la fuente única de `facilidad15Vigente`).
    await actualizarFacilidad15(flotaId, ded, reg, s.userId);
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'guardar la declaración') };
  }
  revalidatePath('/admin/flotas');
  revalidatePath(`/admin/flotas/${flotaId}`);
  return { ok: ded !== undefined ? t('flotas_acciones.declaracion_del_15_actualizada') : t('flotas_acciones.declaracion_del_15_borrada') };
}
