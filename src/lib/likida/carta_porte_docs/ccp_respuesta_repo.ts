// ═══════════════════════════════════════════════════════════════════════════
// ACCESO A DATOS DE LA RESPUESTA CON EL CCP TIMBRADO (T-A3-33) — tabla `cp_ccp_timbrado` (0794).
//
// Las reglas de `repo.ts` / `repo_envios.ts`: service_role salta RLS, así que CADA consulta lleva `.eq('tenant_id')`;
// supabase-js reporta errores por valor y aquí se LANZAN (un «no pude leer» jamás se vuelve «no hay nada»); la ÚNICA
// excepción es «la migración 0794 no está aplicada», que apaga la función sin romper nada (`sin_migracion`).
// La lógica de decisión es `ccp_respuesta.ts`; este archivo solo arma `DepsCcp` con la base, Storage y el correo.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { enviarCorreo } from '@/lib/correo/enviar';
import { acotada } from '../presupuesto';
import { exigir } from '../pg';
import { descargarArchivo, funcionAusente, subirArchivo } from './repo';
import type { DepsCcp, EstadoCcpTimbrado, FilaCcp, NuevaFilaCcp } from './ccp_respuesta';

type Fila = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const COLUMNAS = 'id, tenant_id, documento_id, envio_id, uuid, pdf_ruta, xml_ruta, destino_correo, estado, respondido_en';

export const aFilaCcp = (f: Fila): FilaCcp => ({
  id: String(f.id), tenantId: String(f.tenant_id), documentoId: String(f.documento_id), envioId: String(f.envio_id), uuid: String(f.uuid),
  pdfRuta: String(f.pdf_ruta), xmlRuta: String(f.xml_ruta), destinoCorreo: s(f.destino_correo),
  estado: f.estado as EstadoCcpTimbrado, respondidoEn: s(f.respondido_en),
});

/** La tabla o la columna de la 0794 no existe: PGRST205/42P01 (tabla), 42703 (columna) o el mensaje del esquema. */
const tablaAusente = (e: { message?: string; code?: string } | null | undefined): boolean =>
  Boolean(e) && (e!.code === 'PGRST205' || e!.code === '42P01' || e!.code === '42703' || funcionAusente(e)
    || /does not exist|schema cache|could not find the/i.test(e!.message ?? ''));

export async function buscarPorUuid(tenantId: string, uuid: string): Promise<FilaCcp | null> {
  const r = await acotada(supabaseAdmin().from('cp_ccp_timbrado').select(COLUMNAS).eq('tenant_id', tenantId).eq('uuid', uuid).maybeSingle(), 'ccp.por_uuid');
  const f = exigir(r, 'ccp.por_uuid') as Fila | null;
  return f ? aFilaCcp(f) : null;
}

export async function leerPorId(tenantId: string, id: string): Promise<FilaCcp | null> {
  const r = await acotada(supabaseAdmin().from('cp_ccp_timbrado').select(COLUMNAS).eq('tenant_id', tenantId).eq('id', id).maybeSingle(), 'ccp.por_id');
  const f = exigir(r, 'ccp.por_id') as Fila | null;
  return f ? aFilaCcp(f) : null;
}

/** El envío MÁS RECIENTE de la flota con esa referencia del TMS, con el remitente de su documento. */
export async function buscarEnvioPropio(tenantId: string, referencia: string) {
  const e = await acotada(supabaseAdmin().from('cp_envio_tms').select('id, documento_id').eq('tenant_id', tenantId).eq('referencia_tms', referencia)
    .order('created_at', { ascending: false }).order('id').limit(1).maybeSingle(), 'ccp.envio');
  const envio = exigir(e, 'ccp.envio') as Fila | null;
  if (!envio) return null;
  const d = await acotada(supabaseAdmin().from('cp_documento').select('remitente, remitente_reconocido').eq('tenant_id', tenantId).eq('id', String(envio.documento_id)).maybeSingle(), 'ccp.documento');
  const doc = exigir(d, 'ccp.documento') as Fila | null;
  if (!doc) return null;
  return {
    envioId: String(envio.id), documentoId: String(envio.documento_id), remitente: s(doc.remitente),
    remitenteReconocido: doc.remitente_reconocido === null || doc.remitente_reconocido === undefined ? null : Boolean(doc.remitente_reconocido),
  };
}

