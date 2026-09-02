// ═══════════════════════════════════════════════════════════════════════════
// LA BANDEJA DE CONTEXTO UNIVERSAL (Fase D, plan-de-cierre.md, orden del
// 16-ago-2026) — la parte de TypeScript de `agente_insumo` (0267).
//
// Lo que este módulo hace y nada más:
//  · Declara qué TIPOS acepta cada agente del catálogo (`TIPOS_POR_AGENTE`),
//    basado en lo que ese agente YA hace hoy — no se inventan agentes ni
//    departamentos nuevos, se lee `agente_definicion` (0116/0125) tal como
//    está sembrada.
//  · CRUD del insumo: subir (archivo o texto/link), listar para la tarjeta
//    del agente (con su estado), y las dos funciones que el RUNNER usa para
//    consumir — `insumosPendientes` (lectura, fail-closed) y
//    `marcarInsumosProcesados` (el "qué usó" queda escrito).
//
// LO QUE NO HACE: no decide cuándo corre un agente ni qué hace con el
// insumo una vez leído — eso vive en el motor de cada agente (ver
// `finanzas.ts`, que hoy es el único enganchado).
//
// CROSS-TENANT A PROPÓSITO: `listarInsumosDeAgente` (la vista de la tarjeta)
// lee TODOS los insumos de un agente sin filtrar por tenant — casi todo el
// catálogo corre para LIKIDA (tenant_id NULL, ver corridas.ts), y el puñado
// de insumos con tenant_id no-NULL que pudiera existir algún día sigue
// siendo del MISMO superadmin que ya ve todo lo demás en /admin. Mismo
// dominio cross-tenant que `finanzas.ts`/`crecimiento.ts`; entra en el
// ALLOWLIST de `consultas_admin_filtran_tenant.test.ts` con esta misma razón.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { DatoInvalido } from '../errores';
import { pesoArchivo } from '@/lib/formato';
import {
  TIPOS_INSUMO, esTipoInsumo, TIPOS_ARCHIVO, TIPOS_TEXTO,
  TIPOS_POR_DEPARTAMENTO, TIPOS_POR_AGENTE, tiposAceptadosPorAgente,
  type TipoInsumo, type InsumoAgente,
} from './insumos_tipos';

// Re-exportados tal cual, para que todo lo que ya importaba estos nombres
// DE AQUÍ (finanzas.ts, la página server, las pruebas) los siga encontrando
// en el mismo sitio — la única que cambia de dónde los toma es
// `zona-insumos.tsx` ('use client'), que ahora los toma DIRECTO de
// `insumos_tipos.ts` para no arrastrar `supabaseAdmin` al bundle del
// navegador (ver la cabecera de ese archivo).
export {
  TIPOS_INSUMO, esTipoInsumo, TIPOS_ARCHIVO, TIPOS_TEXTO,
  TIPOS_POR_DEPARTAMENTO, TIPOS_POR_AGENTE, tiposAceptadosPorAgente,
};
export type { TipoInsumo, InsumoAgente };

function desdeFila(f: Record<string, unknown>): InsumoAgente {
  return {
    id: String(f.id),
    agente: String(f.agente),
    tenantId: (f.tenant_id as string | null) ?? null,
    tipo: f.tipo as TipoInsumo,
    titulo: String(f.titulo),
    storagePath: (f.storage_path as string | null) ?? null,
    contenidoTexto: (f.contenido_texto as string | null) ?? null,
    subidoPor: String(f.subido_por),
    subidoEn: String(f.subido_en),
    procesadoEn: (f.procesado_en as string | null) ?? null,
    resumenUso: (f.resumen_uso as string | null) ?? null,
  };
}

const SELECT_COLUMNAS = 'id, agente, tenant_id, tipo, titulo, storage_path, contenido_texto, subido_por, subido_en, procesado_en, resumen_uso';

/**
 * Todos los insumos de UN agente, más recientes primero — lo que la tarjeta
 * enseña ("qué le has dado, qué usó"). Cross-tenant a propósito (ver
 * cabecera del archivo). LANZA ante error de lectura: la tarjeta no puede
 * decir "sin insumos" sobre una base caída.
 */
export async function listarInsumosDeAgente(agenteId: string, limite = 50): Promise<InsumoAgente[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('agente_insumo')
    .select(SELECT_COLUMNAS)
    .eq('agente', agenteId)
    .order('subido_en', { ascending: false })
    .order('id')
    .limit(limite), 'insumos.listar');
  if (error) throw new Error(`listarInsumosDeAgente(${agenteId}): ${error.message}`);
  return (data ?? []).map(desdeFila);
}

/** El total REAL de insumos de un agente — AUDITORÍA 24, ADM-9: el panel
 *  pintaba `insumos.length` (topado a `limite`, default 50) como si fuera el
 *  total. `count: 'exact', head: true` no trae filas, solo el conteo. */
