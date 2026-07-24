import { supabaseServer } from '@/lib/supabase/server';

export interface SessionTenant {
  userId: string;
  tenantId: string | null;
  rol: string;
  nombre: string | null;
}

/** Devuelve el tenant del usuario autenticado, o null si no hay sesión/config. */
export async function getSessionTenant(): Promise<SessionTenant | null> {
  try {
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data } = await sb.from('app_user').select('tenant_id, rol, nombre').eq('id', user.id).maybeSingle();
    return {
      userId: user.id,
      tenantId: (data?.tenant_id as string) ?? null,
      rol: (data?.rol as string) ?? 'flota_admin',
      nombre: (data?.nombre as string) ?? null,
    };
  } catch {
    return null;
  }
}
