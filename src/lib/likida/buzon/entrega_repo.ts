import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';
import { COLUMNAS_FACTURA, aFactura, type FacturaProveedor } from '../proveedores';
import { CONFIG_ENTREGA_DEFAULT, LEASE_ENVIO_MS, type ConfigEntrega } from './entrega_pura';

// ═══════════════════════════════════════════════════════════════════════════
// EL REPOSITORIO DE LA ENTREGA AL CONTADOR (0531). Toda consulta por flota ancla
// `tenant_id`; las que cruzan flotas (el cron: quién tiene entrega automática, qué
// lotes vencieron; el webhook: el lote por su id de Resend) lo hacen a propósito y
// leen/escriben solo por `id`. Un fallo de base LANZA (un tablero ciego no es «sin
// lotes»); la tabla sin migrar (42P01) se dice como «no disponible», no como vacío.
// ═══════════════════════════════════════════════════════════════════════════

export type EstadoEntrega = 'pendiente' | 'enviando' | 'enviada' | 'entregada' | 'rebotada' | 'fallida' | 'cancelada';
export type EventoEntrega =
  | 'creada' | 'intento' | 'enviada' | 'fallo' | 'reintento_programado' | 'retraso' | 'entregada' | 'rebotada'
  | 'reintento_manual' | 'cancelada' | 'liberada';

export interface Entrega {
  id: string;
  tenantId: string;
  creadoEn: string;
  creadoPor: string | null;
  disparo: 'manual' | 'automatica';
  estado: EstadoEntrega;
  formato: ConfigEntrega['formato'];
  incluyeZip: boolean;
  destinatarios: string[];
  nFacturas: number;
  total: number;
  intentos: number;
  proximoIntentoEn: string;
  leaseHasta: string | null;
  resendId: string | null;
  enviadaEn: string | null;
  entregadaEn: string | null;
  error: string | null;
}

const COLUMNAS_ENTREGA = 'id, tenant_id, creado_en, creado_por, disparo, estado, formato, incluye_zip, destinatarios, n_facturas, total, intentos, proximo_intento_en, lease_hasta, resend_id, enviada_en, entregada_en, error';

function aEntrega(f: Record<string, unknown>): Entrega {
  return {
    id: f.id as string, tenantId: f.tenant_id as string, creadoEn: f.creado_en as string, creadoPor: (f.creado_por as string) ?? null,
    disparo: f.disparo as Entrega['disparo'], estado: f.estado as EstadoEntrega, formato: f.formato as Entrega['formato'],
    incluyeZip: f.incluye_zip === true, destinatarios: (f.destinatarios as string[]) ?? [], nFacturas: Number(f.n_facturas),
    total: Number(f.total), intentos: Number(f.intentos), proximoIntentoEn: f.proximo_intento_en as string,
    leaseHasta: (f.lease_hasta as string) ?? null, resendId: (f.resend_id as string) ?? null, enviadaEn: (f.enviada_en as string) ?? null,
    entregadaEn: (f.entregada_en as string) ?? null, error: (f.error as string) ?? null,
  };
}

const sinTabla = (e: { code?: string } | null): boolean => e?.code === '42P01' || e?.code === '42703';

// ── Configuración ───────────────────────────────────────────────────────────

export async function leerConfigEntrega(tenantId: string): Promise<{ config: ConfigEntrega; disponible: boolean }> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('buzon_entrega_config')
    .select('activo, destinatarios, formato, incluir_zip, automatica, hora_envio, min_facturas')
    .eq('tenant_id', tenantId)
    .maybeSingle(), 'buzon_entrega.config');
  if (error) {
    if (sinTabla(error)) return { config: CONFIG_ENTREGA_DEFAULT, disponible: false };
    throw new Error(`leerConfigEntrega: ${error.message}`);
  }
  if (!data) return { config: CONFIG_ENTREGA_DEFAULT, disponible: true };
  const f = data as Record<string, unknown>;
  return {
    disponible: true,
    config: {
      activo: f.activo === true, destinatarios: (f.destinatarios as string[]) ?? [], formato: f.formato as ConfigEntrega['formato'],
      incluirZip: f.incluir_zip !== false, automatica: f.automatica === true, horaEnvio: Number(f.hora_envio), minFacturas: Number(f.min_facturas),
    },
  };
}

