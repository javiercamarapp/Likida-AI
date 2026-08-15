// ═══════════════════════════════════════════════════════════════════════════
// EL PRIMER LECTOR DE `bitacora_auditoria` (0053).
//
// La auditoría del 14-ago encontró la asimetría: SIETE escritores (altas,
// políticas, buzones, llaves API, credenciales, carta porte, facturación) y
// CERO lectores — un registro de auditoría que nadie puede abrir no audita
// nada, solo ocupa disco con la conciencia tranquila. Este módulo es la
// lectura: las últimas N entradas CRUZANDO todos los tenants, para la sección
// "Bitácora" de /admin/observabilidad.
//
// Vive en lib/admin (el barrio con permiso de cruzar tenants, ver negocio.ts
// y soporte.ts) y no en lib/likida: mezclar lecturas con y sin filtro de
// tenant en un mismo archivo es como se copia un patrón de superadmin a una
// consulta de cliente.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';

export interface EntradaBitacora {
  id: number;
  /** `null` cuando la acción es de plataforma (p. ej. un interruptor). */
  tenantId: string | null;
  tenantNombre: string | null;
  /** Quién: el nombre de la cuenta, su correo, o null si la acción no llevó
   *  actor (escritores viejos sin firma — se pinta "sistema", no se inventa). */
  actor: string | null;
  accion: string;
  entidad: string | null;
  entidadId: string | null;
  detalle: Record<string, unknown> | null;
  ocurrioEn: string;
}

/**
 * Las últimas `limite` entradas, cross-tenant, lo más reciente primero.
 *
 * `filtroAccion` filtra por substring de `accion` (p. ej. "interruptor" o
 * "flota.creada"). Se sanea a [a-z0-9._:-] ANTES de armar el ilike: `%` y `_`
 * son comodines de LIKE y un filtro con ellos consultaría otra cosa de la
 * que la pantalla dice.
 *
 * LANZA ante un error de lectura: una bitácora que pinta "sin entradas" sobre
 * una base caída afirmaría que nadie ha tocado nada — la mentira exacta que
 * un registro de auditoría existe para desmentir. Es una ventana (las últimas
 * N), no un export: se dice en la pantalla, y por eso no pagina con traerTodo.
 */
export async function ultimasEntradasBitacora(
  opts: { limite?: number; filtroAccion?: string } = {},
): Promise<EntradaBitacora[]> {
  const limite = opts.limite ?? 50;
  const filtro = (opts.filtroAccion ?? '').toLowerCase().replace(/[^a-z0-9._:-]/g, '');

  const base = supabaseAdmin()
    .from('bitacora_auditoria')
    .select('id, tenant_id, actor_id, actor_email, accion, entidad, entidad_id, detalle, ocurrio_en, tenant:tenant_id(nombre), actor:actor_id(nombre, email)');
  // El filtro ANTES de order/limit: sobre el builder ya transformado el
  // `.ilike` no existe (y filtrar las 50 recortadas mentiría sobre el resto).
  const { data, error } = await (filtro ? base.ilike('accion', `%${filtro}%`) : base)
    .order('ocurrio_en', { ascending: false })
    .limit(limite);
  if (error) throw new Error(`ultimasEntradasBitacora: ${error.message}`);

  return ((data ?? []) as Array<Record<string, unknown>>).map((f): EntradaBitacora => {
    const actorJoin = f.actor as { nombre?: string | null; email?: string | null } | null;
    return {
      id: Number(f.id),
      tenantId: (f.tenant_id as string | null) ?? null,
      // El join sin nombre se pinta null y la pantalla dice "plataforma" o
      // '—' — visible, no inventado (criterio de soporte.ts).
      tenantNombre: ((f.tenant as { nombre?: string } | null)?.nombre) ?? null,
      actor: actorJoin?.nombre ?? actorJoin?.email ?? (f.actor_email as string | null) ?? null,
      accion: String(f.accion),
      entidad: (f.entidad as string | null) ?? null,
      entidadId: (f.entidad_id as string | null) ?? null,
      detalle: (f.detalle as Record<string, unknown> | null) ?? null,
      ocurrioEn: String(f.ocurrio_en),
    };
  });
}
