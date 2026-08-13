// El tenant EFECTIVO de las rutas del chat — compartido por /chat,
// /conversaciones y /conversaciones/[id] para que las tres apliquen la MISMA
// regla (dos copias de una regla de autorización se desincronizan, y el modo
// de falla es un IDOR): el tenant de la sesión; superadmin sin flota cae al
// demo; y un `?tenant=` solo lo honra un superadmin, y solo si existe.
import type { SessionTenant } from '@/lib/auth/session';
import { tenantDemo } from '@/lib/auth/tenant-demo';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';

export async function tenantEfectivoChat(
  sesion: SessionTenant,
  tenantPedido: string | null,
): Promise<{ tenantId: string; nombreFlota: string } | null> {
  let tenantId = sesion.tenantId;
  if (!tenantId) {
    if (sesion.rol !== 'superadmin') return null;
    tenantId = tenantDemo();
  }

  let nombreFlota = 'tu flota';
  if (tenantPedido && sesion.rol === 'superadmin') {
    const { data: t } = await acotada(
      supabaseAdmin().from('tenant').select('id, nombre').eq('id', tenantPedido).maybeSingle(),
      'chat.tenant');
    if (t) { tenantId = t.id as string; nombreFlota = (t.nombre as string) ?? nombreFlota; }
  } else {
    const { data: t } = await acotada(
      supabaseAdmin().from('tenant').select('nombre').eq('id', tenantId).maybeSingle(),
      'chat.tenant');
    if (t?.nombre) nombreFlota = t.nombre as string;
  }
  return { tenantId, nombreFlota };
}