export async function guardarConfigEntrega(tenantId: string, c: ConfigEntrega): Promise<{ error?: string }> {
  const { error } = await acotada(supabaseAdmin().from('buzon_entrega_config').upsert({
    tenant_id: tenantId, activo: c.activo, destinatarios: c.destinatarios, formato: c.formato, incluir_zip: c.incluirZip,
    automatica: c.automatica, hora_envio: c.horaEnvio, min_facturas: c.minFacturas, updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id' }), 'buzon_entrega.guardar_config');
  if (error) {
    logger.error('buzon_entrega.guardar_config_fallo', { tenantId, err: error.message });
    return { error: sinTabla(error) ? 'La entrega al contador aún no está disponible en este entorno (falta aplicar la migración 0531).' : 'No se pudo guardar. Inténtalo de nuevo.' };
  }
  return {};
}

/** Las flotas que encendieron la entrega AUTOMÁTICA (el cron cruza flotas a propósito). */
export async function flotasConEntregaAutomatica(limite = 200): Promise<Array<{ tenantId: string; config: ConfigEntrega }>> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('buzon_entrega_config')
    .select('tenant_id, activo, destinatarios, formato, incluir_zip, automatica, hora_envio, min_facturas')
    .eq('activo', true)
    .eq('automatica', true)
    .order('tenant_id')
    .limit(limite), 'buzon_entrega.flotas_automaticas');
  if (error) {
    if (sinTabla(error)) return [];
    throw new Error(`flotasConEntregaAutomatica: ${error.message}`);
  }
  return (data ?? []).map((f: Record<string, unknown>) => ({
    tenantId: f.tenant_id as string,
    config: {
      activo: true, destinatarios: (f.destinatarios as string[]) ?? [], formato: f.formato as ConfigEntrega['formato'],
      incluirZip: f.incluir_zip !== false, automatica: true, horaEnvio: Number(f.hora_envio), minFacturas: Number(f.min_facturas),
    },
  }));
}

// ── Lotes ───────────────────────────────────────────────────────────────────

export async function ultimoLoteAutomaticoEn(tenantId: string): Promise<string | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('buzon_entrega')
    .select('creado_en')
    .eq('tenant_id', tenantId)
    .eq('disparo', 'automatica')
    .neq('estado', 'cancelada')
    .order('creado_en', { ascending: false })
    .order('id', { ascending: false })
    .limit(1), 'buzon_entrega.ultimo_automatico');
  if (error) throw new Error(`ultimoLoteAutomaticoEn: ${error.message}`);
  return ((data ?? [])[0] as { creado_en: string } | undefined)?.creado_en ?? null;
}

/** Las aprobadas que aún no viajan en ningún lote, las más viejas primero. */
export async function facturasSinEntregar(tenantId: string, limite: number): Promise<FacturaProveedor[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('factura_proveedor')
    .select(COLUMNAS_FACTURA)
    .eq('tenant_id', tenantId)
    .eq('estado', 'aprobada')
    .is('entrega_id', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limite), 'buzon_entrega.sin_entregar');
  if (error) throw new Error(`facturasSinEntregar: ${error.message}`);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(aFactura);
}

export async function contarSinEntregar(tenantId: string): Promise<number> {
  const { count, error } = await acotada(supabaseAdmin()
    .from('factura_proveedor')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).eq('estado', 'aprobada').is('entrega_id', null), 'buzon_entrega.contar_sin_entregar');
  if (error || typeof count !== 'number') throw new Error(`contarSinEntregar: ${error?.message ?? 'sin conteo'}`);
  return count;
}

export interface NuevoLote {
  disparo: 'manual' | 'automatica'; creadoPor: string | null; formato: ConfigEntrega['formato']; incluyeZip: boolean;
  destinatarios: string[]; nFacturas: number; total: number;
}

export async function crearLote(tenantId: string, l: NuevoLote): Promise<string> {
  const { data, error } = await acotada(supabaseAdmin().from('buzon_entrega').insert({
    tenant_id: tenantId, creado_por: l.creadoPor, disparo: l.disparo, formato: l.formato, incluye_zip: l.incluyeZip,
    destinatarios: l.destinatarios, n_facturas: l.nFacturas, total: l.total,
  }).select('id').single(), 'buzon_entrega.crear_lote');
  if (error || !data) throw new Error(`crearLote: ${error?.message ?? 'sin id'}`);
  return (data as { id: string }).id;
}

