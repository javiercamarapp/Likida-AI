import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { logger } from '@/lib/logger';
import { contarCredencialesGps } from '../conexiones';
import { estadoPush } from '../gps_push/datos';
import type { EntradaFuente, IdFuente } from './estado';
import { evaluarSilencio, type ResultadoSilencio } from './silencio';

// ═══════════════════════════════════════════════════════════════════════════
// LECTURA de las señales de cada fuente (F19). SIN migración: solo los últimos
// registros que ya existen (latidos, recepciones, archivos). Cada fuente cae
// por su lado: una lectura que falla es `lectura: 'caida'` («sin dato»), nunca
// un cero ni un verde. Todas las consultas del tenant llevan `.eq('tenant_id')`
// (`supabaseAdmin` salta RLS: ese filtro es el único aislamiento).
// ═══════════════════════════════════════════════════════════════════════════

const DIA_MS = 86_400_000;

function ms(iso: unknown): number | null {
  if (typeof iso !== 'string') return null;
  const v = Date.parse(iso);
  return Number.isFinite(v) ? v : null;
}

function mayor(...valores: Array<number | null>): number | null {
  const reales = valores.filter((v): v is number => v !== null);
  return reales.length === 0 ? null : Math.max(...reales);
}

function caida(id: IdFuente, donde: string, err: unknown): EntradaFuente {
  logger.warn('fuentes.lectura_caida', { fuente: id, donde, err: err instanceof Error ? err.message : String(err) });
  return { id, lectura: 'caida', configurada: false, ultimaSenalMs: null };
}

