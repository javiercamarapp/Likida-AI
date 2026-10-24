// ═══════════════════════════════════════════════════════════════════════════
// CARTA PORTE MULTI-FORMATO — acceso a datos (tablas de la 0420 + Storage).
//
// El ÚNICO archivo del módulo que habla con Supabase (el guardia de la frontera
// de datos cuenta archivos y llamadas: la regla es juntar el acceso, no
// repartirlo). Reglas de TODO este archivo (las de CLAUDE.md):
//
//   · service_role salta RLS, así que CADA consulta lleva `.eq('tenant_id')`;
//   · supabase-js reporta errores POR VALOR: se revisa `error` y se LANZA —
//     «no pude leer» jamás se vuelve «no hay nada» (`exigir`);
//   · cada llamada va envuelta en `acotada` (techo de tiempo);
//   · escribir el estado de un documento es SIEMPRE condicional (`version` en el
//     WHERE): dos revisores, o un reintento tardío, no se pisan.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { exigir, traerPorIds } from '../pg';
import { logger } from '@/lib/logger';
import { aBuffer } from './bytes';
import type { Extraccion } from './campos';
import type { ResultadoValidacion } from './validacion';
import type { FormatoDoc } from './contenido';
import type { ViajeSalido } from './viajes_sin_ccp';
import type { FirmaPerfil, Mapeo, EjemploPerfil, Perfil } from './perfiles';
import { TOPE_FILAS_CATALOGO, catalogoVacio, type CatalogoCliente, type ParteCat, type ProductoCat } from './catalogo_cliente';

export const BUCKET = 'cartaporte-docs';

export type CanalDoc = 'manual' | 'correo' | 'whatsapp';
export type EstadoDoc = 'recibido' | 'procesando' | 'por_revisar' | 'aprobado' | 'rechazado' | 'fallido' | 'dividido';

export interface MetaExtraccion {
  origen: 'xml' | 'perfil' | 'llm' | 'perfil+llm';
  nivel: number;
  escalamientos: Array<{ de: number; a: number; motivo: string; codigo?: string }>;
  /** T-A3-68 e: campos que ningún nivel del modelo logró dejar que cuadren, con los valores en conflicto. Nunca se aprueban solos. */
  revisionHumana?: Array<{ campo: string; renglon: number | null; codigo: string; motivo: string; valores: string[] }>;
  /** T-A3-68 a: cambios de modo (`json_object`) o de modelo (respaldo) que ocurrieron al leer el documento, con su motivo. */
  caidas?: Array<{ tipo: string; rol: string; de: string; a: string; motivo: string; detalle?: string }>;
  avisos: string[];
  notasModelo: string[];
  indiciosInyeccion: string[];
  /** T-A3-53: la captura del correo llegó cortada (termina en este rótulo sin valor). Se revalida en cada corrección y al aprobar. */
  capturaIncompleta?: { ultimoRotulo: string } | null;
  /** A37-A3-03: lo que la lectura dejó fuera (embarques, páginas, filas, hojas). `bloquea` = pudo perderse una mercancía o un embarque. Se revalida en cada corrección. */
  lecturaIncompleta?: Array<{ mensaje: string; bloquea: boolean }>;
  /** T-A3-67: el formato de entrada que reconoció el servicio y despachó a su lector (C remisión escaneada, D BOL en inglés, E orden del agente aduanal). */
  formatoEntrada?: 'C' | 'D' | 'E';
  /** T-A3-67: el lector no pudo leer el documento (hoy: remisión escaneada sin modelo de visión). Nada se inventó: se captura a mano. Se revalida en cada corrección. */
  requiereCapturaManual?: { formato: 'C' | 'D' | 'E'; motivo: 'sin_vision' } | null;
}

/** Lo que se guarda en `cp_documento.extraccion`. */
export interface ExtraccionGuardada extends Extraccion { meta?: MetaExtraccion }

export interface DocumentoFila {
  id: string;
  tenantId: string;
  canal: CanalDoc;
  formato: FormatoDoc;
  nombreArchivo: string;
  mime: string | null;
  bytes: number;
  sha256: string;
  storageRuta: string | null;
  estado: EstadoDoc;
  version: number;
  clienteId: string | null;
  perfilId: string | null;
  perfilVersion: number | null;
  remitente: string | null;
  asunto: string | null;
  remitenteReconocido: boolean | null;
  textoExtracto: string | null;
  riesgoInyeccion: boolean;
  extraccion: ExtraccionGuardada | null;
  validacion: ResultadoValidacion | null;
  confianzaMin: number | null;
  nivelModelo: number | null;
  modelo: string | null;
  tokensIn: number;
  tokensOut: number;
  costoUsd: number;
  viajeId: string | null;
  procesandoHasta: string | null;
  intentos: number;
  ultimoError: string | null;
  abiertoEn: string | null;
  revisadoPor: string | null;
  aprobadoPor: string | null;
  aprobadoEn: string | null;
  rechazoMotivo: string | null;
  /** 0791. Solo se ESCRIBE (`tms_rechazo` al devolver un rechazo del TMS a revisión); `COLUMNAS_DOC` no la lee hasta que la 0791 esté en toda base. */
  rechazoCausa?: string | null;
  tiempoRevisionSeg: number | null;
  exportadoEn: string | null;
  retenerHasta: string;
  purgadoEn: string | null;
  createdAt: string;
  updatedAt: string;
}

export const COLUMNAS_DOC =
  'id, tenant_id, canal, formato, nombre_archivo, mime, bytes, sha256, storage_ruta, estado, version, cliente_id, perfil_id, perfil_version, '
  + 'remitente, asunto, remitente_reconocido, texto_extracto, riesgo_inyeccion, extraccion, validacion, confianza_min, nivel_modelo, modelo, '
  + 'tokens_in, tokens_out, costo_usd, viaje_id, procesando_hasta, intentos, ultimo_error, abierto_en, revisado_por, aprobado_por, aprobado_en, '
  + 'rechazo_motivo, tiempo_revision_seg, exportado_en, retener_hasta, purgado_en, created_at, updated_at';

/** La bandeja NO trae el texto ni la extracción (hasta 60 KB + decenas de KB por documento, ×200): eso solo lo lee la revisión. */
export const COLUMNAS_LISTA = COLUMNAS_DOC
  .replace(' texto_extracto,', '')
  .replace(' extraccion,', '');

