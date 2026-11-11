import { supabaseAdmin } from '@/lib/supabase/admin';
import { datoInvalido } from '@/lib/likida/errores';
import { esUuidValido } from '@/lib/likida/intake/cfdi';
import { rateLimit } from '@/lib/ratelimit';
import { anotarAccionAdmin, type ActorAdmin } from '@/lib/admin/acciones_riesgo';
import { provisionarUsuario, type RolAppUser } from './provisionar';
import { descifrarErrorProvision } from './invitar';
import {
  cambiarRolUsuario, desactivarUsuario, reactivarUsuario, reenviarAcceso, cerrarSesionesUsuario, enviarCorreoDeAcceso,
  type ContextoAcceso, type ResultadoCorreoAcceso,
} from './usuarios_escritura';

// ═══════════════════════════════════════════════════════════════════════════
// GESTIÓN DE PERSONAS DESDE /admin — alta con invitación, cambio de rol, baja, reactivación, reenvío de acceso y cierre de sesiones.
//
// NO DUPLICA la lógica del panel del dueño: `usuarios_escritura.ts` (la que usa /dashboard/usuarios?tenant=…) ya recibe el `tenantId`
// por argumento y ancla TODO update a él, protege al último dueño con el candado de la base (0845), impide el auto-cambio, revoca
// sesión/ban/llaves de API y asienta su bitácora `usuario.*`. Lo único que /admin necesita y no existía es saber DE QUÉ FLOTA es la
// persona elegida: se lee de la base por su id (nunca del formulario) y se le pasa a esas mismas funciones.
//
// ── LO QUE QUEDA FUERA, DECLARADO ────────────────────────────────────────
//  · Superadmin y vendedor (cuentas de Likida, `tenant_id` nulo): NO se gestionan aquí. `leerObjetivo` de usuarios_escritura filtra por
//    flota y rechaza al superadmin A PROPÓSITO, y el plan reserva su baja para la sub-entrega 4b (candado «nunca el último superadmin»,
//    «nunca a uno mismo», revisión del dueño): revocar a un superadmin mal hecho deja a Likida sin operador. Aquí se rechazan con ese motivo.
//  · Alta de superadmin/vendedor/nomina desde «Nuevo usuario»: el guardián vigente del alta (lista blanca de tres roles, ADM-12 / auditoría 13,
//    fijada por `usuarios/nuevo/resultado_visible.test.ts`) los excluye; se conserva. El vendedor tiene su puerta propia en /admin/vendedores.
// ═══════════════════════════════════════════════════════════════════════════

/** Los roles que el alta de /admin ofrece hoy (el guardián de ADM-12). Cambiarlo es una decisión del dueño, no de este módulo. */
export const ROLES_ALTA_ADMIN = ['flota_admin', 'encargado', 'contador'] as const;
export type RolAltaAdmin = (typeof ROLES_ALTA_ADMIN)[number];

/** Invitaciones por flota y hora: el MISMO techo y la misma llave que el panel del dueño (`invitar:<flota>`), para que no se sumen dos presupuestos. */
export const TOPE_INVITACIONES_HORA = 20;

/**
 * Cuánto vive el enlace de acceso que la persona pide con su correo (minutos). Es el `otp_expiry = 3600` de `supabase/config.toml` y lo
 * que ya dice `reenvio_enlace.ts` (60 min). Se dice en pantalla para que quien invita sepa que el enlace no es eterno; si caduca, la
 * persona lo pide de nuevo (o /admin usa «Reenviar acceso»).
 */
export const VIGENCIA_ENLACE_MIN = 60;

export interface ObjetivoGestion {
  id: string;
  tenantId: string;
  rol: string;
  activo: boolean;
}

/**
 * La flota y el rol de la persona elegida, leídos de la BASE. Rechaza con un motivo propio a las cuentas de Likida. LANZA si la base no
 * contesta: «no existe» y «no pude leer» son afirmaciones distintas.
 */
export async function objetivoDeGestion(usuarioId: string): Promise<ObjetivoGestion> {
  if (!esUuidValido(usuarioId)) throw datoInvalido('gestion_admin.no_se_reconoce_esa_cuenta');
  const { data, error } = await supabaseAdmin().from('app_user').select('id, tenant_id, rol, activo').eq('id', usuarioId).maybeSingle();
  if (error) throw new Error(`objetivoDeGestion: ${error.message}`);
  if (!data) throw datoInvalido('gestion_admin.no_se_reconoce_esa_cuenta_2');
  if (!data.tenant_id || data.rol === 'superadmin' || data.rol === 'vendedor') {
    throw datoInvalido('gestion_admin.esa_cuenta_es_de_likida');
  }
  return { id: String(data.id), tenantId: String(data.tenant_id), rol: String(data.rol), activo: data.activo !== false };
}

async function nombreDeFlota(tenantId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin().from('tenant').select('nombre').eq('id', tenantId).maybeSingle();
  if (error) throw new Error(`nombreDeFlota: ${error.message}`);
  return data ? ((data.nombre as string | null) ?? null) : null;
}

const actorDe = (a: ActorAdmin) => ({ id: a.userId, email: a.email ?? null });

export async function cambiarRolDesdeAdmin(usuarioId: string, rolNuevo: string, actor: ActorAdmin) {
  const o = await objetivoDeGestion(usuarioId);
  return { ...(await cambiarRolUsuario(o.tenantId, usuarioId, rolNuevo, actorDe(actor))), tenantId: o.tenantId };
}

