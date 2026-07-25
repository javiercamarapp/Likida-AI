// Resolución de operador por teléfono + estado de conversación WhatsApp.
// El estado (últimos turnos + viaje activo) vive en wa_conversacion.estado jsonb.

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import type { TenantContext } from '@/lib/agents/types';

export interface ResolvedOperador {
  tenantId: string;
  operadorId: string;
  nombre: string;
  telefono: string;
}

export interface ConvTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Resuelve el operador (y su flota) por número de WhatsApp. */
export async function resolveOperador(telefono: string): Promise<ResolvedOperador | null> {
  const { data, error } = await supabaseAdmin()
    .from('operador')
    .select('id, tenant_id, nombre, telefono')
    .eq('telefono', telefono)
    .eq('activo', true)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return { tenantId: data.tenant_id as string, operadorId: data.id as string, nombre: data.nombre as string, telefono: data.telefono as string };
}

/** Viaje abierto del operador (el que se está liquidando). */
export async function getOpenViaje(tenantId: string, operadorId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('viaje')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('operador_id', operadorId)
    .in('estatus', ['abierto', 'en_cuadre'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.id as string;
}

export async function getTenantContext(tenantId: string): Promise<TenantContext> {
  const { data } = await supabaseAdmin().from('tenant').select('nombre').eq('id', tenantId).maybeSingle();
  return {
    tenantId,
    nombreFlota: (data?.nombre as string) || 'la flota',
    agentName: 'Cuadra',
    timezone: 'America/Mexico_City',
  };
}

const MAX_TURNS = 12;

export async function loadConversation(tenantId: string, telefono: string, viajeId: string | null): Promise<{ id: string; turns: ConvTurn[] }> {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from('wa_conversacion')
    .select('id, estado')
    .eq('tenant_id', tenantId)
    .eq('telefono', telefono)
    .maybeSingle();
  if (data) {
    const estado = (data.estado as { turns?: ConvTurn[] }) || {};
    return { id: data.id as string, turns: (estado.turns ?? []).slice(-MAX_TURNS) };
  }
  const { data: created } = await admin
    .from('wa_conversacion')
    .insert({ tenant_id: tenantId, telefono, viaje_id: viajeId, estado: { turns: [] } })
    .select('id')
    .single();
  return { id: (created?.id as string) ?? '', turns: [] };
}

/**
 * Reclama un mensaje de WhatsApp de forma atómica (idempotencia).
 * Devuelve true si es NUEVO (procesar), false si ya se procesó (duplicado/retry).
 */
export async function claimMessage(waMessageId: string): Promise<boolean> {
  if (!waMessageId) return true;
  const { error } = await supabaseAdmin()
    .from('wa_mensaje_procesado')
    .insert({ wa_message_id: waMessageId });
  if (!error) return true;
  // 23505 = unique_violation → ya existía → duplicado (no reprocesar).
  if (error.code === '23505') return false;
  // AL-3: fail-CLOSED. Ante cualquier otro error de DB (timeout, conexión) NO
  // asumimos "nuevo" — eso bypassa la idempotencia y puede duplicar el gasto si
  // Meta reintenta. Tratamos como ya-reclamado; el retry de Meta lo reprocesará
  // cuando la DB responda. Con dinero, preferir no-duplicar sobre no-perder.
  logger.warn('wa.claim_error', { code: error.code, msg: error.message });
  return false;
}

export async function saveConversation(convId: string, turns: ConvTurn[], viajeId: string | null): Promise<void> {
  await supabaseAdmin()
    .from('wa_conversacion')
    .update({ estado: { turns: turns.slice(-MAX_TURNS) }, viaje_id: viajeId, updated_at: new Date().toISOString() })
    .eq('id', convId);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Mutex por viaje (AL-1/CR-1): serializa el procesamiento de mensajes del mismo
 * viaje para que un "listo" no cierre la liquidación antes de que el OCR de la
 * última foto haya guardado su gasto. Reintenta con backoff hasta maxWaitMs;
 * devuelve false si no logró el lease (otro after() lo tiene vigente).
 */
export async function acquireViajeLock(viajeId: string, opts?: { ttlMs?: number; maxWaitMs?: number }): Promise<boolean> {
  const ttlMs = opts?.ttlMs ?? 60_000;
  const maxWaitMs = opts?.maxWaitMs ?? 12_000;
  const admin = supabaseAdmin();
  const start = Date.now();
  let delay = 150;
  for (;;) {
    const { data, error } = await admin.rpc('try_lock_viaje', { p_viaje: viajeId, p_ttl_ms: ttlMs });
    if (!error && data === true) return true;
    if (error) {
      // 2.1: RPC ausente/caído = la migración 0005 no está aplicada → se cae el
      // mutex Y el unique(viaje_id) juntos. Es GRAVE (protección de doble cierre):
      // logger.ERROR, no warn. Se procede (la idempotencia de DB, si existe, cubre),
      // pero el arranque debe fallar ruidoso si 0005 falta (ver instrumentation.ts).
      logger.error('viaje.lock_error', { code: error.code, msg: error.message });
      return true;
    }
    if (Date.now() - start >= maxWaitMs) return false;
    await sleep(delay);
    delay = Math.min(delay * 2, 1500);
  }
}

/**
 * Barrera de ráfaga (contador de OCR en vuelo). Incremento/decremento atómico;
 * devuelve el nuevo contador. Las fotos hacen +1 al entrar y -1 al terminar.
 */
export async function intakeDelta(viajeId: string, delta: number): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc('intake_delta', { p_viaje: viajeId, p_delta: delta });
  if (error) { logger.warn('intake.delta', { code: error.code, msg: error.message }); return 0; }
  return typeof data === 'number' ? data : 0;
}

/**
 * Espera a que NO haya OCR de fotos en vuelo para el viaje (contador = 0). Es la
 * barrera que garantiza que el "listo" cuadre sobre TODOS los gastos, no parciales.
 * NUNCA espera indefinido: tope configurable (env CUADRA_INTAKE_ESPERA_MS, default
 * 60s). Devuelve true si se vació, false si venció el tope (→ el caller avisa al
 * operador y cuadra con lo que alcanzó). El decremento vive en el `finally` del
 * intake, así que un OCR que truena igual libera su +1.
 */
export async function esperarIntake(viajeId: string, timeoutMs?: number): Promise<boolean> {
  const tope = timeoutMs ?? (Number(process.env.CUADRA_INTAKE_ESPERA_MS) || 60_000);
  // AUDIT_V3 orquestación CRÍTICO (carrera de barrera): cuando fotos y "listo"
  // llegan en el MISMO lote, corren en Promise.all; el "listo" puede leer el
  // contador ANTES de que una foto registre su +1 → ve 0 → cuadra sobre parciales.
  // GRACIA inicial: si el contador arranca en 0, se espera una ventana corta para
  // dar tiempo a que las fotos de la ráfaga incrementen antes de confiar en el 0.
  // FLAG (HARD RULE 3): default 0 = comportamiento actual EXACTO. Se recomienda
  // ~2000ms para el demo (ver DECISIONES_PENDIENTES / REPORTE_NOCHE).
  const grace = Number(process.env.CUADRA_INTAKE_GRACE_MS) || 0;
  const start = Date.now();
  if (grace > 0 && (await intakeDelta(viajeId, 0)) <= 0) {
    await sleep(Math.min(grace, tope));
  }
  for (;;) {
    if (await intakeDelta(viajeId, 0) <= 0) return true;
    if (Date.now() - start >= tope) return false;
    await sleep(500);
  }
}

/** Libera el mutex del viaje (best-effort; si falla, expira por TTL). */
export async function releaseViajeLock(viajeId: string): Promise<void> {
  try {
    await supabaseAdmin().rpc('unlock_viaje', { p_viaje: viajeId });
  } catch (e) {
    logger.warn('viaje.unlock', { err: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Libera el claim de idempotencia de un mensaje (CR-2): si el procesamiento
 * crashea, se borra la marca para que el retry de Meta lo reprocese (at-least-once).
 */
export async function releaseMessageClaim(waMessageId: string): Promise<void> {
  if (!waMessageId) return;
  try {
    await supabaseAdmin().from('wa_mensaje_procesado').delete().eq('wa_message_id', waMessageId);
  } catch (e) {
    logger.warn('wa.release_claim', { err: e instanceof Error ? e.message : String(e) });
  }
}
