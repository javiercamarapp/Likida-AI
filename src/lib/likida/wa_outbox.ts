import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';

export interface SalidaOutbox {
  id: string;
  payload: Record<string, unknown>;
  intentos: number;
  leaseToken: string;
}

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
    p_limite: limite, p_lease_seconds: 120,
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