async function leerWhatsapp(tenantId: string, ahoraMs: number): Promise<EntradaFuente> {
  try {
    const desde = new Date(ahoraMs - 30 * DIA_MS).toISOString();
    const [ultimo, cuenta] = await Promise.all([
      // orden-no-importa: solo se lee el instante del último gasto de la flota; un empate devuelve el mismo instante.
      acotada(supabaseAdmin().from('gasto').select('created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(1), 'fuentes.wa.ultimo'),
      acotada(supabaseAdmin().from('gasto').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gte('created_at', desde), 'fuentes.wa.cuenta'),
    ]);
    if (ultimo.error) throw new Error(ultimo.error.message);
    if (cuenta.error) throw new Error(cuenta.error.message);
    // El canal es del sistema (un número de Likida para todas las flotas): "configurado" es la configuración del servidor.
    const configurada = Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
    return { id: 'whatsapp', lectura: 'medida', configurada, ultimaSenalMs: ms(ultimo.data?.[0]?.created_at), muestra30d: cuenta.count ?? 0 };
  } catch (e) { return caida('whatsapp', 'gasto', e); }
}

async function leerTms(tenantId: string): Promise<EntradaFuente> {
  try {
    const { data, error } = await acotada(
      supabaseAdmin().from('tms_sincronizacion').select('ultima_ok_en, ultimo_error, actualizado_en').eq('tenant_id', tenantId).range(0, 49),
      'fuentes.tms',
    );
    if (error) throw new Error(error.message);
    const filas = data ?? [];
    const ultimaOk = mayor(...filas.map((f) => ms(f.ultima_ok_en)));
    // Falla vigente = algún recurso con error cuyo último avance (actualizado_en) es posterior a su última lectura buena.
    const conFalla = filas.find((f) => typeof f.ultimo_error === 'string' && f.ultimo_error.trim() !== '' && (ms(f.actualizado_en) ?? 0) > (ms(f.ultima_ok_en) ?? 0));
    return {
      id: 'tms', lectura: 'medida', configurada: filas.length > 0, ultimaSenalMs: ultimaOk,
      falla: conFalla ? String(conFalla.ultimo_error).slice(0, 160) : null,
    };
  } catch (e) { return caida('tms', 'tms_sincronizacion', e); }
}

async function leerGps(tenantId: string): Promise<EntradaFuente> {
  try {
    const [creds, push, vista] = await Promise.all([
      contarCredencialesGps(tenantId),
      estadoPush(tenantId),
      // orden-no-importa: solo se lee la última lectura GPS de la flota; un empate devuelve el mismo instante.
      acotada(supabaseAdmin().from('unidad').select('gps_visto_en').eq('tenant_id', tenantId).not('gps_visto_en', 'is', null).order('gps_visto_en', { ascending: false }).limit(1), 'fuentes.gps.unidad'),
    ]);
    if (creds === null) throw new Error('credenciales GPS sin leer');
    if (vista.error) throw new Error(vista.error.message);
    return {
      id: 'gps', lectura: 'medida', configurada: creds > 0 || push.configurado,
      ultimaSenalMs: mayor(ms(vista.data?.[0]?.gps_visto_en), ms(push.ultimaRecepcionEn)),
    };
  } catch (e) { return caida('gps', 'unidad/push', e); }
}

async function leerPeajes(tenantId: string): Promise<EntradaFuente> {
  try {
    const { data, error } = await acotada(
      supabaseAdmin().from('peaje_ingesta_archivo').select('estado, procesada_en, recibida_en, ultimo_error').eq('tenant_id', tenantId).order('recibida_en', { ascending: false }).order('id').limit(20),
      'fuentes.peajes',
    );
    if (error) throw new Error(error.message);
    const filas = data ?? [];
    const ultimaOk = mayor(...filas.filter((f) => f.estado === 'procesada').map((f) => ms(f.procesada_en) ?? ms(f.recibida_en)));
    const masNueva = filas[0];
    const falla = masNueva && masNueva.estado === 'fallida' ? String(masNueva.ultimo_error ?? 'archivo fallido').slice(0, 160) : null;
    return { id: 'peajes', lectura: 'medida', configurada: filas.length > 0, ultimaSenalMs: ultimaOk, falla };
  } catch (e) { return caida('peajes', 'peaje_ingesta_archivo', e); }
}

async function leerCorreo(tenantId: string, ahoraMs: number): Promise<EntradaFuente> {
  try {
    const desde = new Date(ahoraMs - 30 * DIA_MS).toISOString();
    const [buzon, ultimo, cuenta] = await Promise.all([
      acotada(supabaseAdmin().from('tenant').select('buzon_token').eq('id', tenantId).maybeSingle(), 'fuentes.correo.buzon'),
      // orden-no-importa: solo se lee el instante del último correo; un empate devuelve el mismo instante.
      acotada(supabaseAdmin().from('buzon_recepcion').select('recibido_en').eq('tenant_id', tenantId).order('recibido_en', { ascending: false }).limit(1), 'fuentes.correo.ultimo'),
      acotada(supabaseAdmin().from('buzon_recepcion').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gte('recibido_en', desde), 'fuentes.correo.cuenta'),
    ]);
    if (buzon.error || !buzon.data) throw new Error(buzon.error?.message ?? 'tenant sin leer');
    if (ultimo.error) throw new Error(ultimo.error.message);
    if (cuenta.error) throw new Error(cuenta.error.message);
    return {
      id: 'correo', lectura: 'medida', configurada: Boolean(buzon.data.buzon_token),
      ultimaSenalMs: ms(ultimo.data?.[0]?.recibido_en), muestra30d: cuenta.count ?? 0,
    };
  } catch (e) { return caida('correo', 'buzon_recepcion', e); }
}

async function leerSat(tenantId: string): Promise<EntradaFuente> {
  try {
    const [config, solicitudes] = await Promise.all([
      acotada(supabaseAdmin().from('sat_descarga_config').select('tenant_id').eq('tenant_id', tenantId).maybeSingle(), 'fuentes.sat.config'),
      acotada(supabaseAdmin().from('sat_descarga_solicitud').select('estado, descargada_en, proveedor_mensaje, solicitada_en').eq('tenant_id', tenantId).order('solicitada_en', { ascending: false }).order('id').limit(10), 'fuentes.sat.solicitudes'),
    ]);
    if (config.error) throw new Error(config.error.message);
    if (solicitudes.error) throw new Error(solicitudes.error.message);
    const filas = solicitudes.data ?? [];
    const ultimaOk = mayor(...filas.map((f) => ms(f.descargada_en)));
    const nueva = filas[0];
    // La solicitud más reciente en error, sin descarga posterior, es una falla vigente; el mensaje del proveedor va tal cual.
    const falla = nueva && nueva.estado === 'error' ? String(nueva.proveedor_mensaje ?? 'error del proveedor').slice(0, 160) : null;
    return { id: 'sat', lectura: 'medida', configurada: Boolean(config.data), ultimaSenalMs: ultimaOk, falla };
  } catch (e) { return caida('sat', 'sat_descarga', e); }
}

/** Las seis fuentes de UNA flota, cada una leída por su lado. Nunca lanza. */
export async function leerFuentesDeFlota(tenantId: string, ahoraMs: number = Date.now()): Promise<EntradaFuente[]> {
  return Promise.all([
    leerWhatsapp(tenantId, ahoraMs), leerTms(tenantId), leerGps(tenantId),
    leerPeajes(tenantId), leerCorreo(tenantId, ahoraMs), leerSat(tenantId),
  ]);
}

/**
 * La regla de silencio, leída. El webhook es UNO para todas las flotas (un solo número de Likida), así que el silencio se mide del
 * sistema: viajes abiertos en cualquier flota vs. el último evento del webhook —entrante (`wa_ventana_contacto`) o de estado
 * (`wa_meta_receipt`)—. Con `tenantId` los viajes abiertos son solo los de esa flota (el panel del cliente no ve conteos ajenos). Cada lectura que falle da «sin dato», nunca una alerta ni un «todo bien». Nunca lanza.
 */
export async function leerSilencioWebhook(ahoraMs: number = Date.now(), tenantId?: string): Promise<ResultadoSilencio> {
  const leerUltimo = async (tabla: 'wa_ventana_contacto' | 'wa_meta_receipt', col: 'ultimo_entrante_en' | 'recibido_en'): Promise<number | null | 'caida'> => {
    try {
      // orden-no-importa: solo se lee el instante más reciente de la tabla; un empate devuelve el mismo instante.
      const { data, error } = await acotada(supabaseAdmin().from(tabla).select(col).order(col, { ascending: false }).limit(1), `fuentes.silencio.${tabla}`);
      if (error) return 'caida';
      const fila = (data?.[0] ?? null) as Record<string, unknown> | null;
      return fila ? ms(fila[col]) : null;
    } catch { return 'caida'; }
  };
  let viajesAbiertos: number | null = null;
  try {
    // Sin `tenantId` (pantalla de /admin, superadmin) cuenta los de todas las flotas; el panel de UNA flota pasa su `tenantId` y
    // solo ve los suyos: nunca se le muestra un conteo de otras flotas.
    let consulta = supabaseAdmin().from('viaje').select('id', { count: 'exact', head: true }).eq('estatus', 'abierto');
    if (tenantId) consulta = consulta.eq('tenant_id', tenantId);
    const { count, error } = await acotada(consulta, 'fuentes.silencio.viajes');
    viajesAbiertos = error ? null : count ?? 0;
  } catch { viajesAbiertos = null; }
  const [entrante, estado] = await Promise.all([leerUltimo('wa_ventana_contacto', 'ultimo_entrante_en'), leerUltimo('wa_meta_receipt', 'recibido_en')]);
  if (entrante === 'caida' || estado === 'caida') {
    return evaluarSilencio({ viajesAbiertos, ultimoEvento: { leido: false }, ahoraMs });
  }
  return evaluarSilencio({ viajesAbiertos, ultimoEvento: { leido: true, ms: mayor(entrante, estado) }, ahoraMs });
}