export async function contarInsumosDeAgente(agenteId: string): Promise<number> {
  const { count, error } = await acotada(supabaseAdmin()
    .from('agente_insumo')
    .select('id', { count: 'exact', head: true })
    .eq('agente', agenteId), 'insumos.contar');
  if (error) throw new Error(`contarInsumosDeAgente(${agenteId}): ${error.message}`);
  return count ?? 0;
}

/**
 * Los insumos PENDIENTES de un agente — lo que su siguiente corrida debe
 * leer. Plataforma (`tenant_id is null`): es el filtro que la capa 2 del
 * aislamiento exige ver en la propia cadena, y es también la verdad de
 * negocio — casi ningún agente del catálogo es por-flota (corridas.ts).
 * LANZA ante error: fail-closed, mismo criterio que el resto de finanzas.ts
 * — una lectura a medias no puede tratarse como "no hay insumos".
 */
export async function insumosPendientes(agenteId: string, limite = 20): Promise<InsumoAgente[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('agente_insumo')
    .select(SELECT_COLUMNAS)
    .eq('agente', agenteId)
    .is('tenant_id', null)
    .is('procesado_en', null)
    .order('subido_en', { ascending: true })
    .order('id')
    .limit(limite), 'insumos.pendientes');
  if (error) throw new Error(`insumosPendientes(${agenteId}): ${error.message}`);
  return (data ?? []).map(desdeFila);
}

/**
 * Cuántos insumos PENDIENTES tiene cada agente — para el badge de la tabla
 * de `/admin/agentes`. Una sola lectura de plataforma (cross-tenant a
 * propósito, ver cabecera) reducida en memoria, mismo patrón que
 * `exitoTreintaDias` en `admin/agentes/contenido.tsx`: 5,000 filas pendientes
 * a la vez es muy por encima de la escala de hoy, y si algún día se
 * recortara el `.limit()` lo delataría un conteo que deja de crecer.
 * LANZA ante error de lectura.
 */
export async function contarPendientesPorAgente(): Promise<Map<string, number>> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('agente_insumo')
    .select('agente')
    .is('procesado_en', null)
    .order('id')
    .limit(5000), 'insumos.contar_pendientes');
  if (error) throw new Error(`contarPendientesPorAgente: ${error.message}`);
  const conteo = new Map<string, number>();
  for (const f of (data ?? []) as Array<{ agente: string }>) conteo.set(f.agente, (conteo.get(f.agente) ?? 0) + 1);
  return conteo;
}

/**
 * Marca un lote de insumos como procesados, con el resumen de qué hizo el
 * agente ("qué aprendió de eso"). Anclado a `procesado_en is null` (mismo
 * patrón que `resolverPieza` en bus.ts): dos corridas concurrentes no se
 * pisan — la segunda encuentra 0 filas afectadas y no es un error, solo no
 * hizo nada porque ya no había nada que marcar.
 */
export async function marcarInsumosProcesados(ids: string[], resumenUso: string): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await supabaseAdmin()
    .from('agente_insumo')
    .update({ procesado_en: new Date().toISOString(), resumen_uso: resumenUso.slice(0, 2000) })
    .in('id', ids)
    .is('procesado_en', null)
    .select('id');
  if (error) throw new Error(`marcarInsumosProcesados: ${error.message}`);
  return data?.length ?? 0;
}

// ── Alta (desde la Server Action de /admin/agentes/[id]/insumos) ──────────

export interface AltaInsumoArchivo {
  agente: string;
  departamento: string;
  titulo: string;
  tipo: 'documento' | 'imagen' | 'video';
  storagePath: string;
  subidoPor: string;
}

export interface AltaInsumoTexto {
  agente: string;
  departamento: string;
  titulo: string;
  tipo: 'link' | 'texto';
  contenido: string;
  subidoPor: string;
}

// ── El archivo (Storage) — mismo patrón que `subirPoliticaPerfil`
// (lib/likida/perfil/documentos.ts): valida tipo/peso, sube el buffer al
// bucket privado, y devuelve la ruta. NO es un signed-upload-URL (ese
// patrón no existe hoy en el repo, pese a la nota — el que SÍ existe y se
// reutiliza aquí, igual que en `mi-perfil`/`documentos.ts`, es Server
// Action recibe FormData → sube con `supabaseAdmin()` directo). ─────────

export const TOPE_BYTES_INSUMO = 8 * 1024 * 1024;

