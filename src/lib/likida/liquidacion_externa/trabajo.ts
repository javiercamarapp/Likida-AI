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
import { COLUMNAS, aLiquidacionExterna, aAvisoDiscrepancia, type Fila, type LiquidacionExterna, type AvisoDiscrepancia } from './repo';

/** Las que el cron tiene que mover: pendientes cuyo reintento ya toca y las que
 *  esperan al outbox. Acotado a un lote: lo demás es de la siguiente pasada.
 *  Cada fila trae su `tenant_id`, y todo lo que se haga con ella después va
 *  acotado a ESE tenant. */
export async function trabajoPendiente(limite: number, ahoraIso: string): Promise<LiquidacionExterna[]> {
  const res = await acotada(supabaseAdmin().from('liquidacion_externa')
    .select(COLUMNAS)
    .or(`estado.eq.en_cola,and(estado.eq.pendiente,proximo_intento_en.lte.${ahoraIso})`)
    .order('proximo_intento_en', { ascending: true }).order('id').limit(limite), 'liqext.trabajo');
  return ((exigir(res, 'liqext.trabajo') ?? []) as unknown as Fila[]).map(aLiquidacionExterna);
}

/** Los avisos de discrepancia que el cron tiene que mover (0643): pendientes cuyo reintento ya toca y los que quedaron
 *  `enviando` con el arriendo vencido (el proceso que los mandaba murió). Acotado a un lote. Sin la tabla (base sin 0643): nada. */
export async function avisosPendientes(limite: number, ahoraIso: string): Promise<AvisoDiscrepancia[]> {
  const res = await acotada(supabaseAdmin().from('liquidacion_aviso_discrepancia')
    .select('liquidacion_externa_id, tenant_id, ciclo, estado, intentos, proximo_intento_en, ultimo_error, telefonos_aceptados, tarea_id, enviado_en')
    .or(`and(estado.eq.pendiente,proximo_intento_en.lte.${ahoraIso}),and(estado.eq.enviando,claim_expira_en.lte.${ahoraIso})`)
    .order('proximo_intento_en', { ascending: true }).order('liquidacion_externa_id').order('ciclo').limit(limite), 'liqext.avisos_trabajo');
  if (res.error) {
    if (res.error.code === '42P01' || res.error.code === 'PGRST205' || /does not exist|schema cache/i.test(res.error.message ?? '')) return [];
    throw new Error(`liqext.avisos_trabajo: ${res.error.message}`);
  }
  return ((res.data ?? []) as unknown as Array<Record<string, unknown>>).map(aAvisoDiscrepancia);
}
