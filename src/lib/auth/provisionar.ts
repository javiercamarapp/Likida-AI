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

export type RolAppUser = 'superadmin' | 'flota_admin' | 'contador' | 'operador' | 'encargado';

export async function provisionarUsuario(
  tenantId: string | null,
  email: string,
  nombre?: string,
  rol: RolAppUser = 'flota_admin',
): Promise<{ userId: string }> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(error?.message ?? 'no se pudo crear el usuario de Auth');

  const { error: errInsert } = await admin.from('app_user').insert({
    id: data.user.id, tenant_id: tenantId, email, nombre: nombre ?? null, rol,
  });
  if (errInsert) throw new Error(errInsert.message);

  return { userId: data.user.id };
}
