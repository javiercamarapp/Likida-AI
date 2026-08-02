import { supabaseServer } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

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
    const { data, error } = await sb.from('app_user').select('tenant_id, rol, nombre').eq('id', user.id).maybeSingle();
    // Sin este log, un bache de Supabase o una regresión de RLS es
    // INDISTINGUIBLE de "este correo nunca se dio de alta": las dos acaban con
    // `tenantId: null`, y `requireSessionTenant` manda al contralor a
    // /sin-acceso con un texto que le dice que pida su alta. El
    // comportamiento no cambia a propósito (fallar cerrado es lo correcto en
    // la puerta de autorización); lo que cambia es que ahora quede rastro.
    if (error) logger.warn('session.app_user_error', { userId: user.id, err: error.message });
    return {
      userId: user.id,
      tenantId: (data?.tenant_id as string) ?? null,
      rol: (data?.rol as string) ?? 'flota_admin',
      nombre: (data?.nombre as string) ?? null,
    };
  } catch (e) {
    // Lo que llega aquí ya no es "no hay sesión", es que el SDK tronó: red
    // caída, URL/anon key mal puestas, respuesta ilegible. El llamador solo ve
    // `null` y redirige a /login, así que este es el único sitio donde el
    // motivo puede quedar escrito.
    logger.error('session.excepcion', { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
