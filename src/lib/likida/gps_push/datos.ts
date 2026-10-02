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

// ── Lectura para el panel (Conexiones y Mapa) ──────────────────────────────

export interface PollGpsFila {
  proveedor: string; ultimoPollEn: string | null; ultimoCompletoEn: string | null;
  erroresSeguidos: number; ultimaFalla: 'credencial' | 'proveedor' | 'formato' | null;
  proximoIntentoEn: string | null; ultimoError: string | null; backlogPendiente: boolean; elementos: number;
}

/** Salud por proveedor (recurso `posiciones`). Lanza si la base no contesta. */
export async function saludPollsGps(tenantId: string): Promise<PollGpsFila[]> {
  const { data, error } = await acotada(
    supabaseAdmin().from('conector_poll_estado')
      .select('proveedor, ultimo_poll_en, ultimo_completo_en, errores_seguidos, ultima_falla, proximo_intento_en, ultimo_error, backlog_pendiente, elementos_ultima')
      .eq('tenant_id', tenantId).eq('recurso', 'posiciones').order('proveedor').range(0, 49),
    'gps_panel.polls',
  );
  if (error) throw new Error(`gps_panel.polls: ${error.message}`);
  return (data ?? []).map((f) => ({
    proveedor: String(f.proveedor),
    ultimoPollEn: (f.ultimo_poll_en as string | null) ?? null,
    ultimoCompletoEn: (f.ultimo_completo_en as string | null) ?? null,
    erroresSeguidos: Number(f.errores_seguidos ?? 0),
    ultimaFalla: (f.ultima_falla as PollGpsFila['ultimaFalla']) ?? null,
    proximoIntentoEn: (f.proximo_intento_en as string | null) ?? null,
    ultimoError: (f.ultimo_error as string | null) ?? null,
    backlogPendiente: f.backlog_pendiente === true,
    elementos: Number(f.elementos_ultima ?? 0),
  }));
}

export interface HuerfanoGps { proveedor: string; deviceId: string; primerVistoEn: string; ultimoVistoEn: string }
export const TOPE_HUERFANOS_PANEL = 200;

/**
 * Dispositivos que el proveedor reporta y NINGUNA unidad reclama. Se filtran los
 * que ya fueron ligados (la lista se limpia al mapear, pero la verdad es la
 * columna `unidad.gps_device_id`). `hayMas` = se cortó en el tope.
 */
export async function huerfanosGps(tenantId: string): Promise<{ lista: HuerfanoGps[]; hayMas: boolean }> {
  const { data, error } = await acotada(
    supabaseAdmin().from('gps_dispositivo_huerfano')
      .select('proveedor, device_id, primer_visto_en, ultimo_visto_en')
      .eq('tenant_id', tenantId)
      .order('ultimo_visto_en', { ascending: false }).order('device_id')
      .range(0, TOPE_HUERFANOS_PANEL),
    'gps_panel.huerfanos',
  );
  if (error) throw new Error(`gps_panel.huerfanos: ${error.message}`);
  const filas = data ?? [];
  const hayMas = filas.length > TOPE_HUERFANOS_PANEL;
  const candidatos = filas.slice(0, TOPE_HUERFANOS_PANEL);
  const reclamados = new Set<string>();
  const ids = [...new Set(candidatos.map((f) => String(f.device_id)))];
  for (let i = 0; i < ids.length; i += 200) {
    const { data: u, error: e2 } = await acotada(
      supabaseAdmin().from('unidad').select('gps_proveedor, gps_device_id')
        .eq('tenant_id', tenantId).in('gps_device_id', ids.slice(i, i + 200)),
      'gps_panel.huerfanos_reclamados',
    );
    if (e2) throw new Error(`gps_panel.huerfanos_reclamados: ${e2.message}`);
    for (const x of u ?? []) reclamados.add(`${x.gps_proveedor}|${x.gps_device_id}`);
  }
  return {
    hayMas,
    lista: candidatos
      .filter((f) => !reclamados.has(`${f.proveedor}|${f.device_id}`))
      .map((f) => ({ proveedor: String(f.proveedor), deviceId: String(f.device_id), primerVistoEn: String(f.primer_visto_en), ultimoVistoEn: String(f.ultimo_visto_en) })),
  };
}

export interface ConteosUnidadesGps { activas: number; conDispositivo: number; sinDispositivo: number; sinSenalNunca: number }

/** Cuántas unidades activas tienen dispositivo, cuáles no y cuáles lo tienen y nunca han reportado. */
export async function conteosUnidadesGps(tenantId: string): Promise<ConteosUnidadesGps> {
  const base = () => supabaseAdmin().from('unidad').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('activo', true);
  const [a, c, n] = await Promise.all([
    acotada(base(), 'gps_panel.unidades_activas'),
    // Con fuente GPS = dispositivo ligado O ya reportó (la tabla propia liga por número económico, sin `gps_device_id`).
    acotada(base().or('gps_device_id.not.is.null,gps_visto_en.not.is.null'), 'gps_panel.unidades_con_dispositivo'),
    acotada(base().not('gps_device_id', 'is', null).is('gps_visto_en', null), 'gps_panel.unidades_sin_senal'),
  ]);
  for (const r of [a, c, n]) if (r.error) throw new Error(`gps_panel.unidades: ${r.error.message}`);
  const activas = a.count ?? 0; const conDispositivo = c.count ?? 0;
  return { activas, conDispositivo, sinDispositivo: Math.max(0, activas - conDispositivo), sinSenalNunca: n.count ?? 0 };
}

/** Ids de las unidades con fuente GPS: dispositivo ligado o ya reportó (para rotular el pin de WhatsApp como respaldo). */
export async function unidadesConDispositivo(tenantId: string): Promise<Set<string>> {
  const salida = new Set<string>();
  for (let d = 0; ; d += 1000) {
    const { data, error } = await acotada(
      supabaseAdmin().from('unidad').select('id').eq('tenant_id', tenantId).or('gps_device_id.not.is.null,gps_visto_en.not.is.null').order('id').range(d, d + 999),
      'gps_panel.unidades_con_dispositivo_ids',
    );
    if (error) throw new Error(`gps_panel.unidades_con_dispositivo_ids: ${error.message}`);
    for (const f of data ?? []) salida.add(String(f.id));
    if ((data ?? []).length < 1000) return salida;
    if (d > 50_000) throw new Error('gps_panel.unidades_con_dispositivo_ids: más de 50,000 unidades');
  }
}
