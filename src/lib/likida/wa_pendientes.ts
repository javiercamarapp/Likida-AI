// ═══════════════════════════════════════════════════════════════════════════
// LA BANDEJA DURABLE DEL WEBHOOK (`wa_evento_pendiente`, 0119).
//
// P1 de la auditoría externa (16-ago-2026): el webhook acusa 200 y DESPUÉS
// mira el kill switch — apagado, el mensaje se tiraba, y Meta no reintenta
// lo acusado. Este módulo convierte "apagado" en "pausado y durable":
//
//   webhook (apagado) → guardarEventosPendientes → 200 honesto
//   cron wa-pendientes (encendido) → reclamar → processInbound → marcar
//
// EL CLAIM ES UN UPDATE ANCLADO (patrón reclamarEscalacion): dos corridas
// del cron solapadas no procesan el mismo evento dos veces — y aunque lo
// hicieran, `claimMessage` (0002) aguas abajo deduplica por wamid. El
// intento se anota EN el claim: un evento que revienta el proceso ya quedó
// contado, y al tope se vuelve carta muerta visible, jamás borrada.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import type { InboundMessage } from './processor';

/** Al tope de intentos la fila deja de reclamarse: carta muerta VISIBLE con
 *  su ultimo_error. 5 corridas del cron son ~25 min de reintentos. */
export const MAX_INTENTOS_PENDIENTE = 5;

/**
 * Persiste los mensajes de una invocación ANTES del acuse a Meta. NUNCA
 * lanza: el llamador decide (503 si algo no se guardó, para que Meta
 * reentregue). Un insert fallido ES pérdida potencial y por eso se GRITA con
 * los ids completos: el log es lo único que queda para reconstruir a mano.
 *
 * UN SOLO VIAJE DE RED, con techo (auditoría 18, M22 + A23): esto corre en la
 * ruta SÍNCRONA, antes del 200. Antes era un insert por mensaje, en serie y
 * sin `acotada`: 22 fotos = 22 viajes (6.6s) antes de contestarle a Meta, y
 * uno colgado sin techo se llevaba la invocación entera. Ahora es un upsert
 * del lote con `ignoreDuplicates` (ON CONFLICT DO NOTHING sobre la PK = wamid:
 * la reentrega de Meta no es pérdida, es el dedup haciendo su trabajo) y el
 * tope de `TOPE_CONSULTA_MS`. Si el lote falla, fallan todos — y el webhook
 * contesta 503 para que Meta reentregue el POST completo.
 */
export async function guardarEventosPendientes(mensajes: InboundMessage[]): Promise<{
  guardados: number;
  fallidos: number;
  /** Cada mensaje con el id de SU fila durable (o `guardado: false`) — el
   *  inbox general (16-ago-2026) procesa reclamando por este id. */
  filas: Array<{ id: string; evento: InboundMessage; guardado: boolean }>;
}> {
  if (mensajes.length === 0) return { guardados: 0, fallidos: 0, filas: [] };
  // Sin wamid (no debería pasar en mensajes reales) se fabrica un id
  // determinista-ish para no perder el evento por falta de llave.
  const lote = mensajes.map((m, i) => ({ id: m.waMessageId ?? `sin-wamid:${m.from}:${Date.now()}:${i}`, evento: m }));
  try {
    const { error } = await acotada(supabaseAdmin()
      .from('wa_evento_pendiente')
      .upsert(lote, { onConflict: 'id', ignoreDuplicates: true }), 'guardarEventosPendientes');
    if (error) {
      logger.error('wa.pendiente_no_guardado', { ids: lote.map((f) => f.id), err: error.message });
      return { guardados: 0, fallidos: lote.length, filas: lote.map((f) => ({ ...f, guardado: false })) };
    }
    return { guardados: lote.length, fallidos: 0, filas: lote.map((f) => ({ ...f, guardado: true })) };
  } catch (e) {
    logger.error('wa.pendiente_no_guardado', { ids: lote.map((f) => f.id), err: e instanceof Error ? e.message : String(e) });
    return { guardados: 0, fallidos: lote.length, filas: lote.map((f) => ({ ...f, guardado: false })) };
  }
}

