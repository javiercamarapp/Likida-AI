import { acotada } from '@/lib/likida/presupuesto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

/** Los dos estatus que cuentan como «en curso» (`viaje_estatus_dominio`). UNA sola definición para Mapa y En vivo: un mismo rótulo da la
 *  misma cifra en todas las pantallas de Viajes. */
export const ESTATUS_EN_CURSO = ['abierto', 'en_cuadre'];

/** Cuántos viajes en curso hay DE VERDAD (`count exact, head`). `null` = no se pudo contar, y entonces la pantalla no afirma ningún total. */
export async function contarViajesEnCurso(tenantId: string, etiqueta = 'viajes.contarEnCurso'): Promise<number | null> {
  try {
    const { count, error } = await acotada(supabaseAdmin()
      .from('viaje')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('estatus', ESTATUS_EN_CURSO), etiqueta);
    if (error) {
      logger.warn(etiqueta, { tenantId, err: error.message });
      return null;
    }
    return count ?? null;
  } catch (e) {
    logger.warn(etiqueta, { tenantId, err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
