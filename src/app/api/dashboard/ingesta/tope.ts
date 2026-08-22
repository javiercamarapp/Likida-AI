// El tope diario de la SONDA de ingesta y su lectura de gasto — mismo patrón
// que `../chat/tope.ts` (AUDITORÍA 18, A6/A25).
//
// La sonda corre una completion de VISIÓN por petición y hasta hoy no tenía
// ni freno ni fila de costo: un bucle de UI o una sesión robada podían agotar
// el saldo de OpenRouter —que tumba el OCR de WhatsApp, el minuto 2 del demo—
// y el tablero de costo de IA seguía enseñando la cifra de siempre. Ahora la
// ruta registra en `llm_costo` con `fase: 'ocr'` y `viaje_id: null` (lo que
// la distingue del OCR real de WhatsApp, que siempre lleva viaje) y frena
// contra ESE mismo número.
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { conteo, traerTodo } from '@/lib/likida/pg';
import { ahoraMs } from '@/lib/saludo';
import { inicioDiaMxIso } from '../chat/validacion';

/** Tope diario POR TENANT de la sonda, en USD. A ~$0.01 por lectura de
 *  visión, $1 son ~100 sondas/día: de sobra para probar el motor, y un
 *  bucle se topa en minutos. Ajustable por env sin deploy. */
export function topeSondaDiaUsd(): number {
  const v = Number(process.env.LIKIDA_INGESTA_TOPE_DIA_USD);
  return Number.isFinite(v) && v > 0 ? v : 1.0;
}

/** Peticiones por minuto por USUARIO a la sonda. Un humano probando
 *  comprobantes no pasa de un puñado; 500 fetch desde la consola sí. */
export const SONDAS_POR_MINUTO = 10;

/**
 * El gasto de la sonda de HOY (día de México) del tenant, en USD. LANZA si la
 * base no responde: la ruta falla CERRADO (no gasta más) en vez de inventar
 * un $0 — mismo contrato que `gastoChatHoyUsd`.
 */
export async function gastoSondaHoyUsd(tenantId: string): Promise<number> {
  const filas = await traerTodo<{ costo_usd: unknown }>(
    (d, h) => acotada(
      supabaseAdmin().from('llm_costo').select('costo_usd', conteo(d))
        .eq('tenant_id', tenantId).eq('fase', 'ocr').is('viaje_id', null)
        .gte('created_at', inicioDiaMxIso(ahoraMs()))
        .order('id').range(d, h),
      'ingesta.tope_dia'),
    'ingesta.tope_dia',
  );
  return filas.reduce((s, f) => s + Number(f.costo_usd ?? 0), 0);
}
