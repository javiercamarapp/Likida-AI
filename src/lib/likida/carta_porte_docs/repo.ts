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
import { exigir } from '../pg';
import type { Extraccion } from './campos';
import type { ResultadoValidacion } from './validacion';
import type { FormatoDoc } from './contenido';
import type { FirmaPerfil, Mapeo, EjemploPerfil, Perfil } from './perfiles';

export const BUCKET = 'cartaporte-docs';

export type CanalDoc = 'manual' | 'correo' | 'whatsapp';
export type EstadoDoc = 'recibido' | 'procesando' | 'por_revisar' | 'aprobado' | 'rechazado' | 'fallido';

export interface MetaExtraccion {
  origen: 'xml' | 'perfil' | 'llm' | 'perfil+llm';
  nivel: number;
  escalamientos: Array<{ de: number; a: number; motivo: string }>;
  avisos: string[];
  notasModelo: string[];
  indiciosInyeccion: string[];
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
  const res = await acotada(supabaseAdmin().storage.from(BUCKET).upload(ruta, Buffer.from(bytes), { contentType: mime, upsert: true }), 'cpdocs.subir');
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

export interface FiltroDocumentos { estados?: EstadoDoc[]; desde?: string; limite?: number }

/** La bandeja: sin el texto ni la extracción completa (pesan), ordenada por lo más urgente. */
export async function listarDocumentos(tenantId: string, f: FiltroDocumentos = {}): Promise<{ filas: DocumentoFila[]; total: number }> {
  let q = supabaseAdmin().from('cp_documento').select(COLUMNAS_DOC, { count: 'exact' }).eq('tenant_id', tenantId);
  if (f.estados && f.estados.length > 0) q = q.in('estado', f.estados);
  if (f.desde) q = q.gte('created_at', f.desde);
  const r = await acotada(q.order('created_at', { ascending: false }).limit(Math.min(f.limite ?? 100, 500)), 'cpdocs.listar');
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

/** Otros documentos de la flota con el mismo folio de cliente (posible duplicado lógico). */
export async function documentosConFolio(tenantId: string, folio: string, exceptoId: string): Promise<Array<{ id: string; estado: EstadoDoc; nombreArchivo: string }>> {
  const r = await acotada(supabaseAdmin().from('cp_documento').select('id, estado, nombre_archivo')
    .eq('tenant_id', tenantId).eq('extraccion->campos->folio_cliente->>valor', folio).neq('id', exceptoId)
    .neq('estado', 'rechazado').limit(5), 'cpdocs.folio_duplicado');
  return ((exigir(r, 'cpdocs.folio_duplicado') ?? []) as unknown as Fila[]).map((f) => ({ id: String(f.id), estado: f.estado as EstadoDoc, nombreArchivo: String(f.nombre_archivo) }));
}

export type TipoEvento =
  | 'recibido' | 'duplicado_recibido' | 'extraccion_iniciada' | 'extraccion_ok' | 'extraccion_fallida' | 'escalada' | 'revision_abierta'
  | 'campo_corregido' | 'aprobado' | 'rechazado' | 'reabierto' | 'salida_viaje' | 'exportado' | 'perfil_aprendido' | 'purgado';

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
      .eq('tenant_id', tenantId).in('documento_id', ids.slice(i, i + 200)).limit(50_000), 'cpdocs.contar_correcciones');
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
    .select('id, clave, nombre, cliente_id, formato, firma, version_activa, created_at').eq('tenant_id', tenantId).order('updated_at', { ascending: false }).limit(200), 'cpdocs.perfiles');
  const perfiles = (exigir(p, 'cpdocs.perfiles') ?? []) as unknown as Fila[];
  if (perfiles.length === 0) return [];
  const v = await acotada(supabaseAdmin().from('cp_perfil_version')
    .select('perfil_id, version, mapeos, ejemplos, nota').eq('tenant_id', tenantId).in('perfil_id', perfiles.map((x) => String(x.id))).limit(5000), 'cpdocs.perfil_versiones');
  const versiones = (exigir(v, 'cpdocs.perfil_versiones') ?? []) as unknown as Fila[];
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
  const r = await acotada(supabaseAdmin().from('cp_export_config').select('id, nombre, formato, config, activa').eq('tenant_id', tenantId).order('nombre').limit(50), 'cpdocs.export_configs');
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
  const r = await acotada(supabaseAdmin().from('viaje').select(COL_VIAJE).eq('tenant_id', tenantId).eq('folio', folio).maybeSingle(), 'cpdocs.viaje_folio');
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
  const r = await acotada(supabaseAdmin().from('operador').select('id, nombre, activo').eq('tenant_id', tenantId).order('nombre').limit(2000), 'cpdocs.operadores');
  return ((exigir(r, 'cpdocs.operadores') ?? []) as unknown as Fila[]).map((f) => ({ id: String(f.id), nombre: String(f.nombre), activo: f.activo !== false }));
}

export async function unidadesPorPlacas(tenantId: string, placas: string): Promise<Array<{ id: string; activo: boolean }>> {
  const r = await acotada(supabaseAdmin().from('unidad').select('id, activo').eq('tenant_id', tenantId).ilike('placas', placas).limit(3), 'cpdocs.unidad_placas');
  return ((exigir(r, 'cpdocs.unidad_placas') ?? []) as unknown as Fila[]).map((f) => ({ id: String(f.id), activo: f.activo !== false }));
}

export async function viajeAbiertoDeOperador(tenantId: string, operadorId: string): Promise<{ id: string; folio: string | null } | null> {
  const r = await acotada(supabaseAdmin().from('viaje').select('id, folio').eq('tenant_id', tenantId).eq('operador_id', operadorId).in('estatus', ['abierto', 'en_cuadre']).limit(1), 'cpdocs.viaje_abierto');
  const f = ((exigir(r, 'cpdocs.viaje_abierto') ?? []) as unknown as Fila[])[0];
  return f ? { id: String(f.id), folio: s(f.folio) } : null;
}

export async function clientePropio(tenantId: string, clienteId: string): Promise<boolean> {
  const r = await acotada(supabaseAdmin().from('cliente').select('id').eq('tenant_id', tenantId).eq('id', clienteId).maybeSingle(), 'cpdocs.cliente');
  return !!exigir(r, 'cpdocs.cliente');
}

export async function listarClientes(tenantId: string): Promise<Array<{ id: string; nombre: string }>> {
  const r = await acotada(supabaseAdmin().from('cliente').select('id, nombre').eq('tenant_id', tenantId).order('nombre').limit(1000), 'cpdocs.clientes');
  return ((exigir(r, 'cpdocs.clientes') ?? []) as unknown as Fila[]).map((f) => ({ id: String(f.id), nombre: String(f.nombre) }));
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