type Fila = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function aDocumento(r: Fila): DocumentoFila {
  return {
    id: String(r.id), tenantId: String(r.tenant_id), canal: r.canal as CanalDoc, formato: r.formato as FormatoDoc,
    nombreArchivo: String(r.nombre_archivo), mime: s(r.mime), bytes: Number(r.bytes), sha256: String(r.sha256), storageRuta: s(r.storage_ruta),
    estado: r.estado as EstadoDoc, version: Number(r.version), clienteId: s(r.cliente_id), perfilId: s(r.perfil_id), perfilVersion: n(r.perfil_version),
    remitente: s(r.remitente), asunto: s(r.asunto), remitenteReconocido: r.remitente_reconocido === null || r.remitente_reconocido === undefined ? null : Boolean(r.remitente_reconocido),
    textoExtracto: s(r.texto_extracto), riesgoInyeccion: Boolean(r.riesgo_inyeccion),
    extraccion: (r.extraccion as ExtraccionGuardada | null) ?? null, validacion: (r.validacion as ResultadoValidacion | null) ?? null,
    confianzaMin: n(r.confianza_min), nivelModelo: n(r.nivel_modelo), modelo: s(r.modelo),
    tokensIn: Number(r.tokens_in ?? 0), tokensOut: Number(r.tokens_out ?? 0), costoUsd: Number(r.costo_usd ?? 0),
    viajeId: s(r.viaje_id), procesandoHasta: s(r.procesando_hasta), intentos: Number(r.intentos ?? 0), ultimoError: s(r.ultimo_error),
    abiertoEn: s(r.abierto_en), revisadoPor: s(r.revisado_por), aprobadoPor: s(r.aprobado_por), aprobadoEn: s(r.aprobado_en),
    rechazoMotivo: s(r.rechazo_motivo), tiempoRevisionSeg: n(r.tiempo_revision_seg), exportadoEn: s(r.exportado_en),
    retenerHasta: String(r.retener_hasta), purgadoEn: s(r.purgado_en), createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}

// ── Storage ─────────────────────────────────────────────────────────────────

export async function subirArchivo(ruta: string, bytes: Uint8Array, mime: string): Promise<void> {
  const res = await acotada(supabaseAdmin().storage.from(BUCKET).upload(ruta, aBuffer(bytes), { contentType: mime, upsert: true }), 'cpdocs.subir');
  if (res.error) throw new Error(`cartaporte_docs subir: ${res.error.message}`);
}

export async function descargarArchivo(ruta: string): Promise<Uint8Array> {
  const res = await acotada(supabaseAdmin().storage.from(BUCKET).download(ruta), 'cpdocs.descargar');
  if (res.error || !res.data) throw new Error(`cartaporte_docs descargar: ${res.error?.message ?? 'sin contenido'}`);
  return new Uint8Array(await res.data.arrayBuffer());
}

/** Firma la ruta. Lanza si no puede: una URL ausente no se reemplaza por nada. */
export async function firmarArchivo(ruta: string, ttlSegundos: number): Promise<string> {
  const res = await acotada(supabaseAdmin().storage.from(BUCKET).createSignedUrl(ruta, ttlSegundos), 'cpdocs.firmar');
  if (res.error || !res.data?.signedUrl) throw new Error(`cartaporte_docs firmar: ${res.error?.message ?? 'sin URL'}`);
  return res.data.signedUrl;
}

export async function borrarArchivo(ruta: string): Promise<void> {
  const res = await acotada(supabaseAdmin().storage.from(BUCKET).remove([ruta]), 'cpdocs.borrar');
  if (res.error) throw new Error(`cartaporte_docs borrar: ${res.error.message}`);
}

// ── Documentos ──────────────────────────────────────────────────────────────

export interface NuevoDocumento {
  id: string;
  canal: CanalDoc;
  formato: FormatoDoc;
  nombreArchivo: string;
  mime: string | null;
  bytes: number;
  sha256: string;
  storageRuta: string;
  clienteId: string | null;
  remitente: string | null;
  asunto: string | null;
  remitenteReconocido: boolean | null;
  retenerHasta: string;
}

export async function insertarDocumento(tenantId: string, d: NuevoDocumento): Promise<{ documento: DocumentoFila; duplicado: boolean }> {
  const res = await acotada(supabaseAdmin().from('cp_documento').insert({
    id: d.id, tenant_id: tenantId, canal: d.canal, formato: d.formato, nombre_archivo: d.nombreArchivo, mime: d.mime, bytes: d.bytes,
    sha256: d.sha256, storage_ruta: d.storageRuta, cliente_id: d.clienteId, remitente: d.remitente, asunto: d.asunto,
    remitente_reconocido: d.remitenteReconocido, retener_hasta: d.retenerHasta,
  }).select(COLUMNAS_DOC).single(), 'cpdocs.insertar');
  if (!res.error) return { documento: aDocumento(res.data as unknown as Fila), duplicado: false };
  // La misma huella en esta flota: el documento ya existe (el mismo archivo por otro canal, o un reintento).
  if ((res.error as { code?: string }).code === '23505') {
    const previo = await documentoPorHuella(tenantId, d.sha256);
    if (previo) return { documento: previo, duplicado: true };
  }
  throw new Error(`cartaporte_docs insertar: ${res.error.message}`);
}

export async function documentoPorHuella(tenantId: string, sha256: string): Promise<DocumentoFila | null> {
  const r = await acotada(supabaseAdmin().from('cp_documento').select(COLUMNAS_DOC)
    .eq('tenant_id', tenantId).eq('sha256', sha256).maybeSingle(), 'cpdocs.por_huella');
  const d = exigir(r, 'cpdocs.por_huella');
  return d ? aDocumento(d as unknown as Fila) : null;
}

export async function leerDocumento(tenantId: string, id: string): Promise<DocumentoFila | null> {
  const r = await acotada(supabaseAdmin().from('cp_documento').select(COLUMNAS_DOC)
    .eq('tenant_id', tenantId).eq('id', id).maybeSingle(), 'cpdocs.leer');
  const d = exigir(r, 'cpdocs.leer');
  return d ? aDocumento(d as unknown as Fila) : null;
}

export interface FiltroDocumentos {
  estados?: EstadoDoc[]; desde?: string; limite?: number;
  /** Con el texto y la extracción (la exportación los necesita); por omisión la lista es liviana. */
  completo?: boolean;
}

/** La bandeja: liviana por omisión (sin texto ni extracción), de lo más reciente a lo más antiguo. */
export async function listarDocumentos(tenantId: string, f: FiltroDocumentos = {}): Promise<{ filas: DocumentoFila[]; total: number }> {
  let q = supabaseAdmin().from('cp_documento').select(f.completo ? COLUMNAS_DOC : COLUMNAS_LISTA, { count: 'exact' }).eq('tenant_id', tenantId);
  if (f.estados && f.estados.length > 0) q = q.in('estado', f.estados);
  if (f.desde) q = q.gte('created_at', f.desde);
  const r = await acotada(q.order('created_at', { ascending: false }).order('id').limit(Math.min(f.limite ?? 100, 500)), 'cpdocs.listar');
  const filas = (exigir(r, 'cpdocs.listar') ?? []) as unknown as Fila[];
  return { filas: filas.map(aDocumento), total: r.count ?? filas.length };
}

/** El claim de procesamiento: `null` = otro lo tiene, ya se extrajo o agotó sus intentos. */
export async function reclamarDocumento(tenantId: string, id: string, leaseSegundos = 120): Promise<{ intentos: number; version: number } | null> {
  const r = await acotada(supabaseAdmin().rpc('cp_documento_reclamar', { p_tenant: tenantId, p_id: id, p_lease_segundos: leaseSegundos }), 'cpdocs.reclamar');
  const filas = (exigir(r, 'cpdocs.reclamar') ?? []) as Array<{ intentos: number; version: number }>;
  return filas[0] ? { intentos: Number(filas[0].intentos), version: Number(filas[0].version) } : null;
}

/** UPDATE condicional por versión. `null` = otro cambio llegó primero (o ya no es del tenant). */
export async function actualizarDocumento(
  tenantId: string, id: string, versionEsperada: number, cambios: Record<string, unknown>,
): Promise<DocumentoFila | null> {
  const r = await acotada(supabaseAdmin().from('cp_documento')
    .update({ ...cambios, version: versionEsperada + 1, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', id).eq('version', versionEsperada)
    .select(COLUMNAS_DOC), 'cpdocs.actualizar');
  const filas = (exigir(r, 'cpdocs.actualizar') ?? []) as unknown as Fila[];
  return filas[0] ? aDocumento(filas[0]) : null;
}

/** Escapa `\`, `%` y `_` para usar un valor literal como patrón de `ilike` (igualdad sin distinguir mayúsculas). */
const literalIlike = (v: string): string => v.trim().replace(/[\\%_]/g, (c) => `\\${c}`);

/** Otros documentos de la flota con el mismo folio de cliente (posible duplicado lógico). */
export async function documentosConFolio(tenantId: string, folio: string, exceptoId: string): Promise<Array<{ id: string; estado: EstadoDoc; nombreArchivo: string }>> {
  const r = await acotada(supabaseAdmin().from('cp_documento').select('id, estado, nombre_archivo')
    .eq('tenant_id', tenantId).ilike('extraccion->campos->folio_cliente->>valor', literalIlike(folio)).neq('id', exceptoId)
    .neq('estado', 'rechazado').order('id').limit(5), 'cpdocs.folio_duplicado');
  return ((exigir(r, 'cpdocs.folio_duplicado') ?? []) as unknown as Fila[]).map((f) => ({ id: String(f.id), estado: f.estado as EstadoDoc, nombreArchivo: String(f.nombre_archivo) }));
}

/**
 * Filas de `cp_sat_catalogo` (0793, tabla global) para las claves pedidas de UN catálogo: UNA consulta. `null` = el
 * catálogo no está cargado (ninguna fila con ese nombre) o no se pudo leer; nunca lanza, porque la validación degrada.
 */
export async function cargarCatalogoSat(catalogo: string, claves: string[]): Promise<Map<string, Record<string, string>> | null> {
  if (claves.length === 0) return new Map();
  try {
    const r = await acotada(supabaseAdmin().from('cp_sat_catalogo').select('clave, extra').eq('catalogo', catalogo).in('clave', claves), 'cpdocs.catalogo_sat');
    const filas = (exigir(r, 'cpdocs.catalogo_sat') ?? []) as unknown as Array<{ clave: string; extra: Record<string, string> | null }>;
    if (filas.length > 0) return new Map(filas.map((f) => [String(f.clave), f.extra ?? {}]));
    // Ninguna coincidencia: ¿el catálogo está vacío (no cargado) o la clave simplemente no existe? Una sola sonda más.
    const sonda = await acotada(supabaseAdmin().from('cp_sat_catalogo').select('clave').eq('catalogo', catalogo).limit(1), 'cpdocs.catalogo_sat_sonda');
    const hay = (exigir(sonda, 'cpdocs.catalogo_sat_sonda') ?? []) as unknown[];
    return hay.length > 0 ? new Map() : null;
  } catch {
    return null;
  }
}

export type TipoEvento =
  | 'recibido' | 'duplicado_recibido' | 'extraccion_iniciada' | 'extraccion_ok' | 'extraccion_fallida' | 'escalada' | 'revision_abierta'
  | 'campo_corregido' | 'aprobado' | 'rechazado' | 'reabierto' | 'salida_viaje' | 'exportado' | 'perfil_aprendido' | 'purgado'
  // 0642: el worker (cron carta-porte-docs).
  | 'aviso_oficina' | 'reintentos_agotados'
  // 0670: un Excel con varios embarques se partió en documentos hijos.
  | 'dividido'
  // 0790: el envío del documento aprobado a la plantilla/API del TMS.
  | 'envio_preparado' | 'envio_pendiente_reque' | 'envio_enviado' | 'envio_rechazado' | 'envio_error'
  | 'envio_alertado' | 'envio_subido_a_mano' | 'revisor_asignado';

/** La bitácora: append-only, sin el contenido de los campos. Un fallo AQUÍ se lanza: sin rastro no hay operación. */
export async function registrarEvento(tenantId: string, documentoId: string, tipo: TipoEvento, actorId: string | null, detalle: Record<string, unknown> = {}): Promise<void> {
  const r = await acotada(supabaseAdmin().from('cp_documento_evento')
    .insert({ tenant_id: tenantId, documento_id: documentoId, tipo, actor_id: actorId, detalle }), 'cpdocs.evento');
  if (r.error) throw new Error(`cartaporte_docs evento ${tipo}: ${r.error.message}`);
}

export async function listarEventos(tenantId: string, documentoId: string): Promise<Array<{ tipo: TipoEvento; actorId: string | null; detalle: Record<string, unknown>; creadoEn: string }>> {
  const r = await acotada(supabaseAdmin().from('cp_documento_evento').select('tipo, actor_id, detalle, created_at')
    .eq('tenant_id', tenantId).eq('documento_id', documentoId).order('id', { ascending: true }).limit(200), 'cpdocs.eventos');
  return ((exigir(r, 'cpdocs.eventos') ?? []) as unknown as Fila[]).map((f) => ({ tipo: f.tipo as TipoEvento, actorId: s(f.actor_id), detalle: (f.detalle as Record<string, unknown>) ?? {}, creadoEn: String(f.created_at) }));
}

export interface CorreccionFila { campo: string; renglon: number | null; valorAntes: string | null; valorDespues: string | null }

export async function registrarCorrecciones(tenantId: string, documentoId: string, actorId: string | null, filas: CorreccionFila[]): Promise<void> {
  if (filas.length === 0) return;
  const r = await acotada(supabaseAdmin().from('cp_correccion').insert(filas.map((f) => ({
    tenant_id: tenantId, documento_id: documentoId, actor_id: actorId, campo: f.campo, renglon: f.renglon,
    valor_antes: f.valorAntes?.slice(0, 500) ?? null, valor_despues: f.valorDespues?.slice(0, 500) ?? null,
  }))), 'cpdocs.correcciones');
  if (r.error) throw new Error(`cartaporte_docs correcciones: ${r.error.message}`);
}

export async function contarCorreccionesPorDocumento(tenantId: string, ids: string[]): Promise<Map<string, number>> {
  const cuenta = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const r = await acotada(supabaseAdmin().from('cp_correccion').select('documento_id')
      .eq('tenant_id', tenantId).in('documento_id', ids.slice(i, i + 200)).order('id').limit(50_000), 'cpdocs.contar_correcciones');
    for (const f of (exigir(r, 'cpdocs.contar_correcciones') ?? []) as unknown as Fila[]) cuenta.set(String(f.documento_id), (cuenta.get(String(f.documento_id)) ?? 0) + 1);
  }
  return cuenta;
}

// ── Buzón de correo ─────────────────────────────────────────────────────────

export interface BuzonFila { tenantId: string; token: string; activo: boolean; remitentesPermitidos: string[] }

const aBuzon = (f: Fila): BuzonFila => ({ tenantId: String(f.tenant_id), token: String(f.token), activo: Boolean(f.activo), remitentesPermitidos: Array.isArray(f.remitentes_permitidos) ? (f.remitentes_permitidos as string[]) : [] });

export async function buzonDeFlota(tenantId: string): Promise<BuzonFila | null> {
  const r = await acotada(supabaseAdmin().from('cp_buzon').select('tenant_id, token, activo, remitentes_permitidos').eq('tenant_id', tenantId).maybeSingle(), 'cpdocs.buzon_flota');
  const f = exigir(r, 'cpdocs.buzon_flota');
  return f ? aBuzon(f as unknown as Fila) : null;
}

/** La flota dueña de un token de buzón. Va SIN tenant porque justo de aquí sale el tenant. */
export async function buzonPorToken(token: string): Promise<BuzonFila | null> {
  const r = await acotada(supabaseAdmin().from('cp_buzon').select('tenant_id, token, activo, remitentes_permitidos').eq('token', token).maybeSingle(), 'cpdocs.buzon_token');
  const f = exigir(r, 'cpdocs.buzon_token');
  return f ? aBuzon(f as unknown as Fila) : null;
}

export async function crearBuzon(tenantId: string, token: string): Promise<BuzonFila> {
  const r = await acotada(supabaseAdmin().from('cp_buzon').insert({ tenant_id: tenantId, token }).select('tenant_id, token, activo, remitentes_permitidos').single(), 'cpdocs.buzon_crear');
  if (r.error) {
    if ((r.error as { code?: string }).code === '23505') { const ya = await buzonDeFlota(tenantId); if (ya) return ya; }
    throw new Error(`cartaporte_docs buzón: ${r.error.message}`);
  }
  return aBuzon(r.data as unknown as Fila);
}

export async function configurarBuzon(tenantId: string, cambios: { activo?: boolean; remitentesPermitidos?: string[]; token?: string }): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (cambios.activo !== undefined) patch.activo = cambios.activo;
  if (cambios.remitentesPermitidos) patch.remitentes_permitidos = cambios.remitentesPermitidos;
  if (cambios.token) patch.token = cambios.token;
  const r = await acotada(supabaseAdmin().from('cp_buzon').update(patch).eq('tenant_id', tenantId).select('tenant_id'), 'cpdocs.buzon_config');
  const filas = (exigir(r, 'cpdocs.buzon_config') ?? []) as unknown[];
  if (filas.length === 0) throw new Error('cartaporte_docs buzón: la flota no tiene buzón');
}

// ── Perfiles ────────────────────────────────────────────────────────────────

export interface PerfilFila extends Perfil { creadaEn: string }

/** Los perfiles de la flota con su versión ACTIVA (dos consultas, no un join: la versión se elige por `version_activa`). */
export async function listarPerfiles(tenantId: string): Promise<PerfilFila[]> {
  const p = await acotada(supabaseAdmin().from('cp_perfil')
    .select('id, clave, nombre, cliente_id, formato, firma, version_activa, created_at').eq('tenant_id', tenantId).order('updated_at', { ascending: false }).order('id').limit(200), 'cpdocs.perfiles');
  const perfiles = (exigir(p, 'cpdocs.perfiles') ?? []) as unknown as Fila[];
  if (perfiles.length === 0) return [];
  // A37-S32-07: solo la versión ACTIVA de cada perfil (antes: TODAS las versiones con tope de 5000, y los perfiles de ids altos
  // perdían la suya sin error). Se agrupa por número de versión activa: una consulta por cada versión distinta, con `perfil_id in (...)`.
  const porVersion = new Map<number, string[]>();
  for (const x of perfiles) {
    const n = Number(x.version_activa);
    porVersion.set(n, [...(porVersion.get(n) ?? []), String(x.id)]);
  }
  const versiones: Fila[] = [];
  for (const [n, ids] of porVersion) {
    const v = await acotada(supabaseAdmin().from('cp_perfil_version')
      .select('perfil_id, version, mapeos, ejemplos, nota').eq('tenant_id', tenantId).eq('version', n).in('perfil_id', ids)
      // orden-no-importa: (perfil_id, version) es único y `version` va fijo; a lo más una fila por perfil y ids ≤ 200 (tope de perfiles)
      .limit(200), 'cpdocs.perfil_versiones');
    versiones.push(...((exigir(v, 'cpdocs.perfil_versiones') ?? []) as unknown as Fila[]));
  }
  const sinActiva = perfiles.filter((x) => !versiones.some((y) => String(y.perfil_id) === String(x.id)));
  if (sinActiva.length > 0) logger.warn('cpdocs.perfiles_sin_version_activa', { tenantId, n: sinActiva.length });
  return perfiles.flatMap((x) => {
    const act = versiones.find((y) => String(y.perfil_id) === String(x.id) && Number(y.version) === Number(x.version_activa));
    if (!act) return []; // un perfil sin su versión activa no se aplica
    return [{
      id: String(x.id), clave: String(x.clave), nombre: String(x.nombre), clienteId: s(x.cliente_id), formato: x.formato as FormatoDoc,
      firma: (x.firma as FirmaPerfil) ?? { formato: x.formato as FormatoDoc }, versionActiva: Number(x.version_activa), creadaEn: String(x.created_at),
      activa: { version: Number(act.version), mapeos: (act.mapeos as Mapeo[]) ?? [], ejemplos: (act.ejemplos as EjemploPerfil[]) ?? [], nota: s(act.nota) },
    }];
  });
}

export async function listarVersionesPerfil(tenantId: string, perfilId: string): Promise<Array<{ version: number; nota: string | null; mapeos: number; creadaEn: string }>> {
  const r = await acotada(supabaseAdmin().from('cp_perfil_version').select('version, nota, mapeos, created_at')
    // orden-no-importa: la llave es (perfil_id, version) y perfil_id va fijo; version no se repite
    .eq('tenant_id', tenantId).eq('perfil_id', perfilId).order('version', { ascending: false }).limit(100), 'cpdocs.perfil_hist');
  return ((exigir(r, 'cpdocs.perfil_hist') ?? []) as unknown as Fila[]).map((f) => ({ version: Number(f.version), nota: s(f.nota), mapeos: Array.isArray(f.mapeos) ? f.mapeos.length : 0, creadaEn: String(f.created_at) }));
}

/** Crea el perfil con su versión 1. La clave es única por flota: si ya existe, `null`. */
export async function crearPerfil(
  tenantId: string,
  p: { clave: string; nombre: string; clienteId: string | null; formato: FormatoDoc; firma: FirmaPerfil; mapeos: Mapeo[]; ejemplos: EjemploPerfil[]; nota: string | null; documentoId: string | null; actorId: string | null },
): Promise<string | null> {
  const r = await acotada(supabaseAdmin().from('cp_perfil').insert({
    tenant_id: tenantId, clave: p.clave, nombre: p.nombre, cliente_id: p.clienteId, formato: p.formato, firma: p.firma, version_activa: 1,
  }).select('id').single(), 'cpdocs.perfil_crear');
  if (r.error) {
    if ((r.error as { code?: string }).code === '23505') return null;
    throw new Error(`cartaporte_docs perfil: ${r.error.message}`);
  }
  const id = String((r.data as unknown as Fila).id);
  const v = await acotada(supabaseAdmin().from('cp_perfil_version').insert({
    tenant_id: tenantId, perfil_id: id, version: 1, mapeos: p.mapeos, ejemplos: p.ejemplos, nota: p.nota, origen_documento_id: p.documentoId, creada_por: p.actorId,
  }), 'cpdocs.perfil_v1');
  if (v.error) throw new Error(`cartaporte_docs perfil v1: ${v.error.message}`);
  return id;
}

/** Crea la versión SIGUIENTE (las versiones no se editan) y la activa. `null` = otro la creó primero. */
export async function crearVersionPerfil(
  tenantId: string, perfilId: string, versionBase: number,
  v: { mapeos: Mapeo[]; ejemplos: EjemploPerfil[]; nota: string | null; documentoId: string | null; actorId: string | null },
): Promise<number | null> {
  const nueva = versionBase + 1;
  const ins = await acotada(supabaseAdmin().from('cp_perfil_version').insert({
    tenant_id: tenantId, perfil_id: perfilId, version: nueva, mapeos: v.mapeos, ejemplos: v.ejemplos, nota: v.nota, origen_documento_id: v.documentoId, creada_por: v.actorId,
  }), 'cpdocs.perfil_version');
  if (ins.error) {
    if ((ins.error as { code?: string }).code === '23505') return null;
    throw new Error(`cartaporte_docs perfil versión: ${ins.error.message}`);
  }
  // La activa solo avanza si SEGUÍA en la versión base (dos aprobaciones simultáneas no se pisan).
  const act = await acotada(supabaseAdmin().from('cp_perfil').update({ version_activa: nueva, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', perfilId).eq('version_activa', versionBase).select('id'), 'cpdocs.perfil_activar');
  const filas = (exigir(act, 'cpdocs.perfil_activar') ?? []) as unknown[];
  return filas.length > 0 ? nueva : null;
}

/** Vuelve a una versión anterior: solo apunta `version_activa`, no edita nada. */
export async function activarVersionPerfil(tenantId: string, perfilId: string, version: number): Promise<boolean> {
  const existe = await acotada(supabaseAdmin().from('cp_perfil_version').select('version').eq('tenant_id', tenantId).eq('perfil_id', perfilId).eq('version', version).maybeSingle(), 'cpdocs.perfil_existe');
  if (!exigir(existe, 'cpdocs.perfil_existe')) return false;
  const r = await acotada(supabaseAdmin().from('cp_perfil').update({ version_activa: version, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', perfilId).select('id'), 'cpdocs.perfil_volver');
  return ((exigir(r, 'cpdocs.perfil_volver') ?? []) as unknown[]).length > 0;
}

// ── Configuraciones de exportación ──────────────────────────────────────────

export interface ExportConfigFila { id: string; nombre: string; formato: 'csv' | 'json'; config: Record<string, unknown>; activa: boolean }

export async function listarExportConfigs(tenantId: string): Promise<ExportConfigFila[]> {
  const r = await acotada(supabaseAdmin().from('cp_export_config').select('id, nombre, formato, config, activa').eq('tenant_id', tenantId).order('nombre').order('id').limit(50), 'cpdocs.export_configs');
  return ((exigir(r, 'cpdocs.export_configs') ?? []) as unknown as Fila[]).map((f) => ({ id: String(f.id), nombre: String(f.nombre), formato: f.formato as 'csv' | 'json', config: (f.config as Record<string, unknown>) ?? {}, activa: Boolean(f.activa) }));
}

export async function guardarExportConfig(tenantId: string, c: { nombre: string; formato: 'csv' | 'json'; config: Record<string, unknown> }): Promise<void> {
  const r = await acotada(supabaseAdmin().from('cp_export_config')
    .upsert({ tenant_id: tenantId, nombre: c.nombre, formato: c.formato, config: c.config, activa: true, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,nombre' }), 'cpdocs.export_guardar');
  if (r.error) throw new Error(`cartaporte_docs export config: ${r.error.message}`);
}

export async function borrarExportConfig(tenantId: string, id: string): Promise<void> {
  const r = await acotada(supabaseAdmin().from('cp_export_config').delete().eq('tenant_id', tenantId).eq('id', id), 'cpdocs.export_borrar');
  if (r.error) throw new Error(`cartaporte_docs export borrar: ${r.error.message}`);
}

// ── Viajes (salida al formato interno) ──────────────────────────────────────

export interface ViajeMin {
  id: string; folio: string | null; origen: string | null; destino: string | null; fechaInicio: string | null; kmRecorridos: number | null;
  operadorId: string; unidadId: string | null; clienteId: string | null;
  ccpOrigenCp: string | null; ccpDestinoCp: string | null; ccpOrigenEstado: string | null; ccpDestinoEstado: string | null; ccpRfcDestinatario: string | null; ccpTranspInternac: boolean | null;
  estatus: string;
}

const COL_VIAJE = 'id, folio, origen, destino, fecha_inicio, km_recorridos, operador_id, unidad_id, cliente_id, ccp_origen_cp, ccp_destino_cp, ccp_origen_estado, ccp_destino_estado, ccp_rfc_destinatario, ccp_transp_internac, estatus';
const aViaje = (f: Fila): ViajeMin => ({
  id: String(f.id), folio: s(f.folio), origen: s(f.origen), destino: s(f.destino), fechaInicio: s(f.fecha_inicio), kmRecorridos: n(f.km_recorridos),
  operadorId: String(f.operador_id), unidadId: s(f.unidad_id), clienteId: s(f.cliente_id),
  ccpOrigenCp: s(f.ccp_origen_cp), ccpDestinoCp: s(f.ccp_destino_cp), ccpOrigenEstado: s(f.ccp_origen_estado), ccpDestinoEstado: s(f.ccp_destino_estado),
  ccpRfcDestinatario: s(f.ccp_rfc_destinatario), ccpTranspInternac: f.ccp_transp_internac === null || f.ccp_transp_internac === undefined ? null : Boolean(f.ccp_transp_internac),
  estatus: String(f.estatus),
});

export async function viajePorFolio(tenantId: string, folio: string): Promise<ViajeMin | null> {
  // A37-S33-04: la base unifica el folio SIN distinguir mayúsculas (`viaje_folio_upper_uidx` sobre `upper(folio)`): la búsqueda también.
  const r = await acotada(supabaseAdmin().from('viaje').select(COL_VIAJE).eq('tenant_id', tenantId).ilike('folio', literalIlike(folio)).maybeSingle(), 'cpdocs.viaje_folio');
  const f = exigir(r, 'cpdocs.viaje_folio');
  return f ? aViaje(f as unknown as Fila) : null;
}

export async function viajePorId(tenantId: string, id: string): Promise<ViajeMin | null> {
  const r = await acotada(supabaseAdmin().from('viaje').select(COL_VIAJE).eq('tenant_id', tenantId).eq('id', id).maybeSingle(), 'cpdocs.viaje_id');
  const f = exigir(r, 'cpdocs.viaje_id');
  return f ? aViaje(f as unknown as Fila) : null;
}

export interface OperadorMin { id: string; nombre: string; activo: boolean }

export async function operadoresDeFlota(tenantId: string): Promise<OperadorMin[]> {
  const r = await acotada(supabaseAdmin().from('operador').select('id, nombre, activo').eq('tenant_id', tenantId).order('nombre').order('id').limit(2000), 'cpdocs.operadores');
  return ((exigir(r, 'cpdocs.operadores') ?? []) as unknown as Fila[]).map((f) => ({ id: String(f.id), nombre: String(f.nombre), activo: f.activo !== false }));
}

export async function unidadesPorPlacas(tenantId: string, placas: string): Promise<Array<{ id: string; activo: boolean }>> {
  const r = await acotada(supabaseAdmin().from('unidad').select('id, activo').eq('tenant_id', tenantId).ilike('placas', placas).order('id').limit(3), 'cpdocs.unidad_placas');
  return ((exigir(r, 'cpdocs.unidad_placas') ?? []) as unknown as Fila[]).map((f) => ({ id: String(f.id), activo: f.activo !== false }));
}

export async function viajeAbiertoDeOperador(tenantId: string, operadorId: string): Promise<{ id: string; folio: string | null } | null> {
  const r = await acotada(supabaseAdmin().from('viaje').select('id, folio').eq('tenant_id', tenantId).eq('operador_id', operadorId).in('estatus', ['abierto', 'en_cuadre']).order('id').limit(1), 'cpdocs.viaje_abierto');
  const f = ((exigir(r, 'cpdocs.viaje_abierto') ?? []) as unknown as Fila[])[0];
  return f ? { id: String(f.id), folio: s(f.folio) } : null;
}

/** ¿La unidad ya tiene un viaje abierto o en cuadre? (`uq_viaje_abierto_por_unidad`: un insert más chocaría con 23505). */
export async function unidadConViajeAbierto(tenantId: string, unidadId: string): Promise<boolean> {
  const r = await acotada(supabaseAdmin().from('viaje').select('id').eq('tenant_id', tenantId).eq('unidad_id', unidadId).in('estatus', ['abierto', 'en_cuadre']).order('id').limit(1), 'cpdocs.viaje_unidad_abierto');
  return ((exigir(r, 'cpdocs.viaje_unidad_abierto') ?? []) as unknown[]).length > 0;
}

export async function clientePropio(tenantId: string, clienteId: string): Promise<boolean> {
  const r = await acotada(supabaseAdmin().from('cliente').select('id').eq('tenant_id', tenantId).eq('id', clienteId).maybeSingle(), 'cpdocs.cliente');
  return !!exigir(r, 'cpdocs.cliente');
}

export async function listarClientes(tenantId: string): Promise<Array<{ id: string; nombre: string }>> {
  const r = await acotada(supabaseAdmin().from('cliente').select('id, nombre').eq('tenant_id', tenantId).order('nombre').order('id').limit(1000), 'cpdocs.clientes');
  return ((exigir(r, 'cpdocs.clientes') ?? []) as unknown as Fila[]).map((f) => ({ id: String(f.id), nombre: String(f.nombre) }));
}

// ── Catálogo por cliente (0792) ─────────────────────────────────────────────

/** La tabla no existe todavía (la 0792 no se ha aplicado): PostgREST PGRST205 / Postgres 42P01. */
export function tablaAusente(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST205' || error.code === '42P01' || /could not find the table|relation .* does not exist/i.test(error.message ?? '');
}


/**
 * El catálogo de UN cliente de UNA flota: número interno, productos y partes, con tope de filas por tabla. Siempre
 * filtra por tenant Y cliente. Sin la 0792 aplicada devuelve el catálogo vacío (sin catálogo = no-op) y lo registra.
 */
export async function cargarCatalogoCliente(tenantId: string, clienteId: string): Promise<CatalogoCliente> {
  const [n, p, q] = await Promise.all([
    acotada(supabaseAdmin().from('cp_cliente_numero').select('numero_interno, numero_pagador, activo').eq('tenant_id', tenantId).eq('cliente_id', clienteId).maybeSingle(), 'cpdocs.catalogo_numero'),
    acotada(supabaseAdmin().from('cp_catalogo_producto')
      .select('sku, descripcion_patron, bienes_transp, clave_unidad, embalaje, fraccion, tipo_materia, material_peligroso, clave_material_peligroso')
      .eq('tenant_id', tenantId).eq('cliente_id', clienteId).order('sku').order('id').limit(TOPE_FILAS_CATALOGO), 'cpdocs.catalogo_productos'),
    acotada(supabaseAdmin().from('cp_catalogo_parte')
      .select('rol, alias, razon_social, rfc, id_fiscal_extranjero, calle, num_ext, num_int, colonia_clave, colonia, cp, localidad_clave, localidad, municipio_clave, municipio, estado, pais, contacto, telefono, correo')
      .eq('tenant_id', tenantId).eq('cliente_id', clienteId).order('rol').order('alias').order('id').limit(TOPE_FILAS_CATALOGO), 'cpdocs.catalogo_partes'),
  ]);
  if (tablaAusente(n.error) || tablaAusente(p.error) || tablaAusente(q.error)) {
    logger.warn('cartaporte_docs.catalogo_sin_migracion', { tenantId });
    return catalogoVacio();
  }
  const num = exigir(n, 'cpdocs.catalogo_numero') as unknown as Fila | null;
  const productos = ((exigir(p, 'cpdocs.catalogo_productos') ?? []) as unknown as Fila[]).map((f): ProductoCat => ({
    tenantId, clienteId, sku: String(f.sku), descripcionPatron: s(f.descripcion_patron), bienesTransp: String(f.bienes_transp), claveUnidad: String(f.clave_unidad),
    embalaje: s(f.embalaje), fraccion: s(f.fraccion), tipoMateria: s(f.tipo_materia), materialPeligroso: f.material_peligroso === true, claveMaterialPeligroso: s(f.clave_material_peligroso),
  }));
  const partes = ((exigir(q, 'cpdocs.catalogo_partes') ?? []) as unknown as Fila[]).map((f): ParteCat => ({
    tenantId, clienteId, rol: f.rol === 'destinatario' ? 'destinatario' : 'remitente', alias: String(f.alias), razonSocial: s(f.razon_social), rfc: s(f.rfc), idFiscalExtranjero: s(f.id_fiscal_extranjero),
    calle: s(f.calle), numExt: s(f.num_ext), numInt: s(f.num_int), coloniaClave: s(f.colonia_clave), colonia: s(f.colonia), cp: s(f.cp),
    localidadClave: s(f.localidad_clave), localidad: s(f.localidad), municipioClave: s(f.municipio_clave), municipio: s(f.municipio),
    estado: s(f.estado), pais: s(f.pais), contacto: s(f.contacto), telefono: s(f.telefono), correo: s(f.correo),
  }));
  const truncado = productos.length >= TOPE_FILAS_CATALOGO || partes.length >= TOPE_FILAS_CATALOGO;
  if (truncado) logger.warn('cartaporte_docs.catalogo_truncado', { tenantId, productos: productos.length, partes: partes.length });
  return {
    numero: num ? { tenantId, clienteId, numeroInterno: String(num.numero_interno), numeroPagador: s(num.numero_pagador), activo: num.activo !== false } : null,
    productos, partes, truncado,
  };
}

/** Inserta el viaje borrador. `null` = el folio ya existe (carrera con otra aprobación o con el panel). */
export async function insertarViaje(tenantId: string, v: {
  folio: string; origen: string | null; destino: string | null; fechaInicio: string | null; kmRecorridos: number | null;
  operadorId: string; unidadId: string | null; clienteId: string | null;
  ccp: { origenCp: string | null; destinoCp: string | null; origenEstado: string | null; destinoEstado: string | null; rfcDestinatario: string | null; transpInternac: boolean | null };
}): Promise<string | null> {
  const r = await acotada(supabaseAdmin().from('viaje').insert({
    tenant_id: tenantId, folio: v.folio, origen: v.origen, destino: v.destino, fecha_inicio: v.fechaInicio, anticipo: 0,
    operador_id: v.operadorId, unidad_id: v.unidadId, cliente_id: v.clienteId, km_recorridos: v.kmRecorridos, estatus: 'abierto',
    ccp_origen_cp: v.ccp.origenCp, ccp_destino_cp: v.ccp.destinoCp, ccp_origen_estado: v.ccp.origenEstado, ccp_destino_estado: v.ccp.destinoEstado,
    ccp_rfc_destinatario: v.ccp.rfcDestinatario, ccp_transp_internac: v.ccp.transpInternac,
  }).select('id').single(), 'cpdocs.viaje_insertar');
  if (r.error) {
    const code = (r.error as { code?: string }).code;
    if (code === '23505') return null;
    throw Object.assign(new Error(`cartaporte_docs viaje: ${r.error.message}`), { code });
  }
  return String((r.data as unknown as Fila).id);
}

/** Completa SOLO los huecos (columnas nulas) de un viaje existente. Devuelve cuántas columnas llenó. */
export async function completarHuecosViaje(tenantId: string, viajeId: string, huecos: Record<string, unknown>): Promise<number> {
  const claves = Object.keys(huecos);
  if (claves.length === 0) return 0;
  let llenas = 0;
  // Una columna a la vez, con `is null` en el WHERE: lo que otro escribió entre la lectura y esta línea no se pisa.
  for (const k of claves) {
    const r = await acotada(supabaseAdmin().from('viaje').update({ [k]: huecos[k] }).eq('tenant_id', tenantId).eq('id', viajeId).is(k, null).select('id'), `cpdocs.viaje_hueco.${k}`);
    llenas += ((exigir(r, `cpdocs.viaje_hueco.${k}`) ?? []) as unknown[]).length;
  }
  return llenas;
}

export interface MercanciaInsertar {
  descripcion: string; bienesTransp: string | null; cantidad: number; claveUnidad: string | null; pesoKg: number | null; materialPeligroso: boolean | null;
}

/** Reemplaza los renglones que NACIERON de este documento (los capturados a mano no se tocan). */
export async function reemplazarMercanciasDeDocumento(tenantId: string, viajeId: string, documentoId: string, filas: MercanciaInsertar[]): Promise<number> {
  const del = await acotada(supabaseAdmin().from('viaje_mercancia').delete().eq('tenant_id', tenantId).eq('viaje_id', viajeId).eq('cp_documento_id', documentoId), 'cpdocs.merc_borrar');
  if (del.error) throw new Error(`cartaporte_docs mercancía borrar: ${del.error.message}`);
  if (filas.length === 0) return 0;
  const ins = await acotada(supabaseAdmin().from('viaje_mercancia').insert(filas.map((m) => ({
    tenant_id: tenantId, viaje_id: viajeId, cp_documento_id: documentoId, descripcion: m.descripcion, bienes_transp: m.bienesTransp,
    cantidad: m.cantidad, clave_unidad: m.claveUnidad, peso_kg: m.pesoKg, material_peligroso: m.materialPeligroso,
  }))).select('id'), 'cpdocs.merc_insertar');
  return ((exigir(ins, 'cpdocs.merc_insertar') ?? []) as unknown[]).length;
}

/** Liga el documento aprobado con su viaje (no cambia la versión de la revisión: la revisión ya terminó). */
export async function vincularViaje(tenantId: string, id: string, viajeId: string): Promise<void> {
  const r = await acotada(supabaseAdmin().from('cp_documento').update({ viaje_id: viajeId, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', id).select('id'), 'cpdocs.vincular_viaje');
  if (((exigir(r, 'cpdocs.vincular_viaje') ?? []) as unknown[]).length === 0) throw new Error('cartaporte_docs vincular: el documento ya no existe');
}

/** Sella que el documento salió en una exportación (la última gana). No toca la versión de la revisión. */
export async function marcarExportado(tenantId: string, ids: string[], ahora = new Date()): Promise<number> {
  if (ids.length === 0) return 0;
  const r = await acotada(supabaseAdmin().from('cp_documento').update({ exportado_en: ahora.toISOString(), updated_at: ahora.toISOString() })
    .eq('tenant_id', tenantId).eq('estado', 'aprobado').in('id', ids).select('id'), 'cpdocs.exportado');
  return ((exigir(r, 'cpdocs.exportado') ?? []) as unknown[]).length;
}

// ── El claim de un correo entrante (rpc 0177, compartida con el buzón de facturas) ──

export type ClaimCorreo = { resultado: 'applied' } | { resultado: 'claimed'; token: string } | { resultado: 'busy' };

/** Un correo (email_id de Resend) se procesa UNA vez: `applied` = ya se aplicó; `busy` = otra entrega lo tiene. */
export async function reclamarCorreo(emailId: string, leaseSegundos = 90): Promise<ClaimCorreo> {
  const r = await acotada(supabaseAdmin().rpc('reclamar_correo', { p_email_id: emailId, p_lease_seconds: leaseSegundos }), 'cpdocs.reclamar_correo');
  const f = ((exigir(r, 'cpdocs.reclamar_correo') ?? []) as Array<{ resultado?: string; token?: string | null }>)[0];
  if (f?.resultado === 'applied') return { resultado: 'applied' };
  if (f?.resultado === 'claimed' && f.token) return { resultado: 'claimed', token: f.token };
  return { resultado: 'busy' };
}

export async function finalizarCorreo(emailId: string, token: string, ok: boolean, error?: string): Promise<boolean> {
  const r = await acotada(supabaseAdmin().rpc('finalizar_correo', { p_email_id: emailId, p_token: token, p_ok: ok, p_error: error ?? null }), 'cpdocs.finalizar_correo');
  return !r.error && r.data === true;
}

/** Borra el documento (la cascada se lleva sus eventos y correcciones; los renglones de mercancía quedan, sin la liga). */
export async function borrarDocumento(tenantId: string, id: string): Promise<boolean> {
  const r = await acotada(supabaseAdmin().from('cp_documento').delete().eq('tenant_id', tenantId).eq('id', id).select('id'), 'cpdocs.borrar_doc');
  return ((exigir(r, 'cpdocs.borrar_doc') ?? []) as unknown[]).length > 0;
}

// ── Retención ───────────────────────────────────────────────────────────────

export async function documentosVencidos(limite = 100): Promise<Array<{ id: string; tenantId: string; storageRuta: string | null }>> {
  const r = await acotada(supabaseAdmin().rpc('cp_documentos_vencidos', { p_limite: limite }), 'cpdocs.vencidos');
  return ((exigir(r, 'cpdocs.vencidos') ?? []) as unknown as Fila[]).map((f) => ({ id: String(f.id), tenantId: String(f.tenant_id), storageRuta: s(f.storage_ruta) }));
}

/** Marca la purga: sin archivo ni texto. La fila queda como constancia. Condicional a que NO se haya purgado ya. */
export async function marcarPurgado(tenantId: string, id: string): Promise<boolean> {
  const r = await acotada(supabaseAdmin().from('cp_documento')
    .update({ storage_ruta: null, texto_extracto: null, purgado_en: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', id).is('purgado_en', null).select('id'), 'cpdocs.purgar');
  return ((exigir(r, 'cpdocs.purgar') ?? []) as unknown[]).length > 0;
}

// ── El worker de la bandeja (cron carta-porte-docs, 0640-0642) ──────────────
//
// Las RPC de la 0641 ELIGEN qué toca; el claim sigue siendo `cp_documento_reclamar` (0420). Todo funciona contra
// una base SIN la 0641: la elección cae a una consulta directa con la misma regla (espera creciente incluida) y
// los avisos a la oficina quedan APAGADOS (sin el candado atómico repetirían el mensaje en cada pasada).

/** Los intentos tras los cuales un documento fallido es terminal (el mismo 5 de `cp_documento_reclamar`). */
export const TOPE_INTENTOS_DOC = 5;
/** Un recibido más joven que esto lo está atendiendo la petición que lo recibió (correo, WhatsApp). */
export const GRACIA_RECIBIDO_SEG = 120;
/** Minutos de espera de un fallido según los intentos que lleva (15, 30, 60, 120...). Espeja la 0641. */
export const esperaFallidoMin = (intentos: number): number => 15 * 2 ** Math.max(Math.min(intentos, 6) - 1, 0);
/** Los avisos a la oficina que el worker reclama (una vez por documento y tipo). */
export type TipoAvisoDoc = 'hallazgos' | 'agotado';

export interface DocPendiente { tenantId: string; id: string; estado: EstadoDoc; intentos: number }

/** PostgREST/Postgres dicen que la función no existe (la migración no se ha aplicado): PGRST202 / 42883. */
export function funcionAusente(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST202' || error.code === '42883'
    || /could not find the function|function .* does not exist|schema cache/i.test(error.message ?? '');
}

/** Lo que el cron debe procesar ya: recibidos (con gracia), lease vencido y fallidos reintentables. */
export async function documentosPendientes(limite = 25, ahora = new Date()): Promise<DocPendiente[]> {
  const r = await acotada(supabaseAdmin().rpc('cp_documentos_pendientes', { p_limite: limite, p_max_intentos: TOPE_INTENTOS_DOC, p_gracia_segundos: GRACIA_RECIBIDO_SEG }), 'cpdocs.pendientes');
  if (!r.error) {
    return ((r.data ?? []) as unknown as Fila[]).map((f) => ({ tenantId: String(f.tenant_id), id: String(f.id), estado: f.estado as EstadoDoc, intentos: Number(f.intentos ?? 0) }));
  }
  if (!funcionAusente(r.error)) throw new Error(`cpdocs.pendientes: ${r.error.message}`);

  // Sin la 0641: la misma regla por consulta directa (cruza flotas A PROPÓSITO: es el barrido del cron; cada fila
  // trae su tenant_id y todo lo que se hace después con ella va anclado a ESE tenant).
  logger.warn('cartaporte_docs.pendientes_sin_rpc', { motivo: r.error.message });
  const t = ahora.getTime();
  const c = await acotada(supabaseAdmin().from('cp_documento')
    .select('tenant_id, id, estado, intentos, created_at, updated_at, procesando_hasta')
    .is('purgado_en', null).not('storage_ruta', 'is', null).lt('intentos', TOPE_INTENTOS_DOC).in('estado', ['recibido', 'procesando', 'fallido'])
    .order('updated_at', { ascending: true }).order('id').limit(limite * 4), 'cpdocs.pendientes_directo');
  const filas = (exigir(c, 'cpdocs.pendientes_directo') ?? []) as unknown as Fila[];
  const toca = (f: Fila): boolean => {
    const estado = f.estado as EstadoDoc;
    if (estado === 'recibido') return t - new Date(String(f.created_at)).getTime() > GRACIA_RECIBIDO_SEG * 1000;
    if (estado === 'procesando') return f.procesando_hasta !== null && new Date(String(f.procesando_hasta)).getTime() < t;
    return t - new Date(String(f.updated_at)).getTime() > esperaFallidoMin(Number(f.intentos ?? 0)) * 60_000;
  };
  const orden = { recibido: 0, procesando: 1, fallido: 2 } as Record<string, number>;
  return filas.filter(toca)
    .sort((a, b) => (orden[String(a.estado)] ?? 3) - (orden[String(b.estado)] ?? 3))
    .slice(0, limite)
    .map((f) => ({ tenantId: String(f.tenant_id), id: String(f.id), estado: f.estado as EstadoDoc, intentos: Number(f.intentos ?? 0) }));
}

/** Resultado de pedir una lista de avisos: `null` = la base no tiene la 0641 (los avisos quedan apagados). */
async function listaDeAviso(rpc: string, args: Record<string, unknown>, etiqueta: string): Promise<Array<{ tenantId: string; id: string }> | null> {
  const r = await acotada(supabaseAdmin().rpc(rpc, args), etiqueta);
  if (r.error) {
    if (funcionAusente(r.error)) { logger.warn('cartaporte_docs.aviso_sin_migracion', { rpc }); return null; }
    throw new Error(`${etiqueta}: ${r.error.message}`);
  }
  return ((r.data ?? []) as unknown as Fila[]).map((f) => ({ tenantId: String(f.tenant_id), id: String(f.id) }));
}

/** Fallidos con los intentos agotados (terminales) cuya noticia a la oficina no se ha reclamado. */
export const documentosAgotados = (limite = 25) =>
  listaDeAviso('cp_documentos_agotados', { p_limite: limite, p_max_intentos: TOPE_INTENTOS_DOC }, 'cpdocs.agotados');

/** Documentos de correo por revisar con un bloqueo o con confianza baja y sin aviso a la oficina. */
export const documentosPorAvisar = (umbral: number, limite = 25) =>
  listaDeAviso('cp_documentos_por_avisar', { p_limite: limite, p_umbral: umbral }, 'cpdocs.por_avisar');

/** El candado de «avisar UNA vez por documento y tipo». `sin_migracion` = no hay candado atómico: no se avisa. */
export async function reclamarAvisoDoc(tenantId: string, id: string, tipo: TipoAvisoDoc): Promise<'ganado' | 'perdido' | 'sin_migracion'> {
  const r = await acotada(supabaseAdmin().rpc('cp_documento_reclamar_aviso', { p_tenant: tenantId, p_id: id, p_tipo: tipo }), 'cpdocs.reclamar_aviso');
  if (r.error) {
    if (funcionAusente(r.error)) return 'sin_migracion';
    throw new Error(`cpdocs.reclamar_aviso: ${r.error.message}`);
  }
  return r.data === true ? 'ganado' : 'perdido';
}

/** Suelta el candado cuando el aviso NO salió y tampoco quedó en la cola de WhatsApp (rechazo definitivo). */
export async function liberarAvisoDoc(tenantId: string, id: string, tipo: TipoAvisoDoc): Promise<boolean> {
  const r = await acotada(supabaseAdmin().rpc('cp_documento_liberar_aviso', { p_tenant: tenantId, p_id: id, p_tipo: tipo }), 'cpdocs.liberar_aviso');
  if (r.error) { logger.error('cartaporte_docs.aviso_no_liberado', { id, tipo, err: r.error.message }); return false; }
  return r.data === true;
}

// ── Un archivo con N embarques partido en N documentos (0670-0671) ──────────
//
// La RPC de la 0671 hace TODO en una transacción (hijos + linaje + eventos + el padre a `dividido`). Contra una base SIN
// la 0670/0671 el módulo sigue funcionando: `sin_migracion` le dice a quien llama que lea el archivo como siempre (por su
// primer embarque, con el aviso) en vez de perder el documento.

export interface HijoNuevo { indice: number; clave: string; nombre: string; sha256: string; bytes: number; storageRuta: string }

/**
 * Qué pasó con cada hijo (0672): `creado` nació como documento nuevo; `reabierto` su huella era de un documento rechazado o
 * fallido y volvió a `recibido` con el archivo nuevo; `reutilizado` ya había un documento vigente o aprobado (no se toca);
 * `sin_archivo` ya había uno pero purgado: el archivo recién subido no lo retiene nadie y quien divide debe BORRARLO.
 */
export type AccionHijo = 'creado' | 'reabierto' | 'reutilizado' | 'sin_archivo';

export type ResultadoDivision =
  | { estado: 'ok'; hijos: Array<{ indice: number; documentoId: string; creado: boolean; accion: AccionHijo }> }
  /** El documento ya no es de quien lo reclamó (otra invocación lo terminó, venció el lease, se purgó). */
  | { estado: 'perdido' }
  | { estado: 'sin_migracion' };

export async function dividirDocumento(
  tenantId: string, padreId: string, versionReclamada: number, hijos: HijoNuevo[], retenerHijos: string, retenerPadre: string,
): Promise<ResultadoDivision> {
  const r = await acotada(supabaseAdmin().rpc('cp_documento_dividir', {
    p_tenant: tenantId, p_padre: padreId, p_version: versionReclamada,
    p_hijos: hijos.map((h) => ({ indice: h.indice, clave: h.clave, nombre: h.nombre, sha256: h.sha256, bytes: h.bytes, storage_ruta: h.storageRuta })),
    p_retener_hijos: retenerHijos, p_retener_padre: retenerPadre,
  }), 'cpdocs.dividir');
  if (r.error) {
    if (funcionAusente(r.error)) { logger.warn('cartaporte_docs.dividir_sin_migracion', { motivo: r.error.message }); return { estado: 'sin_migracion' }; }
    throw new Error(`cpdocs.dividir: ${r.error.message}`);
  }
  const filas = (r.data ?? []) as unknown as Fila[];
  if (filas.length === 0) return { estado: 'perdido' };
  const ACCIONES: readonly string[] = ['creado', 'reabierto', 'reutilizado', 'sin_archivo'];
  return {
    estado: 'ok',
    hijos: filas.map((f) => {
      const creado = Boolean(f.creado);
      // Una base con la 0671 pero sin la 0672 no manda `accion`: lo no creado se trata como reutilizado (el comportamiento de antes).
      const accion = (typeof f.accion === 'string' && ACCIONES.includes(f.accion) ? f.accion : creado ? 'creado' : 'reutilizado') as AccionHijo;
      return { indice: Number(f.indice), documentoId: String(f.documento_id), creado, accion };
    }),
  };
}

/**
 * M3 (0672): los documentos `procesando` con los intentos agotados y el lease vencido pasan a `fallido` terminal (con su
 * evento) para que `documentosAgotados` los vea y la oficina se entere. `null` = la base no tiene la 0672 (no se cierra nada).
 */
export async function cerrarDocumentosZombis(retenerHasta: string, limite = 50): Promise<Array<{ tenantId: string; id: string }> | null> {
  const r = await acotada(supabaseAdmin().rpc('cp_documentos_cerrar_zombis', { p_limite: limite, p_max_intentos: TOPE_INTENTOS_DOC, p_retener_hasta: retenerHasta }), 'cpdocs.cerrar_zombis');
  if (r.error) {
    if (funcionAusente(r.error)) { logger.warn('cartaporte_docs.zombis_sin_migracion', { motivo: r.error.message }); return null; }
    throw new Error(`cpdocs.cerrar_zombis: ${r.error.message}`);
  }
  return ((r.data ?? []) as unknown as Fila[]).map((f) => ({ tenantId: String(f.tenant_id), id: String(f.id) }));
}

/** El linaje de un documento partido: el hijo apunta a su padre; el padre, a cuántos hijos tiene. */
export interface Linaje {
  /** `hijo`: nació de partir un archivo. `padre`: es ese archivo, ya dividido. */
  rol: 'hijo' | 'padre';
  padreId: string;
  /** Solo del hijo. */
  indice: number | null;
  total: number;
  clave: string | null;
  huellaBase: string;
}

/**
 * El linaje de varios documentos de la bandeja de una vez. MEJOR ESFUERZO: sin la 0670 (o si la lectura falla) la
 * bandeja se ve igual que antes, sin etiquetas de «embarque i de N».
 */
export async function linajeDeDocumentos(tenantId: string, ids: string[]): Promise<Map<string, Linaje>> {
  const mapa = new Map<string, Linaje>();
  if (ids.length === 0) return mapa;
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const lote = ids.slice(i, i + 100);
      const h = await acotada(supabaseAdmin().from('cp_documento_embarque').select('documento_id, padre_id, huella_base, indice, total, clave')
        .eq('tenant_id', tenantId).in('documento_id', lote).order('documento_id').limit(200), 'cpdocs.linaje_hijos');
      if (h.error) { if (funcionAusente(h.error)) return mapa; throw new Error(h.error.message); }
      for (const f of (h.data ?? []) as unknown as Fila[]) {
        mapa.set(String(f.documento_id), { rol: 'hijo', padreId: String(f.padre_id), indice: Number(f.indice), total: Number(f.total), clave: s(f.clave), huellaBase: String(f.huella_base) });
      }
      const p = await acotada(supabaseAdmin().from('cp_documento_embarque').select('padre_id, huella_base, total')
        .eq('tenant_id', tenantId).in('padre_id', lote).eq('indice', 1).order('padre_id').limit(200), 'cpdocs.linaje_padres');
      if (p.error) throw new Error(p.error.message);
      for (const f of (p.data ?? []) as unknown as Fila[]) {
        mapa.set(String(f.padre_id), { rol: 'padre', padreId: String(f.padre_id), indice: null, total: Number(f.total), clave: null, huellaBase: String(f.huella_base) });
      }
    }
  } catch (e) {
    logger.warn('cartaporte_docs.linaje_fallo', { err: e instanceof Error ? e.message : String(e) });
  }
  return mapa;
}

/** Los hijos de un documento dividido (ligeros, como la bandeja), en el orden del archivo. Vacío sin la 0670. */
export async function hijosDeDocumento(tenantId: string, padreId: string): Promise<Array<{ documento: DocumentoFila; indice: number; total: number; clave: string | null }>> {
  const e = await acotada(supabaseAdmin().from('cp_documento_embarque').select('documento_id, indice, total, clave')
    .eq('tenant_id', tenantId).eq('padre_id', padreId).order('indice').order('documento_id').limit(MAX_HIJOS_LEIDOS), 'cpdocs.hijos');
  if (e.error) {
    if (funcionAusente(e.error)) return [];
    throw new Error(`cpdocs.hijos: ${e.error.message}`);
  }
  const fichas = (e.data ?? []) as unknown as Fila[];
  if (fichas.length === 0) return [];
  const d = await acotada(supabaseAdmin().from('cp_documento').select(COLUMNAS_LISTA)
    .eq('tenant_id', tenantId).in('id', fichas.map((f) => String(f.documento_id))).order('id').limit(MAX_HIJOS_LEIDOS), 'cpdocs.hijos_docs');
  const docs = new Map(((exigir(d, 'cpdocs.hijos_docs') ?? []) as unknown as Fila[]).map((f) => [String(f.id), aDocumento(f)]));
  return fichas.flatMap((f) => {
    const doc = docs.get(String(f.documento_id));
    return doc ? [{ documento: doc, indice: Number(f.indice), total: Number(f.total), clave: s(f.clave) }] : [];
  });
}

const MAX_HIJOS_LEIDOS = 100;

// ── Configuración de salida al TMS (0790: cp_salida_config) ─────────────────
// Una fila por flota. SIN credenciales: esas viven en el cofre de PS, nunca aquí.

export interface SalidaConfigFila {
  modo: 'descarga' | 'api';
  plantillaPorDefecto: 'normal' | 'nueva';
  reintentosMax: number;
  frecuenciaMin: number;
  /** HH:MM en hora local de la flota; ambas o ninguna. */
  ventanaInicio: string | null;
  ventanaFin: string | null;
  destinatarioAlertaCorreo: string | null;
  destinatarioAlertaUsuario: string | null;
  destinatarioRevisionUsuario: string | null;
  destinatarioRevisionCorreo: string | null;
  siTmsDesconocido: 'retener' | 'enviar';
  distanciaFormato: 'texto_km' | 'numero';
}

const COLUMNAS_SALIDA_CONFIG = 'modo, plantilla_por_defecto, reintentos_max, frecuencia_min, ventana_inicio, ventana_fin, destinatario_alerta_correo, destinatario_alerta_usuario, destinatario_revision_usuario, destinatario_revision_correo, si_tms_desconocido, distancia_formato';
/** Postgres devuelve `time` como HH:MM:SS; la app habla HH:MM. */
const hhmm = (v: unknown): string | null => (v === null || v === undefined ? null : String(v).slice(0, 5));

/** La fila de la flota, o null si nunca se guardó (quien llama aplica los valores de arranque). */
export async function leerSalidaConfig(tenantId: string): Promise<SalidaConfigFila | null> {
  const r = await acotada(supabaseAdmin().from('cp_salida_config').select(COLUMNAS_SALIDA_CONFIG).eq('tenant_id', tenantId).maybeSingle(), 'cpdocs.salida_config');
  const f = exigir(r, 'cpdocs.salida_config') as unknown as Fila | null;
  if (!f) return null;
  return {
    modo: f.modo as SalidaConfigFila['modo'], plantillaPorDefecto: f.plantilla_por_defecto as SalidaConfigFila['plantillaPorDefecto'],
    reintentosMax: Number(f.reintentos_max), frecuenciaMin: Number(f.frecuencia_min),
    ventanaInicio: hhmm(f.ventana_inicio), ventanaFin: hhmm(f.ventana_fin),
    destinatarioAlertaCorreo: s(f.destinatario_alerta_correo), destinatarioAlertaUsuario: s(f.destinatario_alerta_usuario),
    destinatarioRevisionUsuario: s(f.destinatario_revision_usuario), destinatarioRevisionCorreo: s(f.destinatario_revision_correo),
    siTmsDesconocido: f.si_tms_desconocido as SalidaConfigFila['siTmsDesconocido'], distanciaFormato: f.distancia_formato as SalidaConfigFila['distanciaFormato'],
  };
}

/** Upsert de la fila completa de la flota (idempotente: guardar lo mismo dos veces deja el mismo estado). */
export async function guardarSalidaConfig(tenantId: string, c: SalidaConfigFila, actorId: string | null): Promise<void> {
  const r = await acotada(supabaseAdmin().from('cp_salida_config').upsert({
    tenant_id: tenantId, modo: c.modo, plantilla_por_defecto: c.plantillaPorDefecto, reintentos_max: c.reintentosMax, frecuencia_min: c.frecuenciaMin,
    ventana_inicio: c.ventanaInicio, ventana_fin: c.ventanaFin,
    destinatario_alerta_correo: c.destinatarioAlertaCorreo, destinatario_alerta_usuario: c.destinatarioAlertaUsuario,
    destinatario_revision_usuario: c.destinatarioRevisionUsuario, destinatario_revision_correo: c.destinatarioRevisionCorreo,
    si_tms_desconocido: c.siTmsDesconocido, distancia_formato: c.distanciaFormato, updated_by: actorId, updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id' }), 'cpdocs.salida_config_guardar');
  if (r.error) throw new Error(`cartaporte_docs salida config: ${r.error.message}`);
}


// ── Revisor asignado (0790: cp_documento.revisor_asignado) ──────────────────
// Se lee y se escribe APARTE de `COLUMNAS_DOC` a propósito: la bandeja de hoy no puede romperse en una base que todavía no
// tiene la 0790. Sin la columna, leer devuelve «sin asignar» y escribir falla con una frase clara.

/** Las personas de la oficina que pueden recibir casos por revisar (activas y de ESTA flota). */
export interface UsuarioRevisor { id: string; nombre: string | null; email: string; rol: string; telefono: string | null }
const ROLES_REVISOR = ['encargado', 'flota_admin', 'contador'] as const;
const aRevisor = (f: Fila): UsuarioRevisor => ({ id: String(f.id), nombre: s(f.nombre), email: String(f.email), rol: String(f.rol), telefono: s(f.telefono) });
const COLUMNAS_REVISOR = 'id, nombre, email, rol, telefono, activo';

/** La columna de la 0790 no existe todavía (Postgres 42703 / PostgREST lo dice con el nombre de la columna). */
export function columnaAusente(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42703' || /revisor_asignado|column .* does not exist/i.test(error.message ?? '');
}

/** Quien puede revisar en la flota, por nombre. Los desactivados no salen. */
export async function usuariosRevisores(tenantId: string): Promise<UsuarioRevisor[]> {
  const r = await acotada(supabaseAdmin().from('app_user').select(COLUMNAS_REVISOR).eq('tenant_id', tenantId)
    .in('rol', [...ROLES_REVISOR]).or('activo.is.null,activo.eq.true').order('nombre', { ascending: true }).order('id').limit(200), 'cpdocs.usuarios_revisores');
  return ((exigir(r, 'cpdocs.usuarios_revisores') ?? []) as unknown as Fila[]).filter((f) => f.activo !== false).map(aRevisor);
}

/** Una persona de ESTA flota que puede revisar, o null (otra flota, desactivada o con un rol que no revisa). */
export async function usuarioRevisor(tenantId: string, userId: string): Promise<UsuarioRevisor | null> {
  const r = await acotada(supabaseAdmin().from('app_user').select(COLUMNAS_REVISOR).eq('tenant_id', tenantId).eq('id', userId)
    .in('rol', [...ROLES_REVISOR]).maybeSingle(), 'cpdocs.usuario_revisor');
  const f = exigir(r, 'cpdocs.usuario_revisor') as unknown as Fila | null;
  return f && f.activo !== false ? aRevisor(f) : null;
}

/** A quién le toca cada documento (solo los asignados salen en el mapa). Sin la 0790: mapa vacío. */
export async function revisoresDeDocumentos(tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const r = await acotada(supabaseAdmin().from('cp_documento').select('id, revisor_asignado')
      .eq('tenant_id', tenantId).in('id', ids.slice(i, i + 200)).not('revisor_asignado', 'is', null).order('id').limit(200), 'cpdocs.revisores_docs');
    if (r.error && columnaAusente(r.error)) { logger.warn('cartaporte_docs.revisor_sin_migracion', { motivo: r.error.message }); return new Map(); }
    for (const f of (exigir(r, 'cpdocs.revisores_docs') ?? []) as unknown as Fila[]) mapa.set(String(f.id), String(f.revisor_asignado));
  }
  return mapa;
}

/** Los documentos por revisar asignados a una persona (para «Mis casos»). Sin la 0790: ninguno. */
export async function idsAsignadosA(tenantId: string, userId: string): Promise<string[]> {
  const r = await acotada(supabaseAdmin().from('cp_documento').select('id')
    .eq('tenant_id', tenantId).eq('revisor_asignado', userId).order('id').limit(1000), 'cpdocs.ids_asignados');
  if (r.error && columnaAusente(r.error)) return [];
  return ((exigir(r, 'cpdocs.ids_asignados') ?? []) as unknown as Fila[]).map((f) => String(f.id));
}

/**
 * Fija (o quita, con null) el revisor de un documento. Escribe SOLO esa columna: no sube la `version` del documento, porque
 * asignar a quién le toca no es un cambio de contenido y no debe invalidar la pantalla de quien está revisando.
 * `false` = el documento no es de esta flota. Sin la 0790 lanza con una frase para la pantalla.
 */
export async function asignarRevisorDoc(tenantId: string, id: string, revisorId: string | null): Promise<boolean> {
  const r = await acotada(supabaseAdmin().from('cp_documento').update({ revisor_asignado: revisorId })
    .eq('tenant_id', tenantId).eq('id', id).select('id'), 'cpdocs.asignar_revisor');
  if (r.error && columnaAusente(r.error)) throw new Error('La asignación de revisor todavía no está disponible en esta base (falta la migración 0790).');
  return ((exigir(r, 'cpdocs.asignar_revisor') ?? []) as unknown as Fila[]).length > 0;
}


// ── Envíos al TMS (0790: cp_envio_tms) ──────────────────────────────────────
// Solo lo que necesita «preparar el envío» (T-A3-04). La cola, el lease y la máquina de estados son de T-A3-26/27.

export type EstadoEnvioTms =
  | 'pendiente_prechequeo' | 'pendiente_reque' | 'listo' | 'enviando' | 'enviado'
  | 'rechazado_tms' | 'error_transitorio' | 'subido_a_mano' | 'descartado';

export interface EnvioTmsFila {
  id: string; tenantId: string; documentoId: string; versionDoc: number; idempotencyKey: string;
  estado: EstadoEnvioTms; plantilla: 'normal' | 'nueva'; intentos: number;
}

const COLUMNAS_ENVIO = 'id, tenant_id, documento_id, version_doc, idempotency_key, estado, plantilla, intentos';
const aEnvio = (f: Fila): EnvioTmsFila => ({
  id: String(f.id), tenantId: String(f.tenant_id), documentoId: String(f.documento_id), versionDoc: Number(f.version_doc),
  idempotencyKey: String(f.idempotency_key), estado: f.estado as EstadoEnvioTms, plantilla: f.plantilla as EnvioTmsFila['plantilla'], intentos: Number(f.intentos ?? 0),
});

export async function envioPorLlave(tenantId: string, idempotencyKey: string): Promise<EnvioTmsFila | null> {
  const r = await acotada(supabaseAdmin().from('cp_envio_tms').select(COLUMNAS_ENVIO).eq('tenant_id', tenantId).eq('idempotency_key', idempotencyKey).maybeSingle(), 'cpdocs.envio_llave');
  const f = exigir(r, 'cpdocs.envio_llave') as unknown as Fila | null;
  return f ? aEnvio(f) : null;
}

/** Los envíos de un documento, el más nuevo primero. */
export async function enviosDeDocumento(tenantId: string, documentoId: string): Promise<EnvioTmsFila[]> {
  const r = await acotada(supabaseAdmin().from('cp_envio_tms').select(COLUMNAS_ENVIO)
    .eq('tenant_id', tenantId).eq('documento_id', documentoId).order('created_at', { ascending: false }).order('id').limit(50), 'cpdocs.envios_doc');
  return ((exigir(r, 'cpdocs.envios_doc') ?? []) as unknown as Fila[]).map(aEnvio);
}

/**
 * Inserta el envío en `pendiente_prechequeo`. Idempotente por (flota, llave): si la llave ya existe devuelve el existente
 * (`creado:false`). `null` = el documento ya tiene OTRO envío activo (índice parcial único): quien llama decide qué hacer.
 */
export async function insertarEnvioTms(tenantId: string, e: { documentoId: string; versionDoc: number; idempotencyKey: string; plantilla: 'normal' | 'nueva' }): Promise<{ envio: EnvioTmsFila; creado: boolean } | null> {
  const previo = await envioPorLlave(tenantId, e.idempotencyKey);
  if (previo) return { envio: previo, creado: false };
  const r = await acotada(supabaseAdmin().from('cp_envio_tms').insert({
    tenant_id: tenantId, documento_id: e.documentoId, version_doc: e.versionDoc, idempotency_key: e.idempotencyKey, plantilla: e.plantilla, estado: 'pendiente_prechequeo',
  }).select(COLUMNAS_ENVIO).single(), 'cpdocs.envio_insertar');
  if (r.error) {
    if ((r.error as { code?: string }).code === '23505') {
      // O la misma llave (carrera con otra aprobación) o el índice de «un activo por documento».
      const ganado = await envioPorLlave(tenantId, e.idempotencyKey);
      return ganado ? { envio: ganado, creado: false } : null;
    }
    throw new Error(`cartaporte_docs envio: ${r.error.message}`);
  }
  return { envio: aEnvio(r.data as unknown as Fila), creado: true };
}

/** Pasa a `descartado` el envío SOLO si sigue en uno de los estados dados (UPDATE condicional). */
export async function descartarEnvioTms(tenantId: string, id: string, desde: EstadoEnvioTms[]): Promise<boolean> {
  const r = await acotada(supabaseAdmin().from('cp_envio_tms').update({ estado: 'descartado', updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', id).in('estado', desde).select('id'), 'cpdocs.envio_descartar');
  return ((exigir(r, 'cpdocs.envio_descartar') ?? []) as unknown[]).length > 0;
}

/**
 * Pasa a `subido_a_mano` el envío SOLO si sigue en uno de los estados dados (UPDATE condicional) y suelta el lease:
 * así `cp_envio_reclamar` (que solo mira estados vivos) ya no lo vuelve a tomar. `false` = ya no estaba en esos estados.
 */
export async function marcarEnvioSubidoAMano(tenantId: string, id: string, desde: EstadoEnvioTms[]): Promise<boolean> {
  const r = await acotada(supabaseAdmin().from('cp_envio_tms').update({ estado: 'subido_a_mano', procesando_hasta: null, proxima_revision: null, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', id).in('estado', desde).select('id'), 'cpdocs.envio_subido_a_mano');
  return ((exigir(r, 'cpdocs.envio_subido_a_mano') ?? []) as unknown[]).length > 0;
}

/**
 * A37-A3-01: guarda la referencia que el sistema del cliente dio a esta carga (`referencia_tms`), la llave con la que después
 * se casa el CCP timbrado. Solo si el envío es de la flota. `false` = no existe ese envío.
 */
export async function fijarReferenciaEnvio(tenantId: string, id: string, referencia: string): Promise<boolean> {
  const r = await acotada(supabaseAdmin().from('cp_envio_tms').update({ referencia_tms: referencia.slice(0, 200), updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', id).select('id'), 'cpdocs.envio_referencia');
  return ((exigir(r, 'cpdocs.envio_referencia') ?? []) as unknown[]).length > 0;
}

/** El estado del envío más reciente (no descartado) de cada documento, para la lista de la bandeja. Sin envío = sin clave. */
export async function estadoEnvioPorDocumento(tenantId: string, documentoIds: string[]): Promise<Record<string, EstadoEnvioTms>> {
  if (documentoIds.length === 0) return {};
  const r = await acotada(supabaseAdmin().from('cp_envio_tms').select('documento_id, estado')
    .eq('tenant_id', tenantId).in('documento_id', documentoIds).neq('estado', 'descartado').order('created_at', { ascending: false }).order('id').limit(2000), 'cpdocs.envios_lista');
  const salida: Record<string, EstadoEnvioTms> = {};
  for (const f of (exigir(r, 'cpdocs.envios_lista') ?? []) as unknown as Fila[]) {
    const id = String(f.documento_id);
    if (!(id in salida)) salida[id] = f.estado as EstadoEnvioTms; // el más nuevo primero
  }
  return salida;
}

// ── Agregados para los insights del agente (T-A3-37) ────────────────────────
// Solo conteos y nombres de campo: jamás el valor antes/después de una corrección ni el contenido de un documento.

/** Cuántas veces se corrigió cada CAMPO (solo el nombre) en los documentos dados. */
export async function contarCorreccionesPorCampo(tenantId: string, ids: string[]): Promise<Map<string, number>> {
  const cuenta = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const r = await acotada(supabaseAdmin().from('cp_correccion').select('campo')
      .eq('tenant_id', tenantId).in('documento_id', ids.slice(i, i + 200)).order('id').limit(50_000), 'cpdocs.correcciones_campo');
    for (const f of (exigir(r, 'cpdocs.correcciones_campo') ?? []) as unknown as Fila[]) cuenta.set(String(f.campo), (cuenta.get(String(f.campo)) ?? 0) + 1);
  }
  return cuenta;
}

/**
 * Cuántos documentos RECHAZADOS hay por `rechazo_causa` desde `desde` (la clave `''` = rechazado sin causa clasificada).
 * `null` = la columna (0791) todavía no existe en esta base: «no se puede medir», no «ningún rechazo».
 */
export async function contarCausasDeRechazo(tenantId: string, desde: Date): Promise<Record<string, number> | null> {
  const r = await acotada(supabaseAdmin().from('cp_documento').select('rechazo_causa')
    .eq('tenant_id', tenantId).eq('estado', 'rechazado').gte('created_at', desde.toISOString()).order('id').limit(5000), 'cpdocs.causas_rechazo');
  if (r.error) {
    if ((r.error as { code?: string }).code === '42703' || /rechazo_causa/i.test(r.error.message ?? '')) return null;
    throw new Error(`cpdocs.causas_rechazo: ${r.error.message}`);
  }
  const cuenta: Record<string, number> = {};
  for (const f of (r.data ?? []) as unknown as Fila[]) {
    const k = f.rechazo_causa === null || f.rechazo_causa === undefined ? '' : String(f.rechazo_causa);
    cuenta[k] = (cuenta[k] ?? 0) + 1;
  }
  return cuenta;
}

/** Lo mínimo de un envío para medir su estado: nunca el contenido ni los errores. */
export interface EnvioParaInsights {
  documentoId: string; estado: EstadoEnvioTms; createdAt: string; enviadoEn: string | null; causaPendiente: string | null;
}

/** Los envíos creados desde `desde` (de todos los estados). */
export async function enviosParaInsights(tenantId: string, desde: Date): Promise<EnvioParaInsights[]> {
  const r = await acotada(supabaseAdmin().from('cp_envio_tms').select('documento_id, estado, created_at, enviado_en, causa_pendiente')
    .eq('tenant_id', tenantId).gte('created_at', desde.toISOString()).order('created_at', { ascending: false }).limit(5000), 'cpdocs.envios_insights');
  return ((exigir(r, 'cpdocs.envios_insights') ?? []) as unknown as Fila[]).map((f) => ({
    documentoId: String(f.documento_id), estado: f.estado as EstadoEnvioTms, createdAt: String(f.created_at),
    enviadoEn: f.enviado_en === null || f.enviado_en === undefined ? null : String(f.enviado_en),
    causaPendiente: f.causa_pendiente === null || f.causa_pendiente === undefined ? null : String(f.causa_pendiente),
  }));
}

// ── Viajes salidos sin Carta Porte (T-A3-66) ────────────────────────────────

/** Cuánto hacia atrás se buscan salidas (más viejo que esto ya no es un pendiente de la semana). */
export const DIAS_SALIDAS_SIN_CCP = 45;

/**
 * Viajes con salida registrada (hito `salida_carga` recibido o validado) y los ids de los que ya tienen un complemento
 * APROBADO ligado (`cp_documento.viaje_id`). SOLO LECTURA; si algo falla LANZA (la pantalla dice «no se pudo leer», no «sin pendientes»).
 */
export async function leerSalidasParaSinCcp(tenantId: string, ahora: Date = new Date()): Promise<{ viajes: ViajeSalido[]; conCcp: Set<string> }> {
  const desde = new Date(ahora.getTime() - DIAS_SALIDAS_SIN_CCP * 86_400_000).toISOString();
  const rh = await acotada(supabaseAdmin().from('viaje_hito').select('viaje_id, mensaje_en, recibido_en')
    .eq('tenant_id', tenantId).eq('tipo', 'salida_carga').in('estado', ['recibido', 'validado'])
    .gte('recibido_en', desde).order('recibido_en', { ascending: false }).limit(2000), 'cpdocs.sin_ccp_hitos');
  const hitos = (exigir(rh, 'cpdocs.sin_ccp_hitos') ?? []) as unknown as Fila[];
  const salidaPorViaje = new Map<string, string>();
  for (const h of hitos) {
    const id = s(h.viaje_id); const t = s(h.mensaje_en) ?? s(h.recibido_en);
    if (id && t && !salidaPorViaje.has(id)) salidaPorViaje.set(id, t);
  }
  const ids = [...salidaPorViaje.keys()];
  if (ids.length === 0) return { viajes: [], conCcp: new Set() };
  const [filas, docs] = await Promise.all([
    traerPorIds<Fila>(ids, (t) => acotada(supabaseAdmin().from('viaje').select('id, folio, cliente_id, cliente:cliente_id (nombre)')
      .eq('tenant_id', tenantId).in('id', t), 'cpdocs.sin_ccp_viajes') as never, 'cpdocs.sin_ccp_viajes'),
    traerPorIds<Fila>(ids, (t) => acotada(supabaseAdmin().from('cp_documento').select('viaje_id')
      .eq('tenant_id', tenantId).eq('estado', 'aprobado').in('viaje_id', t), 'cpdocs.sin_ccp_docs') as never, 'cpdocs.sin_ccp_docs'),
  ]);
  const viajes: ViajeSalido[] = filas.map((f) => {
    const c = (f.cliente ?? null) as Fila | null;
    const id = String(f.id);
    return { viajeId: id, folio: s(f.folio), clienteId: s(f.cliente_id), clienteNombre: s(c?.nombre), salidaEn: salidaPorViaje.get(id) ?? null };
  });
  const conCcp = new Set<string>();
  for (const d of docs) { const id = s(d.viaje_id); if (id) conCcp.add(id); }
  return { viajes, conCcp };
}
