// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN EXTERNA — la lista de trabajo del cron.
//
// Vive aparte de `repo.ts` por una razón concreta: es la ÚNICA consulta de este
// módulo que cruza flotas, a propósito. El cron barre a todas en una pasada
// (igual que `wa-outbox`), y la prueba de aislamiento
// (`consultas_admin_filtran_tenant.test.ts`) exige que un archivo que cruza
// tenants lo declare. Mantenerla en su propio archivo permite exentar SOLO a
// esta consulta, y que `repo.ts` —que atiende a una flota por llamada— siga
// vigilado entero.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { exigir } from '../pg';
import { COLUMNAS, aLiquidacionExterna, type Fila, type LiquidacionExterna } from './repo';

/** Las que el cron tiene que mover: pendientes cuyo reintento ya toca y las que
 *  esperan al outbox. Acotado a un lote: lo demás es de la siguiente pasada.
 *  Cada fila trae su `tenant_id`, y todo lo que se haga con ella después va
 *  acotado a ESE tenant. */
export async function trabajoPendiente(limite: number, ahoraIso: string): Promise<LiquidacionExterna[]> {
  const res = await acotada(supabaseAdmin().from('liquidacion_externa')
    .select(COLUMNAS)
    .or(`estado.eq.en_cola,and(estado.eq.pendiente,proximo_intento_en.lte.${ahoraIso})`)
    .order('proximo_intento_en', { ascending: true }).limit(limite), 'liqext.trabajo');
  return ((exigir(res, 'liqext.trabajo') ?? []) as unknown as Fila[]).map(aLiquidacionExterna);
}
