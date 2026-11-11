// ═══════════════════════════════════════════════════════════════════════════
// LA CONSECUENCIA DE UN SLA VENCIDO, A LA VISTA (F7).
//
// El aviso de SLA vencido (`avisarSlaVencido`, lib/likida/soporte-avisos.ts) deja su dedup en `bitacora_auditoria` SOLO si salió por
// algún canal. Leer esa fila dice la verdad completa: «avisado el X» (salió) o «sin aviso» (no salió, o aún no le toca al barrido).
// Nunca se infiere un aviso que no consta.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { logger } from '@/lib/logger';
import { ACCIONES_AVISO } from '@/lib/likida/soporte-avisos';

/** Por ticket, cuándo se avisó del SLA vencido. `null` = no se pudo leer (la pantalla dice «sin dato», no «sin aviso»). */
export async function avisosDeSlaPorTicket(ticketIds: readonly string[]): Promise<Map<string, string> | null> {
  if (ticketIds.length === 0) return new Map();
  try {
    const { data, error } = await acotada(
      supabaseAdmin().from('bitacora_auditoria').select('entidad_id, ocurrio_en')
        .eq('accion', ACCIONES_AVISO.sla).in('entidad_id', [...ticketIds].slice(0, 200)).order('ocurrio_en', { ascending: false }).order('id', { ascending: false }).limit(500),
      'soporteEscalado.avisos',
    );
    if (error) { logger.warn('admin.soporte.escalado_ilegible', { err: error.message }); return null; }
    const mapa = new Map<string, string>();
    for (const f of (data ?? []) as Array<{ entidad_id: string | null; ocurrio_en: string }>) {
      // Viene del más reciente al más viejo: el primero que se ve por ticket es el último aviso.
      if (f.entidad_id && !mapa.has(f.entidad_id)) mapa.set(f.entidad_id, f.ocurrio_en);
    }
    return mapa;
  } catch (e) {
    logger.warn('admin.soporte.escalado_ilegible', { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
