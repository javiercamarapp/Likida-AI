import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '@/lib/likida/presupuesto';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { conectorDePortal } from '../conectores/portales_facturacion';
import { guardarSesionPortal } from '../facturacion/sesion_portal';
import { anotarVinculo } from '../facturacion/vinculo_portal';
import type { DepsVinculacion, RepoVinculacion, SalidasVinculacion, SolicitudVinculacion, EstadoSolicitud } from './vinculacion_remota';

// La implementación real de los puertos de `vinculacion_remota.ts` sobre Supabase (0540).
// Toda transición va por las RPC atómicas de la migración; aquí solo se llama y se traduce.

const ESTADOS: EstadoSolicitud[] = ['pendiente', 'reclamada', 'completada', 'fallida', 'expirada', 'cancelada'];

interface RespuestaRpc { ok?: boolean; motivo?: string; id?: string; tenant_id?: string; comercio?: string; expira_en?: string }

export const repoVinculacion: RepoVinculacion = {
  async crear(a) {
    const { data, error } = await acotada(supabaseAdmin().rpc('crear_vinculacion_portal', {
      p_tenant: a.tenantId, p_comercio: a.comercio, p_user: a.userId, p_hash: a.hash, p_ttl_min: a.ttlMin,
    }), 'vinculacion.crear');
    if (error) { logger.error('vinculacion.crear_fallo', { err: error.message }); return { ok: false, motivo: 'No se pudo crear la solicitud. Intenta de nuevo.' }; }
    const r = (data ?? {}) as RespuestaRpc;
    return r.ok === true && r.id ? { ok: true, id: r.id } : { ok: false, motivo: r.motivo ?? 'La base no explicó el rechazo.' };
  },

  async reclamar(hash) {
    const { data, error } = await acotada(supabaseAdmin().rpc('reclamar_vinculacion_portal', { p_hash: hash }), 'vinculacion.reclamar');
    if (error) { logger.error('vinculacion.reclamar_fallo', { err: error.message }); return { ok: false, motivo: 'El servidor no pudo procesar el código. Intenta de nuevo.' }; }
    const r = (data ?? {}) as RespuestaRpc;
    if (r.ok === true && r.id && r.tenant_id && r.comercio && r.expira_en) {
      return { ok: true, id: r.id, tenantId: r.tenant_id, comercio: r.comercio, expiraEn: r.expira_en };
    }
    return { ok: false, motivo: r.motivo ?? 'Código inválido.' };
  },

  async reclamadaPorHash(hash) {
    const { data, error } = await acotada(supabaseAdmin().from('portal_vinculacion_solicitud')
      .select('id, tenant_id, comercio, expira_en')
      .eq('codigo_hash', hash).eq('estado', 'reclamada').maybeSingle(), 'vinculacion.por_hash');
    if (error || !data) return null;
    const f = data as { id: string; tenant_id: string; comercio: string; expira_en: string };
    return { id: f.id, tenantId: f.tenant_id, comercio: f.comercio, expiraEn: f.expira_en };
  },

  async cerrar(a) {
    const { data, error } = await acotada(supabaseAdmin().rpc('cerrar_vinculacion_portal', {
      p_id: a.id, p_tenant: a.tenantId, p_estado: a.estado, p_cookies: a.cookies ?? null, p_motivo: a.motivo ?? null,
    }), 'vinculacion.cerrar');
    if (error) { logger.error('vinculacion.cerrar_fallo', { err: error.message }); return { ok: false, motivo: 'No se pudo cerrar la solicitud.' }; }
    const r = (data ?? {}) as RespuestaRpc;
    return { ok: r.ok === true, motivo: r.motivo };
  },

  async cancelar(tenantId, comercio) {
    const { data, error } = await acotada(supabaseAdmin().rpc('cancelar_vinculacion_portal', { p_tenant: tenantId, p_comercio: comercio }), 'vinculacion.cancelar');
    if (error) { logger.error('vinculacion.cancelar_fallo', { err: error.message }); return 0; }
    return typeof data === 'number' ? data : 0;
  },

  async listar(tenantId) {
    const { data, error } = await acotada(supabaseAdmin().from('portal_vinculacion_solicitud')
      .select('id, tenant_id, comercio, estado, creada_en, expira_en, reclamada_en, cerrada_en, cookies, motivo')
      .eq('tenant_id', tenantId)
      .order('creada_en', { ascending: false }).order('id').limit(200), 'vinculacion.listar');
    if (error) { logger.warn('vinculacion.listar_sin_leer', { err: error.message }); return null; }
    const out: SolicitudVinculacion[] = [];
    for (const f of (data ?? []) as Array<Record<string, unknown>>) {
      const estado = String(f.estado) as EstadoSolicitud;
      if (!ESTADOS.includes(estado)) continue;
      out.push({
        id: String(f.id), tenantId: String(f.tenant_id), comercio: String(f.comercio), estado,
        creadaEn: String(f.creada_en), expiraEn: String(f.expira_en),
        reclamadaEn: f.reclamada_en == null ? null : String(f.reclamada_en),
        cerradaEn: f.cerrada_en == null ? null : String(f.cerrada_en),
        cookies: f.cookies == null ? null : Number(f.cookies), motivo: f.motivo == null ? null : String(f.motivo),
      });
    }
    return out;
  },
};

export const salidasVinculacion: SalidasVinculacion = {
  async guardarSesion(tenantId, comercio, storageState, capturadaEn) {
    await guardarSesionPortal(tenantId, conectorDePortal(comercio), { storageState, capturadaEn });
  },
  async anotarVinculado(tenantId, comercio, ahora) {
    await anotarVinculo({ tenantId, comercio, estado: 'vinculado', motivo: null, ahora });
  },
  async bitacora(tenantId, actor, accion, comercio, detalle) {
    await anotarBitacora({ tenantId, actor, accion, entidad: 'portal_vinculacion', entidadId: comercio, detalle },
      { evento: 'vinculacion.bitacora_no_escribio' });
  },
};

export function crearDepsVinculacion(): DepsVinculacion {
  return { repo: repoVinculacion, salidas: salidasVinculacion };
}
