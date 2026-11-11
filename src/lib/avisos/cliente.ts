import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * El cliente con el que se leen y escriben los avisos por persona (mig. 1002). Las tablas `aviso_*` no dan privilegios a anon ni a authenticated
 * (regla de la 0947/0949), así que SOLO el servidor con service_role las toca. Eso exige que quien llame ya haya resuelto la persona y el ámbito
 * de la SESIÓN (requireSuperadmin / resolverTenantEfectivo) y filtre por ellos; nada que venga del navegador decide a quién se lee o escribe.
 */
export function clienteAvisos(): SupabaseClient {
  return supabaseAdmin();
}