/** RESERVA atómica: el UPDATE condicional (`entrega_id is null`) es el claim — de dos corridas solapadas gana una. */
export async function reservarFacturas(tenantId: string, entregaId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await acotada(supabaseAdmin()
    .from('factura_proveedor')
    .update({ entrega_id: entregaId })
    .eq('tenant_id', tenantId).eq('estado', 'aprobada').is('entrega_id', null)
    .in('id', ids)
    .select('id'), 'buzon_entrega.reservar');
  if (error) throw new Error(`reservarFacturas: ${error.message}`);
  return (data ?? []).map((f: { id: string }) => f.id);
}

export async function ajustarLote(tenantId: string, id: string, nFacturas: number, total: number): Promise<void> {
  const { error } = await acotada(supabaseAdmin().from('buzon_entrega').update({ n_facturas: nFacturas, total })
    .eq('tenant_id', tenantId).eq('id', id), 'buzon_entrega.ajustar');
  if (error) throw new Error(`ajustarLote: ${error.message}`);
}

export async function borrarLote(tenantId: string, id: string): Promise<void> {
  const { error } = await acotada(supabaseAdmin().from('buzon_entrega').delete().eq('tenant_id', tenantId).eq('id', id), 'buzon_entrega.borrar');
  if (error) throw new Error(`borrarLote: ${error.message}`);
}

/** Los lotes que ya tocan: pendientes vencidos y «enviando» cuyo lease murió. Cruza flotas (cron). */
export async function lotesParaEnviar(ahora: Date, limite = 10): Promise<Entrega[]> {
  const iso = ahora.toISOString();
  const { data, error } = await acotada(supabaseAdmin()
    .from('buzon_entrega')
    .select(COLUMNAS_ENTREGA)
    .or(`and(estado.eq.pendiente,proximo_intento_en.lte.${iso}),and(estado.eq.enviando,lease_hasta.lt.${iso})`)
    .order('proximo_intento_en', { ascending: true })
    .order('id', { ascending: true })
    .limit(limite), 'buzon_entrega.para_enviar');
  if (error) {
    if (sinTabla(error)) return [];
    throw new Error(`lotesParaEnviar: ${error.message}`);
  }
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(aEntrega);
}

/** El CLAIM del envío: pasa a «enviando» con lease y suma el intento, solo si nadie lo tomó (optimista por `intentos`). */
export async function reclamarLote(l: Entrega, ahora: Date): Promise<Entrega | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('buzon_entrega')
    .update({ estado: 'enviando', lease_hasta: new Date(ahora.getTime() + LEASE_ENVIO_MS).toISOString(), intentos: l.intentos + 1 })
    .eq('tenant_id', l.tenantId).eq('id', l.id).eq('intentos', l.intentos).eq('estado', l.estado)
    .select(COLUMNAS_ENTREGA), 'buzon_entrega.reclamar');
  if (error) throw new Error(`reclamarLote: ${error.message}`);
  const f = (data ?? [])[0] as Record<string, unknown> | undefined;
  return f ? aEntrega(f) : null;
}

export interface FacturaDeLote { factura: FacturaProveedor; xmlCrudo: string | null; pdfRuta: string | null }

export async function facturasDelLote(tenantId: string, entregaId: string): Promise<FacturaDeLote[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('factura_proveedor')
    .select(`${COLUMNAS_FACTURA}, xml_crudo`)
    .eq('tenant_id', tenantId).eq('entrega_id', entregaId)
    .order('created_at', { ascending: true }).order('id', { ascending: true })
    .limit(500), 'buzon_entrega.facturas_del_lote');
  if (error) throw new Error(`facturasDelLote: ${error.message}`);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((f) => ({
    factura: aFactura(f), xmlCrudo: (f.xml_crudo as string) ?? null, pdfRuta: typeof f.pdf_ruta === 'string' ? f.pdf_ruta : null,
  }));
}

