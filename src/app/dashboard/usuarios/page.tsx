import { mensajeDeBaja } from '@/lib/auth/mensaje_baja';
import { exigirStepUpAccion, rolAsignableExigeStepUp } from '@/lib/auth/stepup';
import { appUrl } from '@/lib/env';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolverTenantEfectivo, type TenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoAccion, MENSAJE_FLOTA_CAMBIO } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { perfilDeTenant } from '@/lib/auth/perfil_tenant';
import { provisionarUsuario } from '@/lib/auth/provisionar';
import {
  validarInvitacion, descifrarErrorProvision, esCorreoYaRegistrado, mensajeAltaNeutro, ROLES_INVITABLES, rolesInvitablesPara, type ContextoInvitacion,
} from '@/lib/auth/invitar';
import {
  cambiarRolUsuario, desactivarUsuario, reactivarUsuario, reenviarAcceso, enviarCorreoDeAcceso, cerrarSesionesUsuario,
  type ContextoAcceso, type ResultadoCorreoAcceso,
} from '@/lib/auth/usuarios_escritura';
import { nombreDeRol } from '@/lib/auth/roles';
import { rateLimit } from '@/lib/ratelimit';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { logger } from '@/lib/logger';
import { conPisoDeTiempo } from '../../login/respuesta_otp';
import { VistaUsuarios, type UsuarioRow } from './vista';
import type { ResultadoForma } from './forma';
import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/servidor';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('resto');
  return { title: t('cfg.usuarios_del_equipo') };
}

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/usuarios';

/** Invitaciones por flota y hora (SEG-7): el alta manda correo y crea cuentas
 *  de Auth; sin techo, un dueño (o su sesión robada) enumera correos. */
const TOPE_INVITACIONES_HORA = 20;

async function getUsuarios(tenantId: string): Promise<UsuarioRow[]> {
  const { data, error } = await supabaseAdmin()
    .from('app_user')
    .select('id, nombre, email, rol, telefono, activo, desactivado_en')
    .eq('tenant_id', tenantId)
    // Activos primero; las de baja al final, visibles (son el rastro).
    .order('activo', { ascending: false })
    .order('rol');
  if (error) throw new Error(`getUsuarios: ${error.message}`);
  return (data ?? []).map((u) => ({
    id: u.id as string,
    nombre: (u.nombre as string) || null,
    // `app_user.email` existe desde la 0001 (not null unique) y lo escribe
    // `provisionarUsuario` — el comentario viejo de esta página decía que el
    // correo solo vivía en auth.users, y era falso. Se enseña porque un
    // invitado sin nombre sería un renglón imposible de distinguir.
    email: u.email as string,
    rol: u.rol as string,
    telefono: (u.telefono as string) || null,
    // Solo el `false` explícito es baja (base sin la 0294 → todos activos).
    activo: u.activo !== false,
    desactivadoEn: (u.desactivado_en as string | null) ?? null,
  }));
}

/** El nombre de la flota para el correo de acceso. `null` si no se pudo
 *  leer: el correo dice «una flota» en vez de inventar. */
async function contextoDeAcceso(s: TenantEfectivo): Promise<ContextoAcceso> {
  let flotaNombre = s.tenantNombre;
  if (!flotaNombre) {
    const { data } = await supabaseAdmin().from('tenant').select('nombre').eq('id', s.tenantId).maybeSingle();
    flotaNombre = (data?.nombre as string | undefined) ?? null;
  }
  return { flotaNombre, invitaNombre: s.nombre };
}

/** Lo que se le dice al dueño sobre el correo — la verdad de `enviarCorreo`,
 *  nunca «le llegó» sin `ok`. (Reenviar acceso: ahí la cuenta ES de esta flota.) */
function fraseCorreo(r: ResultadoCorreoAcceso, email: string, t: TResto = T_RESTO_ES): string {
  if (r.enviado) return t('cfg.le_mandamos_el_correo_de_acceso', { email });
  if (r.motivo === 'sin_configurar') {
    return t('cfg.no_le_llega_correo_el_canal', { appUrl: appUrl() });
  }
  return t('cfg.el_correo_de_acceso_no_salio', { appUrl: appUrl() });
}

