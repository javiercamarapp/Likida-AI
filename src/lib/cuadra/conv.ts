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
 * Resultado de reclamar un mensaje. Son TRES estados, no dos: la diferencia entre
 * "ya lo procesamos" y "no pude averiguarlo" decide si el operador recibe
 * respuesta o se queda sin nada.
 */
export type Claim = 'nuevo' | 'duplicado' | 'indeterminado';

/**
 * Reclama un mensaje de WhatsApp de forma atómica (idempotencia).
 *
 * ANTES devolvía un booleano y trataba cualquier error de DB como "duplicado",
 * con el argumento de que "el retry de Meta lo reprocesará cuando la DB
 * responda". Ese retry NO EXISTE: `route.ts` responde 200 y hace el trabajo en
 * `after()`, así que Meta ya recibió su acuse y no reintenta nunca —lo dice el
 * propio comentario de `presupuesto.ts`—. Un blip de Supabase en el insert hacía
 * que el "listo" del operador desapareciera para siempre, con un log de nivel
 * info que además mentía llamándolo duplicado.
 *
 * Ahora el caso indeterminado se distingue y lo decide el llamador, que es quien
 * sabe si lo que está en juego es dinero o una respuesta.
 */
export async function claimMessage(waMessageId: string): Promise<Claim> {
  if (!waMessageId) return 'nuevo';
  const { error } = await supabaseAdmin()
    .from('wa_mensaje_procesado')
    .insert({ wa_message_id: waMessageId });
  if (!error) return 'nuevo';
  // 23505 = unique_violation → ya existía → duplicado de verdad (no reprocesar).
  if (error.code === '23505') return 'duplicado';
  logger.error('wa.claim_error', { code: error.code, msg: error.message });
  return 'indeterminado';
}

export async function saveConversation(convId: string, turns: ConvTurn[], viajeId: string | null): Promise<void> {
  await supabaseAdmin()
    .from('wa_conversacion')
    .update({ estado: { turns: turns.slice(-MAX_TURNS) }, viaje_id: viajeId, updated_at: new Date().toISOString() })
    .eq('id', convId);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * ¿El error dice que la función NO EXISTE? Eso es una migración sin aplicar, no
 * un tropiezo de red: reintentarlo no cambia nada.
 *
 * PGRST202 es el código de PostgREST para "no encontré esa función"; el texto se
 * revisa además por si la capa de error cambia de forma.
 */
function rpcAusente(error: { code?: string; message?: string }): boolean {
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  const m = (error.message ?? '').toLowerCase();
  return m.includes('could not find the function') || m.includes('does not exist');
}

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
  let ultimoError: { code?: string; message?: string } | null = null;
  for (;;) {
    const { data, error } = await admin.rpc('try_lock_viaje', { p_viaje: viajeId, p_ttl_ms: ttlMs });
    if (!error && data === true) return true;
    if (error) {
      ultimoError = error;
      // Se distingue el error PERMANENTE del TRANSITORIO. Antes los dos abrían
      // el mutex de inmediato, y solo uno de los dos lo merece.
      //
      // AUSENTE (la migración 0005 no está aplicada): se cae el mutex Y el
      // unique(viaje_id) juntos. Reintentar no va a hacer aparecer la función, y
      // bloquear dejaría al operador sin respuesta por un problema de
      // despliegue. Se abre — con ERROR, no warn, porque es la protección de
      // doble cierre — y el arranque ya falla ruidoso por esto
      // (ver instrumentation.ts).
      if (rpcAusente(error)) {
        logger.error('viaje.lock_rpc_ausente', { code: error.code, msg: error.message });
        return true;
      }
      // TRANSITORIO (timeout, pool agotado, 503): un error no significa que el
      // lock esté libre, significa que no se supo. Abrir de golpe deja correr
      // dos "listo" completos sobre el mismo viaje — dos ciclos de agente, dos
      // cierres. Se reintenta como si estuviera ocupado; abajo decide qué hacer
      // si la ventana se agota.
      logger.warn('viaje.lock_error_transitorio', { code: error.code, msg: error.message });
    }
    if (Date.now() - start >= maxWaitMs) {
      // Se agotó la ventana. Ocupado de verdad → false (otro lo tiene, y ese
      // otro va a responder). Fallando todo el rato → se abre para no dejar al
      // operador colgado, pero después de haberlo intentado, no al primer
      // tropiezo, y queda como ERROR.
      if (ultimoError) {
        logger.error('viaje.lock_error_persistente', { code: ultimoError.code, msg: ultimoError.message });
        return true;
      }
      return false;
    }
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
export async function esperarIntake(
  viajeId: string,
  timeoutMs?: number,
  // probe inyectable SOLO para test (default = el contador real). No cambia el
  // comportamiento en runtime; permite probar la gracia anti-carrera sin DB.
  probe: (id: string) => Promise<number> = (id) => intakeDelta(id, 0),
): Promise<boolean> {
  // Default 20s, NO 60s. El presupuesto de la función es maxDuration=60 y por
  // debajo de esta barrera todavía corren el lock (12s) y el agente (40s): con
  // 60s aquí el peor caso son 112s, y cuando revienta Meta YA recibió su 200 OK
  // y el mensaje quedó marcado como procesado. Ese "listo" se pierde sin
  // reintento y sin que nadie se entere. El env puede subirlo si el plan aguanta.
  const tope = timeoutMs ?? (Number(process.env.CUADRA_INTAKE_ESPERA_MS) || 20_000);
  // AUDIT_V3 orquestación CRÍTICO (carrera de barrera): cuando fotos y "listo"
  // llegan en el MISMO lote, corren en Promise.all; el "listo" puede leer el
  // contador ANTES de que una foto registre su +1 → ve 0 → cuadra sobre parciales.
  // GRACIA inicial: si el contador arranca en 0, se espera una ventana corta para
  // dar tiempo a que las fotos de la ráfaga incrementen antes de confiar en el 0.
  // FLAG (HARD RULE 3): default 0 = comportamiento actual EXACTO. Se recomienda
  // ~2000ms para el demo (ver DECISIONES_PENDIENTES / REPORTE_NOCHE).
  // Default 2s. Con 0 la carrera fotos+"listo" cierra sobre datos parciales, y es
  // el ÚNICO camino que no le avisa nada al operador: su liquidación sale corta.
  const grace = Number(process.env.CUADRA_INTAKE_GRACE_MS) || 2_000;
  const start = Date.now();
  if (grace > 0 && (await probe(viajeId)) <= 0) {
    await sleep(Math.min(grace, tope));
  }
  for (;;) {
    if (await probe(viajeId) <= 0) return true;
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