export async function marcarEnviada(tenantId: string, id: string, resendId: string, ahora: Date): Promise<void> {
  const { error } = await acotada(supabaseAdmin().from('buzon_entrega')
    .update({ estado: 'enviada', resend_id: resendId, enviada_en: ahora.toISOString(), lease_hasta: null, error: null })
    .eq('tenant_id', tenantId).eq('id', id).eq('estado', 'enviando'), 'buzon_entrega.marcar_enviada');
  if (error) throw new Error(`marcarEnviada: ${error.message}`);
  const f = await acotada(supabaseAdmin().from('factura_proveedor').update({ entregada_en: ahora.toISOString() })
    .eq('tenant_id', tenantId).eq('entrega_id', id), 'buzon_entrega.marcar_facturas');
  if (f.error) logger.warn('buzon_entrega.marcar_facturas_fallo', { tenantId, id, err: f.error.message });
}

export async function marcarFallo(
  tenantId: string, id: string, estado: 'pendiente' | 'fallida', proximo: Date | null, mensaje: string,
): Promise<void> {
  const { error } = await acotada(supabaseAdmin().from('buzon_entrega')
    .update({ estado, lease_hasta: null, error: mensaje.slice(0, 300), ...(proximo ? { proximo_intento_en: proximo.toISOString() } : {}) })
    .eq('tenant_id', tenantId).eq('id', id).eq('estado', 'enviando'), 'buzon_entrega.marcar_fallo');
  if (error) throw new Error(`marcarFallo: ${error.message}`);
}

export async function anotarEvento(tenantId: string, entregaId: string, evento: EventoEntrega, detalle?: string): Promise<void> {
  const { error } = await acotada(supabaseAdmin().from('buzon_entrega_evento')
    .insert({ tenant_id: tenantId, entrega_id: entregaId, evento, detalle: detalle ? detalle.slice(0, 300) : null }), 'buzon_entrega.evento');
  // La bitácora no tumba al envío: si no se pudo anotar, se dice.
  if (error) logger.warn('buzon_entrega.evento_sin_anotar', { tenantId, entregaId, evento, err: error.message });
}

/** Suelta las facturas de un lote (cancelado o rebotado): vuelven a la cola de «sin entregar». */
export async function liberarFacturas(tenantId: string, entregaId: string): Promise<number> {
  const { data, error } = await acotada(supabaseAdmin().from('factura_proveedor')
    .update({ entrega_id: null, entregada_en: null })
    .eq('tenant_id', tenantId).eq('entrega_id', entregaId).select('id'), 'buzon_entrega.liberar');
  if (error) throw new Error(`liberarFacturas: ${error.message}`);
  return (data ?? []).length;
}

/** Cancelar un lote que NO salió (pendiente, fallida o rebotada). Devuelve false si ya no se puede. */
export async function cancelarLote(tenantId: string, id: string): Promise<boolean> {
  const { data, error } = await acotada(supabaseAdmin().from('buzon_entrega')
    .update({ estado: 'cancelada', lease_hasta: null })
    .eq('tenant_id', tenantId).eq('id', id).in('estado', ['pendiente', 'fallida', 'rebotada']).select('id'), 'buzon_entrega.cancelar');
  if (error) throw new Error(`cancelarLote: ${error.message}`);
  if ((data ?? []).length === 0) return false;
  await anotarEvento(tenantId, id, 'cancelada');
  const n = await liberarFacturas(tenantId, id);
  await anotarEvento(tenantId, id, 'liberada', `${n} factura(s) vuelven a la cola`);
  return true;
}

/** Una persona reintenta un lote agotado: vuelve a pendiente con los intentos en cero. */
export async function reintentarLote(tenantId: string, id: string, ahora: Date): Promise<boolean> {
  const { data, error } = await acotada(supabaseAdmin().from('buzon_entrega')
    .update({ estado: 'pendiente', intentos: 0, proximo_intento_en: ahora.toISOString(), error: null })
    .eq('tenant_id', tenantId).eq('id', id).eq('estado', 'fallida').select('id'), 'buzon_entrega.reintentar');
  if (error) throw new Error(`reintentarLote: ${error.message}`);
  if ((data ?? []).length === 0) return false;
  await anotarEvento(tenantId, id, 'reintento_manual');
  return true;
}