/** A37-S21-02: la frase del ALTA es el MISMO texto salga el correo, falle, o no
 *  se haya intentado (correo que ya tenía cuenta); cualquier diferencia
 *  convertía el alta en un oráculo de qué correos ya son clientes. La verdad
 *  del envío queda en el log. */
function fraseAlta(email: string, t: TResto = T_RESTO_ES): string {
  return t('cfg.si_es_una_cuenta_nueva_el', { email, appUrl: appUrl() });
}

/** Desde dónde se invita: el rol REAL de la sesión (un superadmin que previsualiza `?rol=flota_admin` NO invita `nomina`) y el perfil de la flota. */
function contextoDeInvitacion(s: { rol: string; rolReal?: string }, perfil: string | null | undefined): ContextoInvitacion {
  return { rolInvitador: s.rolReal ?? s.rol, perfil };
}

/**
 * La puerta común de las acciones que ADMINISTRAN: sesión re-resuelta, ruta
 * visible y `puedeAdministrar`. Devuelve el error listo para pantalla.
 *
 * A NIVEL DE MÓDULO, no dentro del componente: las acciones `'use server'` la
 * llaman, y una función capturada por closure tendría que serializarse en
 * `encryptActionBoundArgs` — que no puede con funciones (ver la nota de
 * `volverAMiPerfil` en mi-perfil/page.tsx). Recibiendo `sp`, lo capturado
 * es un objeto plano.
 */
async function puertaAdministrar(
  sp: { vista?: string; tenant?: string; rol?: string },
  tenantPintado: string,
): Promise<{ s: TenantEfectivo } | { error: string }> {
  const { t } = await getT('resto');
  // MX-002: roles y bajas escriben SOLO en la flota que esta pantalla pintó (otra pestaña pudo cambiar la cookie).
  const s = await resolverTenantAtadoAccion(RUTA, sp, tenantPintado);
  if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
  if (!puedeVerRuta(s.rol, RUTA)) return { error: t('cfg.tu_rol_no_puede_ver_el') };
  if (!puedeAdministrar(s.rol)) return { error: t('cfg.solo_el_dueno_de_la_flota_9') };
  return { s };
}

/**
 * Usuarios & Roles (PASO 22) + invitar (D6, auditoría 4) + GESTIÓN (auditoría
 * 24, SEG-1/H5): el equipo real de esta flota, la puerta para que el dueño dé
 * de alta a su contralor, y por fin la de cambiar rol, dar de baja (con
 * revocación real de sesión), reactivar y reenviar el acceso.
 *
 * ── DOS PUERTAS, como en /dashboard/clientes ──────────────────────────────
 *  · VER es área `administracion` (`puedeVerRuta`): superadmin y flota_admin.
 *  · ADMINISTRAR (invitar, cambiar rol, baja, reenviar) es `puedeAdministrar`:
 *    el mismo criterio de la RLS de las llaves (0093) — repartir o quitar
 *    acceso es CONTROL de la cuenta.
 *
 * LAS DOS SE VUELVEN A COMPROBAR DENTRO DE CADA SERVER ACTION: el rol del
 * render es el del momento en que se pintó, y una server action es un
 * endpoint POST alcanzable sin pasar por aquí. El `tenantId` va por CLOSURE
 * desde la sesión re-resuelta — NADA del formulario decide a qué flota entra
 * el invitado ni de qué flota es la cuenta que se toca.
 */
