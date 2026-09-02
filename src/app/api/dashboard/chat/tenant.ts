// El tenant EFECTIVO de las rutas del chat — compartido por /chat,
// /conversaciones y /conversaciones/[id] para que las tres apliquen la MISMA
// regla (dos copias de una regla de autorización se desincronizan, y el modo
// de falla es un IDOR): el tenant de la sesión; superadmin sin flota cae al
// demo; y un `?tenant=` solo lo honra un superadmin, y solo si existe.
import type { SessionTenant } from '@/lib/auth/session';
import { tenantDemo } from '@/lib/auth/tenant-demo';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { logger } from '@/lib/logger';

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
    // BE-16 (auditoría 24): `error` SE MIRA. `acotada` resuelve por valor
    // —`{data:null,error}` en un timeout—, así que sin esta rama un parpadeo
    // de Supabase era indistinguible de «ese uuid no existe»: `tenantId` se
    // quedaba en el de la sesión (la demo, para un superadmin), la respuesta
    // salía con cifras de OTRA flota bajo un encabezado que no lo desmentía, y
    // `guardarIntercambio` persistía el historial en el tenant equivocado.
    // Se devuelve `null` —el mismo fail-closed de `resolverTenantApi`— y quien
    // llama corta. Un uuid que simplemente no existe SÍ sigue cayendo al de la
    // sesión: eso es un enlace viejo, no una lectura caída.
    const { data: t, error } = await acotada(
      supabaseAdmin().from('tenant').select('id, nombre').eq('id', tenantPedido).maybeSingle(),
      'chat.tenant');
    if (error) {
      logger.error('chat.tenant_pedido_ilegible', { tenant: tenantPedido, err: error.message });
      return null;
    }
    if (t) { tenantId = t.id as string; nombreFlota = (t.nombre as string) ?? nombreFlota; }
  } else {
    const { data: t } = await acotada(
      supabaseAdmin().from('tenant').select('nombre').eq('id', tenantId).maybeSingle(),
      'chat.tenant');
    if (t?.nombre) nombreFlota = t.nombre as string;
  }
  return { tenantId, nombreFlota };
}
