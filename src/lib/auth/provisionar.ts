// ═══════════════════════════════════════════════════════════════════════════
// ALTA DE UN USUARIO DEL PANEL. `app_user.id` tiene que ser el mismo `id` de
// `auth.users`, así que la fila de `app_user` no se puede insertar antes de
// que exista el usuario de Auth. Se crea aquí con la Admin API (service-role,
// vía supabaseAdmin()) y `email_confirm: true` para que no haga falta un paso
// de confirmación aparte — el primer login real (magic link o Google) ya es
// la confirmación.
//
// `tenantId` acepta `null` porque `app_user.tenant_id` nulo es una fila
// válida: significa superadmin, no "sin asignar" (0001_init.sql:17). El
// default de `rol` es `flota_admin` porque es el caso común — dar de alta al
// contralor de una flota — y `superadmin` se pide explícito.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { destinatarioWhatsApp } from '@/lib/meta/client';
import { logger } from '@/lib/logger';
import { esCorreoYaRegistrado } from './invitar';

/** El dominio de `app_user_rol_dominio` menos `operador` (sin login desde el
 *  7-ago-2026). `vendedor` (0105) es rol de LIKIDA: siempre con tenantId
 *  null, como superadmin — su panel es /vendedor, no /dashboard. */
export type RolAppUser = 'superadmin' | 'flota_admin' | 'contador' | 'encargado' | 'vendedor';

/**
 * LA ÚNICA traducción de `RolAppUser` a texto de pantalla.
 *
 * ARQUITECTURA 25 (BAJO, REINCIDENTE). Había cuatro copias de este mapa
 * (`admin/equipo`, `admin/mi-perfil`, `dashboard/mi-perfil`,
 * `dashboard/sesiones-mcp`) y ya habían divergido: dos seguían nombrando
 * `operador` (retirado del dominio en la 0086, sin login desde el
 * 7-ago-2026) y ninguna de las tres copias sin tipar traía `vendedor`
 * (0105) — ese superadmin salía con su rol crudo, "vendedor", en vez de un
 * rótulo. `Record<RolAppUser, string>` (exhaustivo, TypeScript avisa si
 * falta un rol) es la forma correcta; las otras tres eran
 * `Record<string, string>` y caían a `?? s.rol` en silencio.
 */
export const ROL_LABEL: Record<RolAppUser, string> = {
  superadmin: 'Superadmin',
  flota_admin: 'Dueño / Admin de flota',
  encargado: 'Encargado',
  contador: 'Contador',
  vendedor: 'Vendedor (Likida)',
};

/**
 * LA ÚNICA forma corta —en mayúsculas, para el badge del sidebar— de
 * `RolAppUser`. Antes vivía como `ROL_BADGE` en `dashboard/chrome.tsx`.
 *
 * AUDITORÍA 28, ARQ-B5 (BAJO, reincidente 26/27). Era la QUINTA copia del
 * dominio de roles (después de las cuatro de `ROL_LABEL` arriba), y el
 * barrido que debía verla —`rol_label_unico.test.ts`— casa por NOMBRE
 * (`grep … '(const|let) ROL_LABEL'`), así que `ROL_BADGE` le era invisible.
 * Estaba sin tipar (`Record<string, string>`): un sexto rol pone `tsc` en
 * rojo aquí (falta la clave en `Record<RolAppUser, string>`, exhaustivo) y
 * NUNCA en `chrome.tsx` — el sidebar habría impreso la clave cruda, lo que
 * ya le pasó a `vendedor` antes de la 0105.
 *
 * Las cinco claves son el dominio REAL de `app_user.rol` (constraint
 * `app_user_rol_dominio`: 0044_rol_encargado.sql lo abrió,
 * 0086_retirar_rol_operador.sql retiró `operador` —el chofer ya no tiene
 * login, solo WhatsApp— y 0105_zona_vendedores.sql agregó `vendedor`) — no
 * una etiqueta de adorno: decía "FLOTA" fijo para todos, y quien entra es
 * un `flota_admin`, un contador o un encargado, que no ven lo mismo. Un rol
 * nuevo cae al `??` de `chrome.tsx` y sale con su clave cruda, nunca vacío.
 */
export const ROL_BADGE: Record<RolAppUser, string> = {
  flota_admin: 'ADMIN FLOTA',
  encargado: 'ENCARGADO',
  contador: 'CONTADOR',
  vendedor: 'VENDEDOR',
  superadmin: 'SUPERADMIN',
};

