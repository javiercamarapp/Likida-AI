import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';

// ═══════════════════════════════════════════════════════════════════════════
// LA FIRMA DE QUIEN CORRIGE EL REGISTRO DE JORNADA.
//
// Vive en su propio archivo, y esa es una decisión con motivo. `repo.ts` es el
// escritor del expediente y está bajo la vigilancia de
// `consultas_admin_filtran_tenant.test.ts`: cada consulta suya lleva su
// `.eq('tenant_id', ...)` a la vista. Esta función es la única del módulo que
// NO puede llevarlo —lee `app_user`, cuyo `tenant_id` es NULL para el
// superadmin y que además se resuelve por el id de la PROPIA sesión, un ancla
// MÁS ESTRECHA que la flota (el mismo precedente que /dashboard/mi-perfil).
//
// Exentar `repo.ts` entero por esta única consulta habría apagado la vigilancia
// sobre el escritor del registro de jornada. Un archivo de doce líneas cuesta
// menos que eso.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * El correo del usuario que firma una corrección, o `null` si no se pudo leer.
 *
 * EL LLAMADOR DEBE FALLAR CERRADO CON `null`. Los CHECK de la 0241
 * (`jornada_asiento_captura_firmada`, `jornada_asiento_anulacion_firmada`,
 * `jornada_dia_cierre_firmado`) exigen el correo para cualquier captura de
 * oficina, anulación o cierre, porque una corrección sin firma es exactamente
 * la edición anónima que este registro existe para impedir. Mejor no dejar
 * corregir que dejar corregir sin saber quién.
 *
 * Se guarda el correo como TEXTO y no solo el uuid porque la firma tiene que
 * sobrevivir al borrado de la cuenta: `anulado_por` es `on delete set null`, y
 * «lo corrigió alguien» no es una firma.
 */
export async function correoDelUsuario(userId: string): Promise<string | null> {
  const { data, error } = await acotada(
    supabaseAdmin().from('app_user').select('email').eq('id', userId).maybeSingle(),
    'jornada.correo_usuario',
  );
  if (error) {
    logger.error('jornada.correo_ilegible', { usuario: userId, err: error.message });
    return null;
  }
  const email = (data as { email?: string | null } | null)?.email ?? null;
  return email !== null && email.trim() !== '' ? email : null;
}