export interface PendienteReclamado {
  id: string;
  evento: InboundMessage;
  intentos: number;
}

/**
 * Los pendientes listos para drenar, en orden de llegada. LANZA ante error
 * de lectura: el cron debe reportar 500, no "no había nada".
 */
export async function pendientesPorDrenar(limite = 10): Promise<Array<{ id: string; intentos: number }>> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('wa_evento_pendiente')
    .select('id, intentos')
    .is('procesado_en', null)
    .lt('intentos', MAX_INTENTOS_PENDIENTE)
    .order('recibido_en', { ascending: true })
    .limit(limite), 'pendientesPorDrenar');
  if (error) throw new Error(`pendientesPorDrenar: ${error.message}`);
  return ((data ?? []) as Array<{ id: string; intentos: number }>).map((f) => ({ id: String(f.id), intentos: Number(f.intentos) }));
}

/**
 * Reclama UN evento para esta corrida: anota el intento y devuelve el
 * evento SOLO si esta llamada ganó (cero filas = otra corrida lo tomó o ya
 * se procesó — no es error). El intento viaja EN el claim: si el proceso
 * revienta a media corrida, el conteo ya quedó.
 */
export async function reclamarPendiente(id: string, intentosLeidos: number): Promise<PendienteReclamado | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('wa_evento_pendiente')
    .update({ intentos: intentosLeidos + 1 })
    .eq('id', id)
    .eq('intentos', intentosLeidos)
    .is('procesado_en', null)
    .select('id, evento, intentos'), 'reclamarPendiente');
  if (error) throw new Error(`reclamarPendiente: ${error.message}`);
  const fila = (data ?? [])[0] as { id: string; evento: InboundMessage; intentos: number } | undefined;
  return fila ? { id: String(fila.id), evento: fila.evento, intentos: Number(fila.intentos) } : null;
}

/** Sella el evento como procesado. Best-effort CON GRITO: el mensaje ya se
 *  procesó — si el sello falla, el reintento del cron rebotará aguas abajo
 *  en claimMessage (0002), no duplicará gastos. */
export async function marcarPendienteProcesado(id: string): Promise<void> {
  const { error } = await acotada(supabaseAdmin()
    .from('wa_evento_pendiente')
    .update({ procesado_en: new Date().toISOString(), ultimo_error: null })
    .eq('id', id), 'marcarPendienteProcesado');
  if (error) logger.error('wa.pendiente_sin_sellar', { id, err: error.message });
}

/** Anota el fallo del intento (la fila sigue pendiente hasta el tope). */
export async function anotarFalloPendiente(id: string, err: string): Promise<void> {
  const { error } = await acotada(supabaseAdmin()
    .from('wa_evento_pendiente')
    .update({ ultimo_error: err.slice(0, 500) })
    .eq('id', id), 'anotarFalloPendiente');
  if (error) logger.warn('wa.pendiente_fallo_sin_anotar', { id, err: error.message });
}

/** Cuántas cartas muertas hay (al tope de intentos, sin procesar) — para la
 *  bandeja de escalaciones y el reporte del cron. LANZA ante error. */
export async function cartasMuertas(): Promise<number> {
  const { count, error } = await acotada(supabaseAdmin()
    .from('wa_evento_pendiente')
    .select('id', { count: 'exact', head: true })
    .is('procesado_en', null)
    .gte('intentos', MAX_INTENTOS_PENDIENTE), 'cartasMuertas');
  if (error) throw new Error(`cartasMuertas: ${error.message}`);
  if (typeof count !== 'number') throw new Error('cartasMuertas: la base no devolvió el conteo');
  return count;
}