/**
 * Normaliza el teléfono de oficina EXACTAMENTE como el del operador
 * (`administracion.ts:registrarOperador`): solo dígitos, lada 52 si vienen 10,
 * y la forma canónica de `destinatarioWhatsApp` — que es la que
 * `resolverCuentaOficina` (contactos.ts) sabe volver a encontrar. Guardarlo
 * con otro formato es guardarlo donde el matcher no lo ve, que era
 * exactamente el hallazgo D5: la columna existía (0059), el lector existía, y
 * ningún escritor la llenaba — el dueño de una flota nueva no podía escribirle
 * al bot sin un UPDATE a mano.
 */
function normalizarTelefonoOficina(crudo: string): string {
  const soloDigitos = crudo.replace(/[^\d]/g, '');
  if (soloDigitos.length < 10) {
    throw new Error(`El teléfono "${crudo}" tiene ${soloDigitos.length} dígitos; un número mexicano necesita 10 más la lada 52.`);
  }
  return destinatarioWhatsApp(soloDigitos.length === 10 ? `52${soloDigitos}` : soloDigitos);
}

/**
 * Resuelve, por correo, un `auth.users` que YA EXISTE pero que `createUser`
 * no puede devolver (solo regresa el usuario que ÉL crea). Hace falta porque
 * `login/page.tsx:141-149` (Google OAuth) no tiene equivalente de
 * `shouldCreateUser:false` — Supabase no lo ofrece para OAuth —, así que
 * CUALQUIER correo real de Google se auto-registra en `auth.users` solo con
 * tocar "Entrar con Google", sin pasar por `provisionarUsuario`. Cuando
 * después un `flota_admin` invita a esa MISMA persona, `createUser` rebota
 * con "already registered" y, hasta este cambio, el alta se abandonaba ahí:
 * la cuenta existe en Auth pero no tiene fila `app_user` en ningún tenant y
 * queda huérfana en `/sin-acceso` para siempre (ver `SIN_ROL` en session.ts).
 *
 * supabase-js NO expone un `getUserByEmail`/`listUsers({ email })` — paginar
 * TODOS los usuarios del proyecto para encontrar uno sería tan lento como
 * inválido como lectura de un dato que debería ser puntual. `generateLink`
 * es el único método admin que acepta un correo y regresa el `User` completo
 * sin paginar. Se usa `type: 'recovery'` y no `signup`/`invite`/`magiclink` a
 * propósito: esos tres SÍ pueden CREAR al usuario si no existe todavía (ver
 * el comentario de `generateLink` en `@supabase/auth-js`), y esta función
 * solo se llama DESPUÉS de que `createUser` ya confirmó que el correo existe
 * — `recovery` es el único tipo que falla en vez de crear si una carrera lo
 * dejara de ser verdad entre una llamada y la otra. Genera un token de
 * recuperación sin usar en `auth.users` (efecto secundario inevitable del
 * único método disponible para esto), pero el link nunca se manda a nadie ni
 * se guarda — se descarta todo excepto `data.user.id`.
 */
async function resolverAuthExistentePorCorreo(
  admin: ReturnType<typeof supabaseAdmin>,
  email: string,
): Promise<{ id: string } | null> {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
  if (error || !data.user) return null;

  // A37-L-seguridad-tenant-01 (PRE-SECUESTRO DE CUENTA). Que el usuario de Auth
  // exista NO prueba que su dueño sea quien va a recibir la invitación: con
  // `enable_signup` abierto, un atacante que conoce el correo se registra antes
  // con SU contraseña (POST /auth/v1/signup) y, si se enlazara aquí, entraría
  // con el rol invitado. Solo se adopta lo que prueba el control del correo: el
  // correo confirmado y todas sus identidades de Google (un OAuth de Google
  // devuelve el correo ya verificado). Cualquier otro origen —identidad `email`
  // (contraseña), sin confirmar, sin identidades o ilegible— se rechaza
  // (fail-closed): el llamador conserva el error neutro de «ya registrado».
  const { data: leido, error: errLeer } = await admin.auth.admin.getUserById(data.user.id);
  const u = leido?.user;
  if (errLeer || !u) return null;
  const identidades = u.identities ?? [];
  const soloGoogle = identidades.length > 0 && identidades.every((i) => i.provider === 'google');
  if (!u.email_confirmed_at || !soloGoogle) {
    logger.warn('provisionar.huerfano_no_adoptado', { userId: u.id, confirmado: Boolean(u.email_confirmed_at), soloGoogle });
    return null;
  }
  return { id: u.id };
}

