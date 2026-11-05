import type { SupabaseClient } from '@supabase/supabase-js';
import { cabeEnTope, estadoVacio, fusionarEstado, normalizarEstado } from './estado';
import type { EventoNormalizado } from './eventos';
import type { EstadoGuia, ParcheEstadoGuia } from './tipos';

// Lectura y escritura del estado de la guía en servidor (tablas 0983/0984, solo service_role). El cliente `db` es SIEMPRE el de
// servicio y TODA consulta va acotada por (usuario, flota). Si la tabla no existe todavía (migración sin aplicar) o la base falla,
// se devuelve `no_disponible`: la guía sigue con su respaldo local y nunca se bloquea.

export type LecturaEstado = { ok: true; estado: EstadoGuia; version: number } | { ok: false; motivo: 'no_disponible' };
export type EscrituraEstado =
  | { ok: true; estado: EstadoGuia; version: number }
  | { ok: false; motivo: 'version' | 'tamano' | 'no_disponible'; actual?: { estado: EstadoGuia; version: number } };

/** Sin fila todavía: estado vacío y versión 0 (la primera escritura espera 0 y crea la fila en versión 1). */
export async function leerEstado(db: SupabaseClient, userId: string, tenantId: string): Promise<LecturaEstado> {
  try {
    const { data, error } = await db.from('onboarding_estado').select('estado, version').eq('user_id', userId).eq('tenant_id', tenantId).maybeSingle();
    if (error) return { ok: false, motivo: 'no_disponible' };
    if (!data) return { ok: true, estado: estadoVacio(), version: 0 };
    return { ok: true, estado: normalizarEstado(data.estado), version: Number(data.version) || 1 };
  } catch {
    return { ok: false, motivo: 'no_disponible' };
  }
}

/** Fusión en servidor con control optimista: si la versión no coincide devuelve `version` con lo actual para que el cliente relea y reintente una vez. */
export async function guardarEstado(
  db: SupabaseClient, userId: string, tenantId: string, parche: ParcheEstadoGuia, versionEsperada: number,
): Promise<EscrituraEstado> {
  const previo = await leerEstado(db, userId, tenantId);
  if (!previo.ok) return previo;
  if (previo.version !== versionEsperada) return { ok: false, motivo: 'version', actual: { estado: previo.estado, version: previo.version } };
  const siguiente = fusionarEstado(previo.estado, parche);
  if (!cabeEnTope(siguiente)) return { ok: false, motivo: 'tamano' };
  try {
    if (previo.version === 0) {
      const { error } = await db.from('onboarding_estado').insert({ user_id: userId, tenant_id: tenantId, estado: siguiente, version: 1 });
      if (error) {
        // Otro dispositivo creó la fila entre la lectura y la escritura: se trata como choque de versión.
        if (error.code === '23505') { const ahora = await leerEstado(db, userId, tenantId); return ahora.ok ? { ok: false, motivo: 'version', actual: { estado: ahora.estado, version: ahora.version } } : ahora; }
        return { ok: false, motivo: 'no_disponible' };
      }
      return { ok: true, estado: siguiente, version: 1 };
    }
    const { data, error } = await db.from('onboarding_estado')
      .update({ estado: siguiente, version: previo.version + 1, actualizado_en: new Date().toISOString() })
      .eq('user_id', userId).eq('tenant_id', tenantId).eq('version', previo.version).select('version');
    if (error) return { ok: false, motivo: 'no_disponible' };
    if (!data || data.length === 0) { const ahora = await leerEstado(db, userId, tenantId); return ahora.ok ? { ok: false, motivo: 'version', actual: { estado: ahora.estado, version: ahora.version } } : ahora; }
    return { ok: true, estado: siguiente, version: previo.version + 1 };
  } catch {
    return { ok: false, motivo: 'no_disponible' };
  }
}

/** Interruptor de la invitación por flota (`onboarding_tenant.invitacion`). Sin fila o con error = apagado. */
export async function invitacionEncendida(db: SupabaseClient, tenantId: string): Promise<boolean> {
  try {
    const { data, error } = await db.from('onboarding_tenant').select('invitacion').eq('tenant_id', tenantId).maybeSingle();
    return !error && data?.invitacion === true;
  } catch {
    return false;
  }
}

export interface ContextoEvento { tenantId: string; actor: string; pista: string; rol: string; perfil: string | null }

/** Inserta un lote ya normalizado. Devuelve cuántos entraron (0 si la tabla no existe o falla). */
export async function insertarEventos(db: SupabaseClient, ctx: ContextoEvento, lote: readonly EventoNormalizado[]): Promise<number> {
  if (lote.length === 0) return 0;
  try {
    const filas = lote.map((e) => ({ ...e, tenant_id: ctx.tenantId, actor: ctx.actor, pista: ctx.pista, rol: ctx.rol, perfil: ctx.perfil }));
    const { error } = await db.from('onboarding_evento').insert(filas);
    return error ? 0 : filas.length;
  } catch {
    return 0;
  }
}

/** ¿Hay al menos una fila de esta flota en `tabla` (con filtros de igualdad opcionales)? `null` = no se pudo leer (nunca se confunde con «no»). Solo lectura. */
export interface VigenciaFila {
  /** Columnas que deben ser NULL (p. ej. `revocada_en`). */
  nulas?: string[];
  /** Columna de vencimiento: NULL (no vence) o posterior a `ahora` (ISO). */
  noVencidaEn?: { columna: string; ahora: string };
}
export async function existeFilaDeTenant(db: SupabaseClient, tabla: string, tenantId: string, filtro: Record<string, string> = {}, vigencia: VigenciaFila = {}): Promise<boolean | null> {
  try {
    let q = db.from(tabla).select('tenant_id').eq('tenant_id', tenantId);
    for (const [k, v] of Object.entries(filtro)) q = q.eq(k, v);
    for (const c of vigencia.nulas ?? []) q = q.is(c, null);
    if (vigencia.noVencidaEn) q = q.or(`${vigencia.noVencidaEn.columna}.is.null,${vigencia.noVencidaEn.columna}.gt.${vigencia.noVencidaEn.ahora}`);
    // orden-no-importa: es un EXISTS (basta una fila cualquiera de la flota); el resultado es solo si hay o no hay.
    const { data, error } = await q.limit(1);
    return error ? null : (data?.length ?? 0) > 0;
  } catch {
    return null;
  }
}
