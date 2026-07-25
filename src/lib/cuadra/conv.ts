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