export async function provisionarUsuario(
  tenantId: string | null,
  emailCrudo: string,
  nombre?: string,
  rol: RolAppUser = 'flota_admin',
  /** Opcional: el WhatsApp de esta persona de oficina, para que el bot la
   *  reconozca cuando escriba (D5, auditoría 4). Vacío = no se captura. */
  telefono?: string,
): Promise<{ userId: string }> {
  // Se normaliza ANTES de crear el usuario de Auth: un teléfono inválido no
  // debe dejar a medias un alta (usuario de Auth creado, fila sin teléfono).
  const telefonoCanonico = telefono?.trim() ? normalizarTelefonoOficina(telefono) : null;
  // A37-S24-06: Auth guarda el correo en minúsculas; si `app_user.email` queda
  // con las mayúsculas de la captura, la búsqueda del huérfano (sensible a
  // mayúsculas) y el UNIQUE dejan de coincidir con Auth.
  const email = emailCrudo.trim().toLowerCase();

  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });

  let userId: string;
  // Si el usuario de Auth lo creó ESTA llamada, el rollback de abajo puede
  // borrarlo sin reparos. Si en vez lo ENLAZAMOS porque ya existía (rama de
  // "already registered"), NO es nuestro para borrar — borrarlo sería tirar
  // la cuenta real de otra persona (o la de este mismo usuario en otro flujo)
  // por un choque de ESTE insert.
  let authEsNuestro: boolean;

  if (error || !data.user) {
    // Cualquier otro fallo de `createUser` (SMTP, cuota, etc.) sigue su
    // camino de siempre: no es el caso que esta rama resuelve.
    if (!error || !esCorreoYaRegistrado(error)) {
      throw new Error(error?.message ?? 'no se pudo crear el usuario de Auth');
    }

    // `app_user.email` es NOT NULL UNIQUE desde la 0001 — a lo más una fila
    // en TODO el proyecto, de cualquier tenant. Si YA hay una, este correo de
    // verdad es cliente de Likida (aquí o en otra flota, quizá la
    // competencia) y SEG-7 (invitar.ts) exige seguir tratándolo como "ya
    // registrado" sin tocar nada — el llamador ya sabe traducir este mismo
    // error con `esCorreoYaRegistrado`/`mensajeAltaNeutro`. Solo cuando NO
    // hay ninguna fila `app_user` es el caso huérfano de Google: se completa
    // el alta de verdad enlazando la fila nueva al `id` de Auth que YA
    // EXISTE, en vez de dejarla abandonada.
    const { data: existente, error: errExistente } = await admin
      .from('app_user')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (errExistente) throw new Error(errExistente.message);
    if (existente) throw new Error(error.message);

    const resuelto = await resolverAuthExistentePorCorreo(admin, email);
    if (!resuelto) throw new Error(error.message);

    userId = resuelto.id;
    authEsNuestro = false;
  } else {
    userId = data.user.id;
    authEsNuestro = true;
  }

  const { error: errInsert } = await admin.from('app_user').insert({
    id: userId, tenant_id: tenantId, email, nombre: nombre ?? null, rol,
    telefono: telefonoCanonico,
  });
  if (errInsert) {
    if (authEsNuestro) {
      // ── ROLLBACK (auditoría 24, H6). Sin esto, un insert que rebota (el
      // teléfono ya identifica a otra cuenta — índice 0059—, un bache) dejaba
      // un usuario de Auth SIN fila en app_user: una cuenta que puede iniciar
      // sesión (magic link) y aterriza en /sin-acceso, y que además bloquea
      // para siempre un segundo alta con el mismo correo («already
      // registered»). Se borra el usuario de Auth que ESTA llamada creó; si el
      // borrado también falla, se dice en el log y el error original sigue su
      // camino — el llamador ya sabe que el alta no se completó.
      const { error: errBorrar } = await admin.auth.admin.deleteUser(userId);
      if (errBorrar) {
        logger.error('provisionar.rollback_fallo', { userId, err: errBorrar.message, causa: errInsert.message });
      }
    }
    throw new Error(errInsert.message);
  }

  return { userId };
}
