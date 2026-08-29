import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';

export interface SalidaOutbox {
  id: string;
  payload: Record<string, unknown>;
  intentos: number;
  leaseToken: string;
}

/**
 * AUDITORÍA 20 (R-1, CRÍTICO): este lease vivía en 120s mientras
 * `wa-outbox/route.ts` mide 155.5s reales y puede correr hasta los 300s de
 * su `maxDuration` — el TECHO que Vercel permite, no el promedio de hoy. Con
 * lease < techo, el cron que corre cada minuto (`vercel.json`) reclamaba las
 * mismas filas mientras la corrida anterior seguía viva y las reenviaba a un
 * teléfono real, hasta 8 veces (tope de reintentos, 0180).
 *
 * El lease tiene que sobrevivir al PEOR CASO POSIBLE (el `maxDuration` de la
 * ruta), no a la medición de hoy — el promedio ya creció una vez (60s→155.5s)
 * y puede volver a crecer. Mismo margen (1.5×) que ya usa `WA_LEASE_SECONDS`
 * en `wa_pendientes.ts` frente a su propio `maxDuration` (180 vs 120).
 * `wa_outbox.test.ts` fija este invariante contra el `maxDuration` real leído
 * de `route.ts` — si alguien baja este número, o vuelve a subir el de la
 * ruta sin ajustar este, la prueba se pone roja.
 */
export const WA_OUTBOX_LEASE_SECONDS = 450; // 1.5 × maxDuration (300) de wa-outbox/route.ts

/** Guarda una salida que Meta no aceptó por un error transitorio. Nunca lanza:
 * el caller ya devolvió su resultado normal; fallar al respaldo solo se grita. */
export async function encolarSalidaWhatsApp(payload: Record<string, unknown>, motivo: string): Promise<void> {
  try {
    const { error } = await acotada(supabaseAdmin().from('wa_outbox').insert({
      payload, ultimo_error: motivo.slice(0, 500),
    }), 'wa.outbox.encolar');
    if (error) logger.error('wa.outbox_no_encolado', { err: error.message });
  } catch (e) {
    logger.error('wa.outbox_no_encolado', { err: e instanceof Error ? e.message : String(e) });
  }
}

export async function reclamarSalidasWhatsApp(limite = 25): Promise<SalidaOutbox[]> {
  const { data, error } = await acotada(supabaseAdmin().rpc('reclamar_wa_outbox', {
    p_limite: limite, p_lease_seconds: WA_OUTBOX_LEASE_SECONDS,
  }), 'wa.outbox.reclamar');
  if (error) throw new Error(`reclamarSalidasWhatsApp: ${error.message}`);
  return ((data ?? []) as Array<{ id: string; payload: Record<string, unknown>; intentos: number; lease_token: string }>).map((f) => ({
    id: String(f.id), payload: f.payload, intentos: Number(f.intentos), leaseToken: String(f.lease_token),
  }));
}

/**
 * `muerta: true` cuando esta salida agotó sus 8 reintentos (0180) y quedó en
 * `estado='dead'` — nadie la va a volver a intentar. AUDITORÍA 19 (OP-19c2-3):
 * antes de la 0189 esto no se podía saber desde la app (la RPC devolvía solo
 * `boolean`), así que un mensaje que muere aquí se perdía en silencio: el cron
 * seguía en verde porque procesó la fila con éxito, solo que el resultado fue
 * enterrarla. El llamador (`route.ts`) es quien decide avisar.
 */
export async function finalizarSalidaWhatsApp(s: SalidaOutbox, messageId?: string, error?: string): Promise<{ muerta: boolean }> {
  const { data, error: err } = await acotada(supabaseAdmin().rpc('finalizar_wa_outbox', {
    p_id: s.id, p_token: s.leaseToken, p_message_id: messageId ?? null, p_error: error ?? null,
  }), 'wa.outbox.finalizar');
  const fila = (data as Array<{ ok: boolean; muerta: boolean }> | null)?.[0];
  if (err || !fila?.ok) {
    logger.error('wa.outbox_no_finalizado', { id: s.id, err: err?.message ?? 'claim perdido' });
    return { muerta: false };
  }
  return { muerta: fila.muerta === true };
}
