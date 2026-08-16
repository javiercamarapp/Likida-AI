// El tope diario del análisis con IA y su lectura de gasto — extraídos de
// route.ts (16-ago-2026, mismo criterio que validacion.ts: helpers fuera de
// la ruta) para que el widget de uso del sidebar del cliente lea EXACTAMENTE
// el mismo número que frena al endpoint. Dos implementaciones del mismo tope
// divergen, y el widget afirmaría un presupuesto que el freno real no mira.
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { conteo, traerTodo } from '@/lib/likida/pg';
import { ahoraMs } from '@/lib/saludo';
import { inicioDiaMxIso } from './validacion';

/** Tope diario de gasto de chat POR TENANT, en USD. Subió de 0.25 a 1.00 el
 *  12-ago-2026 cuando Javier confirmó su pricing ("a una flota le cobro
 *  mucho más"): a ~$0.005 el análisis medido, $1 son ~200 análisis/día —
 *  un contralor premium en cierre de semana no debe toparse con un muro
 *  por centavos. El techo absoluto queda en ~$30 USD/mes por tenant, ruido
 *  contra el ticket; el candado sigue atrapando bucles y curiosos. */
export function topeDiaUsd(): number {
  const v = Number(process.env.LIKIDA_CHAT_TOPE_DIA_USD);
  return Number.isFinite(v) && v > 0 ? v : 1.0;
}

/**
 * El gasto de chat de HOY (día de México) del tenant, en USD. Paginado con
 * `traerTodo` — sin él, PostgREST recorta a 1,000 filas EN SILENCIO y el
 * freno de presupuesto deja de dispararse justo el día de más uso (la
 * trampa que route.ts ya pisó). LANZA si la base no responde: el endpoint
 * falla CERRADO (no gasta más) y el widget degrada DICIENDO que no pudo
 * leer — ninguno de los dos inventa un $0.
 */
export async function gastoChatHoyUsd(tenantId: string): Promise<number> {
  const filas = await traerTodo<{ costo_usd: unknown }>(
    (d, h) => acotada(
      supabaseAdmin().from('llm_costo').select('costo_usd', conteo(d))
        .eq('tenant_id', tenantId).eq('fase', 'chat')
        .gte('created_at', inicioDiaMxIso(ahoraMs()))
        .order('id').range(d, h),
      'chat.tope_dia'),
    'chat.tope_dia',
  );
  return filas.reduce((s, f) => s + Number(f.costo_usd ?? 0), 0);
}