export async function listarLotes(tenantId: string, limite = 20): Promise<Entrega[]> {
  const { data, error } = await acotada(supabaseAdmin().from('buzon_entrega').select(COLUMNAS_ENTREGA)
    .eq('tenant_id', tenantId).order('creado_en', { ascending: false }).order('id', { ascending: false }).limit(limite), 'buzon_entrega.listar');
  if (error) {
    if (sinTabla(error)) return [];
    throw new Error(`listarLotes: ${error.message}`);
  }
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(aEntrega);
}

/** La confirmación de Resend (webhook): entregada o rebotada. Un rebote suelta las facturas para rearmar el lote. */
export async function confirmarPorResend(resendId: string, resultado: 'entregada' | 'rebotada'): Promise<'aplicada' | 'sin_lote' | 'ya_estaba'> {
  const { data: previo, error: e1 } = await acotada(supabaseAdmin().from('buzon_entrega')
    // orden-no-importa: resend_id es único (índice parcial buzon_entrega_resend_idx): a lo más una fila
    .select('id, tenant_id, estado').eq('resend_id', resendId).limit(1), 'buzon_entrega.por_resend');
  if (e1) {
    if (sinTabla(e1)) return 'sin_lote';
    throw new Error(`confirmarPorResend: ${e1.message}`);
  }
  const fila = (previo ?? [])[0] as { id: string; tenant_id: string; estado: EstadoEntrega } | undefined;
  if (!fila) return 'sin_lote';
  // La mala noticia pisa a «entregada»; «entregada» solo escribe sobre «enviada».
  const permitidos: EstadoEntrega[] = resultado === 'entregada' ? ['enviada'] : ['enviada', 'entregada'];
  if (!permitidos.includes(fila.estado)) return 'ya_estaba';
  const { data, error } = await acotada(supabaseAdmin().from('buzon_entrega')
    .update({ estado: resultado, ...(resultado === 'entregada' ? { entregada_en: new Date().toISOString() } : {}) })
    .eq('tenant_id', fila.tenant_id).eq('id', fila.id).in('estado', permitidos).select('id'), 'buzon_entrega.confirmar');
  if (error) throw new Error(`confirmarPorResend: ${error.message}`);
  if ((data ?? []).length === 0) return 'ya_estaba';
  await anotarEvento(fila.tenant_id, fila.id, resultado);
  if (resultado === 'rebotada') {
    const n = await liberarFacturas(fila.tenant_id, fila.id);
    await anotarEvento(fila.tenant_id, fila.id, 'liberada', `${n} factura(s) vuelven a la cola: revisa el correo del contador`);
  }
  return 'aplicada';
}

/** «Enviadas» que Resend no ha confirmado pasado el plazo: se les anota UN evento de retraso. */
export async function marcarRetrasos(ahora: Date, plazoMs: number, limite = 50): Promise<number> {
  const corte = new Date(ahora.getTime() - plazoMs).toISOString();
  const { data, error } = await acotada(supabaseAdmin().from('buzon_entrega').select('id, tenant_id')
    .eq('estado', 'enviada').lt('enviada_en', corte).order('enviada_en').order('id').limit(limite), 'buzon_entrega.retrasadas');
  if (error) {
    if (sinTabla(error)) return 0;
    throw new Error(`marcarRetrasos: ${error.message}`);
  }
  let n = 0;
  for (const f of (data ?? []) as Array<{ id: string; tenant_id: string }>) {
    const { data: ya } = await acotada(supabaseAdmin().from('buzon_entrega_evento').select('id')
      // orden-no-importa: solo se pregunta si existe algún evento de retraso: cualquiera sirve
      .eq('tenant_id', f.tenant_id).eq('entrega_id', f.id).eq('evento', 'retraso').limit(1), 'buzon_entrega.retraso_previo');
    if ((ya ?? []).length > 0) continue;
    await anotarEvento(f.tenant_id, f.id, 'retraso', 'Resend aún no confirma la entrega');
    n++;
  }
  return n;
}

/** El nombre de la flota para el correo al contador. `null` si no se pudo leer (el correo dice «la flota»). */
export async function nombreFlota(tenantId: string): Promise<string | null> {
  const { data, error } = await acotada(supabaseAdmin().from('tenant').select('nombre').eq('id', tenantId).maybeSingle(), 'buzon_entrega.nombre_flota');
  if (error) return null;
  return (data as { nombre?: string } | null)?.nombre ?? null;
}
