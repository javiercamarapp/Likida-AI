import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { cifrar, descifrar } from '../conectores/cofre';

// ═══════════════════════════════════════════════════════════════════════════
// TODO el acceso a datos del push de posiciones en UN archivo (secretos por
// flota, salud, huérfanos). Cada consulta lleva `.eq('tenant_id', …)`:
// `supabaseAdmin` salta RLS y ese filtro es el único aislamiento.
// ═══════════════════════════════════════════════════════════════════════════

export interface SecretosPush {
  actual: string;
  previo: string | null;
  previoVenceEn: number | null;
  activo: boolean;
}

/** `null` = la flota no tiene push. Lanza si la base no contesta (el llamador responde 503). */
export async function leerSecretosPush(tenantId: string): Promise<SecretosPush | null> {
  const { data, error } = await acotada(
    supabaseAdmin().from('gps_push_secreto')
      .select('secreto_cifrado, secreto_previo_cifrado, previo_vence_en, activo')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    'gps_push.secretos',
  );
  if (error) throw new Error(`gps_push.secretos: ${error.message}`);
  if (!data) return null;
  const actual = descifrar(String(data.secreto_cifrado)).secreto;
  if (!actual) throw new Error('gps_push.secretos: secreto ilegible');
  const previo = data.secreto_previo_cifrado ? descifrar(String(data.secreto_previo_cifrado)).secreto ?? null : null;
  return {
    actual, previo, activo: data.activo === true,
    previoVenceEn: data.previo_vence_en ? Date.parse(String(data.previo_vence_en)) : null,
  };
}

export async function registrarUsoPush(tenantId: string, ok: boolean, motivo: string | null, guardadas: number): Promise<void> {
  const { error } = await acotada(
    supabaseAdmin().rpc('registrar_gps_push_uso', { p_tenant: tenantId, p_ok: ok, p_motivo: motivo, p_guardadas: guardadas }),
    'gps_push.uso',
  );
  if (error) throw new Error(`gps_push.uso: ${error.message}`);
}

/**
 * Genera (o rota) el secreto de la flota. Devuelve el secreto EN CLARO una sola
 * vez: en la base solo queda cifrado. El anterior sigue valiendo 24 h.
 */
export async function generarSecretoPush(tenantId: string): Promise<{ secreto: string; version: number }> {
  const secreto = `lkd_gps_${randomBytes(32).toString('hex')}`;
  const { data, error } = await acotada(
    supabaseAdmin().rpc('rotar_gps_push_secreto', { p_tenant: tenantId, p_nuevo_cifrado: cifrar({ secreto }) }),
    'gps_push.rotar',
  );
  if (error) throw new Error(`gps_push.rotar: ${error.message}`);
  return { secreto, version: Number(data) };
}

export interface EstadoPush {
  configurado: boolean;
  version: number | null;
  ultimaRecepcionEn: string | null;
  ultimaRecepcionGuardadas: number;
  ultimoRechazoEn: string | null;
  ultimoRechazoMotivo: string | null;
  rechazosTotal: number;
  recepcionesTotal: number;
  previoVigenteHasta: string | null;
}

/** Lo ÚNICO que vuelve al panel: nunca el secreto (ni cifrado). */
export async function estadoPush(tenantId: string): Promise<EstadoPush> {
  const { data, error } = await acotada(
    supabaseAdmin().from('gps_push_secreto')
      .select('version, ultima_recepcion_en, ultima_recepcion_guardadas, ultimo_rechazo_en, ultimo_rechazo_motivo, rechazos_total, recepciones_total, previo_vence_en, activo')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    'gps_push.estado',
  );
  if (error) throw new Error(`gps_push.estado: ${error.message}`);
  if (!data) {
    return { configurado: false, version: null, ultimaRecepcionEn: null, ultimaRecepcionGuardadas: 0, ultimoRechazoEn: null, ultimoRechazoMotivo: null, rechazosTotal: 0, recepcionesTotal: 0, previoVigenteHasta: null };
  }
  return {
    configurado: data.activo === true,
    version: Number(data.version),
    ultimaRecepcionEn: (data.ultima_recepcion_en as string | null) ?? null,
    ultimaRecepcionGuardadas: Number(data.ultima_recepcion_guardadas ?? 0),
    ultimoRechazoEn: (data.ultimo_rechazo_en as string | null) ?? null,
    ultimoRechazoMotivo: (data.ultimo_rechazo_motivo as string | null) ?? null,
    rechazosTotal: Number(data.rechazos_total ?? 0),
    recepcionesTotal: Number(data.recepciones_total ?? 0),
    previoVigenteHasta: (data.previo_vence_en as string | null) ?? null,
  };
}