const MIME_POR_TIPO_ARCHIVO: Record<'documento' | 'imagen' | 'video', Set<string>> = {
  documento: new Set([
    'application/pdf', 'text/csv', 'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]),
  imagen: new Set(['image/jpeg', 'image/png', 'image/webp']),
  // 8 MB es corto para video; es el mismo tope que el resto del repo usa
  // para adjuntos (documentos.ts) y no hay hoy un flujo de subida directa
  // a Storage desde el navegador (signed upload URL) que lo evite — un
  // clip más largo es un hueco declarado, no un olvido.
  video: new Set(['video/mp4', 'video/quicktime', 'video/webm']),
};

const EXT_POR_MIME: Record<string, string> = {
  'application/pdf': 'pdf', 'text/csv': 'csv', 'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
};

/** `null` = aceptado. Un mensaje listo para pantalla si no. */
export function aceptaArchivoInsumo(tipo: 'documento' | 'imagen' | 'video', archivo: { size: number; type: string }): string | null {
  if (archivo.size <= 0) return 'El archivo está vacío.';
  if (archivo.size > TOPE_BYTES_INSUMO) return `El archivo pesa más de ${pesoArchivo(TOPE_BYTES_INSUMO)}.`;
  if (!MIME_POR_TIPO_ARCHIVO[tipo].has(archivo.type)) return 'Ese tipo de archivo no se acepta aquí.';
  return null;
}

/** Sube el archivo al bucket privado `agente-insumos` bajo `{agente}/` y
 *  devuelve la ruta. LANZA `DatoInvalido` si no pasa `aceptaArchivoInsumo`;
 *  cualquier otro error es de Storage. */
export async function subirArchivoInsumo(agenteId: string, archivo: File, tipo: 'documento' | 'imagen' | 'video'): Promise<string> {
  const rechazo = aceptaArchivoInsumo(tipo, archivo);
  if (rechazo) throw new DatoInvalido(rechazo);
  const ruta = `${agenteId}/${crypto.randomUUID()}.${EXT_POR_MIME[archivo.type] ?? 'bin'}`;
  const buf = Buffer.from(await archivo.arrayBuffer());
  const { error } = await acotada(
    supabaseAdmin().storage.from('agente-insumos').upload(ruta, buf, { contentType: archivo.type, upsert: false }),
    'insumos.subir_archivo',
  ) as { error: { message: string } | null };
  if (error) throw new Error(`No se pudo guardar el archivo: ${error.message}`);
  return ruta;
}

function validarTipoAceptado(agente: string, departamento: string, tipo: TipoInsumo): void {
  const aceptados = tiposAceptadosPorAgente(agente, departamento);
  if (!aceptados.includes(tipo)) {
    throw new DatoInvalido(`Este agente no recibe insumos de tipo "${tipo}" — acepta: ${aceptados.join(', ')}.`);
  }
}

/** Inserta el insumo con `storage_path` ya subido (el archivo mismo se sube
 *  en la Server Action, antes de llamar esto — mismo orden que
 *  `subirAvatar`: primero Storage, luego la fila). LANZA `DatoInvalido` con
 *  el tipo no aceptado; cualquier otro error es de la base. */
export async function crearInsumoArchivo(a: AltaInsumoArchivo): Promise<string> {
  validarTipoAceptado(a.agente, a.departamento, a.tipo);
  const { data, error } = await supabaseAdmin()
    .from('agente_insumo')
    .insert({
      agente: a.agente, tenant_id: null, tipo: a.tipo, titulo: a.titulo,
      storage_path: a.storagePath, subido_por: a.subidoPor,
    })
    .select('id')
    .single();
  if (error) throw new Error(`crearInsumoArchivo: ${error.message}`);
  return String((data as { id: string }).id);
}

/** Inserta un insumo de link o texto libre — sin Storage de por medio. */
export async function crearInsumoTexto(a: AltaInsumoTexto): Promise<string> {
  validarTipoAceptado(a.agente, a.departamento, a.tipo);
  const { data, error } = await supabaseAdmin()
    .from('agente_insumo')
    .insert({
      agente: a.agente, tenant_id: null, tipo: a.tipo, titulo: a.titulo,
      contenido_texto: a.contenido, subido_por: a.subidoPor,
    })
    .select('id')
    .single();
  if (error) throw new Error(`crearInsumoTexto: ${error.message}`);
  return String((data as { id: string }).id);
}

/** URL firmada (1 h) de un insumo en Storage — para previsualizar/descargar
 *  desde la tarjeta. `null` si no se pudo firmar (bucket privado, sin
 *  policy para authenticated a propósito — ver cabecera de la 0267): la
 *  tarjeta enseña "sin vista previa", nunca revienta. */
export async function urlFirmadaInsumo(storagePath: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin().storage.from('agente-insumos').createSignedUrl(storagePath, 3600);
  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * URLs firmadas EN LOTE (un solo request a Storage) — mismo criterio que
 * `getEstadoBus` (bus.ts): varias `createSignedUrl` concurrentes por
 * pintada es lo que saturó el pool de Storage el 28-ago-2026. Sin firma
 * para una ruta ⇒ esa tarjeta enseña "sin vista previa", no rompe las demás.
 */
export async function urlsFirmadasInsumos(rutas: string[]): Promise<Map<string, string>> {
  const firmas = new Map<string, string>();
  const unicas = [...new Set(rutas)];
  if (unicas.length === 0) return firmas;
  const { data } = await supabaseAdmin().storage.from('agente-insumos').createSignedUrls(unicas, 3600);
  for (const f of data ?? []) if (f.path && f.signedUrl && !f.error) firmas.set(f.path, f.signedUrl);
  return firmas;
}