export async function darDeBajaDesdeAdmin(usuarioId: string, actor: ActorAdmin) {
  const o = await objetivoDeGestion(usuarioId);
  return desactivarUsuario(o.tenantId, usuarioId, actorDe(actor));
}

export async function reactivarDesdeAdmin(usuarioId: string, actor: ActorAdmin) {
  const o = await objetivoDeGestion(usuarioId);
  return reactivarUsuario(o.tenantId, usuarioId, actorDe(actor));
}

export async function cerrarSesionesDesdeAdmin(usuarioId: string, actor: ActorAdmin) {
  const o = await objetivoDeGestion(usuarioId);
  return cerrarSesionesUsuario(o.tenantId, usuarioId, actorDe(actor));
}

export async function reenviarAccesoDesdeAdmin(usuarioId: string, actor: ActorAdmin) {
  const o = await objetivoDeGestion(usuarioId);
  if (!(await rateLimit(`invitar:${o.tenantId}`, TOPE_INVITACIONES_HORA, 3_600_000))) {
    throw datoInvalido('gestion_admin.demasiados_correos_de_acceso_en', { TOPE_INVITACIONES_HORA });
  }
  const contexto: ContextoAcceso = { flotaNombre: await nombreDeFlota(o.tenantId), invitaNombre: null };
  return reenviarAcceso(o.tenantId, usuarioId, actorDe(actor), contexto);
}

export interface ResultadoAlta {
  userId: string;
  tenantId: string;
  correo: ResultadoCorreoAcceso;
  /** `false` = la cuenta se creó pero la bitácora no pudo escribir. */
  bitacora: boolean;
}

/**
 * Alta de una persona en una flota desde /admin: cuenta de Auth + `app_user` (la `provisionarUsuario` de siempre, con su rollback), asiento
 * `usuario.provisionado` y correo de acceso por Resend (`enviarCorreoDeAcceso`, el del panel del dueño). La validación del rol es la lista
 * blanca vigente; el correo es best-effort DESPUÉS del alta y su resultado se DICE (`correo`): sin Resend configurado o con un fallo, la cuenta
 * ya existe y la pantalla manda a «Reenviar acceso», nunca afirma que llegó.
 */
export async function altaDeUsuarioDesdeAdmin(p: {
  tenantId: string;
  email: string;
  nombre?: string;
  rol: string;
  telefono?: string;
  actor: ActorAdmin;
}): Promise<ResultadoAlta> {
  const { tenantId, rol, actor } = p;
  if (!esUuidValido(tenantId)) throw datoInvalido('gestion_admin.elige_una_flota');
  if (!(ROLES_ALTA_ADMIN as readonly string[]).includes(rol)) {
    throw datoInvalido('gestion_admin.elige_uno_de_los_tres');
  }
  const email = p.email.trim().toLowerCase();
  if (!email) throw datoInvalido('gestion_admin.falta_el_correo');

  const flotaNombre = await nombreDeFlota(tenantId);
  if (flotaNombre === null) throw datoInvalido('gestion_admin.esa_flota_ya_no_existe');
  if (!(await rateLimit(`invitar:${tenantId}`, TOPE_INVITACIONES_HORA, 3_600_000))) {
    throw datoInvalido('gestion_admin.demasiadas_altas_en_una_hora', { TOPE_INVITACIONES_HORA });
  }

  let userId: string;
  try {
    ({ userId } = await provisionarUsuario(tenantId, email, p.nombre, rol as RolAppUser, p.telefono));
  } catch (e) {
    // Correo ya registrado / WhatsApp repetido salen verbatim; el resto sigue el camino normal (log + genérico).
    throw descifrarErrorProvision(e) ?? e;
  }

  const bitacora = await anotarAccionAdmin({
    actor, tenantId, accion: 'usuario.provisionado', entidad: 'app_user', entidadId: userId, detalle: { rol, origen: 'admin' },
  });
  const correo = await enviarCorreoDeAcceso(email, rol, { flotaNombre, invitaNombre: null });
  return { userId, tenantId, correo, bitacora };
}

/** Lo que /admin le dice a quien dio de alta: la verdad del envío, nunca «le llegó» sin `enviado`. `ok` = la persona ya tiene su invitación. */
export function fraseDeAlta(email: string, r: Pick<ResultadoAlta, 'correo' | 'bitacora'>, urlPanel: string): { ok: boolean; texto: string } {
  const sinAsiento = r.bitacora ? '' : ' OJO: la cuenta se creó pero NO se pudo escribir en la bitácora de auditoría; avísale a quien administra la base.';
  if (r.correo.enviado) {
    return {
      ok: true,
      texto: `${email} quedó dado de alta y le mandamos el correo de acceso. Entra tecleando su correo en la pantalla de acceso; el enlace que le llega vale ${VIGENCIA_ENLACE_MIN} minutos `
        + `(si caduca, lo pide de nuevo o usa «Reenviar acceso»).${sinAsiento}`,
    };
  }
  const porQue = r.correo.motivo === 'sin_configurar'
    ? 'el canal de correo (Resend) no está configurado en este ambiente'
    : 'el envío falló';
  return {
    ok: false,
    texto: `${email} quedó dado de alta, pero la invitación por correo NO salió: ${porQue}. Pásale tú la liga del panel, ${urlPanel}, `
      + `o usa «Reenviar acceso» cuando el canal funcione.${sinAsiento}`,
  };
}