export default async function UsuariosPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const { t } = await getT('resto');
  const sp = await searchParams;
  const { tenantId, userId, rol, rolReal } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const perfilDeLaFlota = await perfilDeTenant(tenantId);

  // El catch NO finge equipo vacío: `null` y la vista dice que no se pudo
  // leer — una base caída no es "no hay cuentas".
  let usuarios: UsuarioRow[] | null;
  try {
    usuarios = await getUsuarios(tenantId);
  } catch {
    usuarios = null;
  }

  async function invitarUsuario(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const { t } = await getT('resto');
    const p = await puertaAdministrar(sp, tenantId);
    if ('error' in p) return { ok: false, error: p.error };
    const { s } = p;

    // SEG-7: techo por flota. Sin él, el alta es un oráculo de qué correos
    // ya son clientes de Likida a la velocidad que el dueño quiera probar.
    if (!(await rateLimit(`invitar:${s.tenantId}`, TOPE_INVITACIONES_HORA, 3_600_000))) {
      return { ok: false, error: t('cfg.demasiadas_invitaciones_en_una_hora_tope', { TOPE_INVITACIONES_HORA }) };
    }

    // `nomina` (0949) solo se invita a una flota con perfil `cinco_agentes` y solo por su dueño (rol REAL de la sesión).
    const perfil = await perfilDeTenant(s.tenantId);
    let v;
    try {
      // La validación del navegador (required, type=email) avisa temprano;
      // ÉSTA es la que manda — rechaza `superadmin` aunque el select no lo
      // ofrezca (un POST directo puede pedir cualquier rol) y ataja el
      // teléfono corto ANTES de crear nada. Es la misma que prueba
      // `invitar.test.ts`.
      v = validarInvitacion({
        email: String(fd.get('email') ?? ''),
        nombre: String(fd.get('nombre') ?? ''),
        rol: String(fd.get('rol') ?? ''),
        telefono: String(fd.get('telefono') ?? ''),
      }, contextoDeInvitacion(s, perfil));
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'invitar al usuario') };
    }

    // Invitar con rol de dueño o contador es repartir acceso a dinero: mismo segundo factor reciente que `cambiarRol`
    // (R7-A1). Va ANTES de crear nada y su texto no depende del correo, así que no abre un oráculo.
    if (rolAsignableExigeStepUp(v.rol)) {
      const pasoMfa = await exigirStepUpAccion(s.rol, 'cambio_rol', { tenantId: s.tenantId, userId: s.userId });
      if (pasoMfa) return { ok: false, error: pasoMfa };
    }

    // A37-S21-02: las dos ramas (alta nueva con correo / correo que ya tenía
    // cuenta, sin correo) contestan el MISMO texto y tardan al menos lo mismo
    // (`conPisoDeTiempo`, como el login): ni el mensaje ni el reloj distinguen
    // un correo que ya es cliente de otra flota.
    type Resultado = { ok: true } | { ok: false; error: string };
    const r: Resultado = await conPisoDeTiempo(async (): Promise<Resultado> => {
      try {
        // El tenant es EL DE LA SESIÓN, por closure — jamás del formulario.
        await provisionarUsuario(s.tenantId, v.email, v.nombre, v.rol, v.telefono);
      } catch (e) {
        // SEG-7: un correo que YA tiene cuenta contesta EXACTAMENTE igual que
        // un alta buena, sin correo de acceso. Decir «ese correo ya está
        // registrado» le confirmaba a la flota A que el contralor de la flota
        // B (su competencia) es cliente de Likida. El caso queda en el log
        // —para Likida— y no en la pantalla.
        if (esCorreoYaRegistrado(e)) {
          logger.warn('invitar.correo_ya_registrado', { tenant: s.tenantId });
          return { ok: true };
        }
        // Los otros errores de captura (WhatsApp repetido) sí se traducen y
        // salen VERBATIM; el resto sigue el camino normal (log + genérico).
        return { ok: false, error: mensajeParaPantalla(descifrarErrorProvision(e) ?? e, 'invitar al usuario') };
      }
      // El correo de acceso: best-effort, DESPUÉS del alta. Si no salió, queda
      // en el log (y el dueño tiene «Reenviar acceso»); la pantalla no lo dice.
      const envio = await enviarCorreoDeAcceso(v.email, v.rol, await contextoDeAcceso(s));
      if (!envio.enviado) logger.warn('invitar.correo_no_salio', { tenant: s.tenantId, motivo: envio.motivo });
      return { ok: true };
    });
    if (!r.ok) return { ok: false, error: r.error };
    revalidatePath(RUTA);
    return { ok: true, mensaje: `${mensajeAltaNeutro(v.email)} ${fraseAlta(v.email, t)}` };
  }

  async function cambiarRol(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const { t } = await getT('resto');
    const p = await puertaAdministrar(sp, tenantId);
    if ('error' in p) return { ok: false, error: p.error };
    const { s } = p;
    const pasoMfa = await exigirStepUpAccion(s.rol, 'cambio_rol', { tenantId: s.tenantId, userId: s.userId });
    if (pasoMfa) return { ok: false, error: pasoMfa };
    try {
      const r = await cambiarRolUsuario(s.tenantId, String(fd.get('id') ?? ''), String(fd.get('rol') ?? ''), { id: s.userId });
      revalidatePath(RUTA);
      const llaves = r.llavesApiSinRevocar
        ? t('cfg.atencion_no_se_pudieron_revocar_sus')
        : (r.llavesApiRevocadas?.length ? t('cfg.se_revocaron_sus_llaves_de_api', { r: r.llavesApiRevocadas.join(', ') }) : '');
      return { ok: true, mensaje: t('cfg.rol_cambiado_de_a_aplica_en', { nombreDeRol: nombreDeRol(r.de), nombreDeRol2: nombreDeRol(r.a), llaves }) };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'cambiar el rol') };
    }
  }

  async function darDeBaja(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const { t } = await getT('resto');
    const p = await puertaAdministrar(sp, tenantId);
    if ('error' in p) return { ok: false, error: p.error };
    const { s } = p;
    try {
      const r = await desactivarUsuario(s.tenantId, String(fd.get('id') ?? ''), { id: s.userId });
      revalidatePath(RUTA);
      return mensajeDeBaja(r);
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, t('cfg.dar_de_baja_la_cuenta')) };
    }
  }

  async function cerrarSesiones(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const { t } = await getT('resto');
    const p = await puertaAdministrar(sp, tenantId);
    if ('error' in p) return { ok: false, error: p.error };
    const { s } = p;
    try {
      const r = await cerrarSesionesUsuario(s.tenantId, String(fd.get('id') ?? ''), { id: s.userId });
      return r.sesionesCerradas
        ? { ok: true, mensaje: t('cfg.listo_todas_sus_sesiones_quedaron_cerradas') }
        : { ok: false, error: t('cfg.no_se_pudo_confirmar_el_cierre_2') };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'cerrar sus sesiones') };
    }
  }

  async function reactivar(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const { t } = await getT('resto');
    const p = await puertaAdministrar(sp, tenantId);
    if ('error' in p) return { ok: false, error: p.error };
    const { s } = p;
    // Reactivar devuelve el acceso con el rol que la cuenta tenía (puede ser dueño o contador): mismo paso que `cambiarRol` (R7-A1).
    const pasoMfa = await exigirStepUpAccion(s.rol, 'cambio_rol', { tenantId: s.tenantId, userId: s.userId });
    if (pasoMfa) return { ok: false, error: pasoMfa };
    try {
      const r = await reactivarUsuario(s.tenantId, String(fd.get('id') ?? ''), { id: s.userId });
      revalidatePath(RUTA);
      return r.accesoRestaurado
        ? { ok: true, mensaje: t('cfg.cuenta_reactivada_ya_puede_volver_a') }
        : { ok: true, mensaje: t('cfg.cuenta_reactivada_en_el_panel_pero') };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'reactivar la cuenta') };
    }
  }

  async function reenviar(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const { t } = await getT('resto');
    const p = await puertaAdministrar(sp, tenantId);
    if ('error' in p) return { ok: false, error: p.error };
    const { s } = p;
    if (!(await rateLimit(`invitar:${s.tenantId}`, TOPE_INVITACIONES_HORA, 3_600_000))) {
      return { ok: false, error: t('cfg.demasiados_correos_de_acceso_en_una', { TOPE_INVITACIONES_HORA }) };
    }
    try {
      const r = await reenviarAcceso(s.tenantId, String(fd.get('id') ?? ''), { id: s.userId }, await contextoDeAcceso(s));
      return r.enviado
        ? { ok: true, mensaje: fraseCorreo(r, r.email, t) }
        : { ok: false, error: fraseCorreo(r, r.email, t) };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'reenviar el acceso') };
    }
  }

  return (
    <VistaUsuarios t={t}
      usuarios={usuarios}
      userId={userId}
      puedeInvitar={puedeAdministrar(rol)}
      // Como PROP y no como import del componente cliente — ver forma.tsx.
      roles={ROLES_INVITABLES}
      // Solo el formulario de invitar ofrece `nomina` (y solo con perfil + dueño); el cambio de rol sigue con la lista de siempre.
      rolesInvitar={rolesInvitablesPara(contextoDeInvitacion({ rol, rolReal }, perfilDeLaFlota))}
      acciones={{ invitar: invitarUsuario, cambiarRol, darDeBaja, reactivar, reenviarAcceso: reenviar, cerrarSesiones }}
    />
  );
}