export async function respuestaActiva(tenantId: string): Promise<boolean | 'sin_migracion'> {
  const r = await acotada(supabaseAdmin().from('cp_salida_config').select('responder_ccp').eq('tenant_id', tenantId).maybeSingle(), 'ccp.config');
  if (r.error) {
    if (tablaAusente(r.error)) return 'sin_migracion';
    throw new Error(`ccp.config: ${r.error.message}`);
  }
  // Sin fila de configuración = valores de arranque = apagado.
  return Boolean((r.data as Fila | null)?.responder_ccp);
}

export async function insertarCcp(f: NuevaFilaCcp): Promise<{ creada: boolean; fila: FilaCcp }> {
  const r = await acotada(supabaseAdmin().from('cp_ccp_timbrado').insert({
    tenant_id: f.tenantId, documento_id: f.documentoId, envio_id: f.envioId, uuid: f.uuid, pdf_ruta: f.pdfRuta, xml_ruta: f.xmlRuta,
    destino_correo: f.destinoCorreo, estado: f.estado,
  }).select(COLUMNAS).single(), 'ccp.insertar');
  if (r.error) {
    if (r.error.code === '23505') { // el mismo UUID llegó dos veces a la vez: gana el primero
      const existente = await buscarPorUuid(f.tenantId, f.uuid);
      if (existente) return { creada: false, fila: existente };
    }
    throw new Error(`ccp.insertar: ${r.error.message}`);
  }
  return { creada: true, fila: aFilaCcp(r.data as unknown as Fila) };
}

export async function destinoYaConfirmado(tenantId: string, destino: string): Promise<boolean> {
  const r = await acotada(supabaseAdmin().from('cp_ccp_timbrado').select('id').eq('tenant_id', tenantId).eq('destino_correo', destino).eq('estado', 'respondido').limit(1), 'ccp.destino_confirmado');
  return ((exigir(r, 'ccp.destino_confirmado') ?? []) as unknown[]).length > 0;
}

export async function fijarDestino(tenantId: string, id: string, destino: string): Promise<void> {
  const r = await acotada(supabaseAdmin().from('cp_ccp_timbrado').update({ destino_correo: destino, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', id).neq('estado', 'respondido'), 'ccp.fijar_destino');
  if (r.error) throw new Error(`ccp.fijar_destino: ${r.error.message}`);
}

async function rpcBooleana(rpc: string, tenantId: string, id: string, etiqueta: string): Promise<boolean> {
  const r = await acotada(supabaseAdmin().rpc(rpc, { p_tenant: tenantId, p_id: id }), etiqueta);
  if (r.error) throw new Error(`${etiqueta}: ${r.error.message}`);
  return r.data === true;
}

/** Las dependencias reales de `procesarCcpTimbrado` / `confirmarYResponder`. */
export function depsCcp(): DepsCcp {
  return {
    buscarEnvio: buscarEnvioPropio,
    respuestaActiva,
    buscarPorUuid,
    subirArchivo,
    descargarArchivo,
    insertar: insertarCcp,
    destinoYaConfirmado,
    fijarDestino,
    marcarRespondido: (t, id) => rpcBooleana('cp_ccp_marcar_respondido', t, id, 'ccp.marcar_respondido'),
    liberarRespuesta: (t, id) => rpcBooleana('cp_ccp_liberar_respuesta', t, id, 'ccp.liberar_respuesta'),
    enviarCorreo: (para, correo, adjuntos, idempotencyKey) => enviarCorreo(para, correo, { remitenteLocal: 'avisos', adjuntos, idempotencyKey }),
    registrar: (evento, datos) => logger.info(evento, datos),
  };
}
