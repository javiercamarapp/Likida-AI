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

/** El dominio de `app_user_rol_dominio` menos `operador` (sin login desde el
 *  7-ago-2026). `vendedor` (0105) es rol de LIKIDA: siempre con tenantId
 *  null, como superadmin — su panel es /vendedor, no /dashboard. */
export type RolAppUser = 'superadmin' | 'flota_admin' | 'contador' | 'encargado' | 'vendedor';

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

export async function provisionarUsuario(
  tenantId: string | null,
  email: string,
  nombre?: string,
  rol: RolAppUser = 'flota_admin',
  /** Opcional: el WhatsApp de esta persona de oficina, para que el bot la
   *  reconozca cuando escriba (D5, auditoría 4). Vacío = no se captura. */
  telefono?: string,
): Promise<{ userId: string }> {
  // Se normaliza ANTES de crear el usuario de Auth: un teléfono inválido no
  // debe dejar a medias un alta (usuario de Auth creado, fila sin teléfono).
  const telefonoCanonico = telefono?.trim() ? normalizarTelefonoOficina(telefono) : null;

  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(error?.message ?? 'no se pudo crear el usuario de Auth');

  const { error: errInsert } = await admin.from('app_user').insert({
    id: data.user.id, tenant_id: tenantId, email, nombre: nombre ?? null, rol,
    telefono: telefonoCanonico,
  });
  if (errInsert) throw new Error(errInsert.message);

  return { userId: data.user.id };
}
