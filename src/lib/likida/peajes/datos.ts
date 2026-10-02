import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';
import { traerTodo, conteo, type RespuestaPg } from '../pg';
import { normalizarNombre, normalizarTag } from './formatos';
import { COLUMNAS_POLIGONO, conPoligonoOCirculo, geometriaDeFila } from '../conductor/geometria_datos';
import { matrizDeArchivoCatalogo } from './archivo';
import { parsearCasetasMatriz, type CasetaCatalogo } from './casetas';
import { parsearTagsMatriz, resolverUnidadesDeTags } from './tags';
import { validarMapeo, type ConfigMapeo } from './mapeo';
import { planificarGps, evaluarCruceGps, type LineaParaGps, type VeredictoGps, type Muestra } from './cruce_gps';
import { createHash } from 'node:crypto';
import { generarToken, esTokenValido } from '@/lib/correo/buzon';
import { hostNoPublico } from '@/lib/http/destino_publico';
import { cifrar, cofreConfigurado } from '../conectores/cofre';

// ═══════════════════════════════════════════════════════════════════════════
// EL I/O DE LOS CATÁLOGOS DE PEAJES: TAGs, casetas, geocercas, mapeos.
//
// Todo acotado a la flota con `.eq('tenant_id', …)` (service_role salta RLS) y
// con errores de supabase POR VALOR convertidos en excepciones. Las
// validaciones viven en los módulos puros (tags.ts, casetas.ts, mapeo.ts);
// aquí solo se lee y se escribe.
// ═══════════════════════════════════════════════════════════════════════════

const LOTE = 200;
const lotes = <T,>(xs: readonly T[]): T[][] => {
  const r: T[][] = [];
  for (let i = 0; i < xs.length; i += LOTE) r.push(xs.slice(i, i + LOTE));
  return r;
};

// ── Unidades (para casar TAGs) ──────────────────────────────────────────────
export async function listarUnidades(tenantId: string): Promise<Array<{ id: string; numeroEconomico: string; placas: string | null }>> {
  const filas = await traerTodo<{ id: unknown; numero_economico: unknown; placas: unknown }>(
    (d, h) => acotada(supabaseAdmin()
      .from('unidad').select('id, numero_economico, placas', conteo(d))
      .eq('tenant_id', tenantId).order('numero_economico').order('id').range(d, h), 'peajes.unidades'),
    'peajes.unidades',
  );
  return filas.map((f) => ({ id: String(f.id), numeroEconomico: String(f.numero_economico), placas: (f.placas as string | null) ?? null }));
}

// ── TAGs ────────────────────────────────────────────────────────────────────
export interface TagVista { id: string; tag: string; tagOriginal: string | null; unidadId: string; unidadEconomico: string | null; proveedor: string | null; activo: boolean }

export async function listarTags(tenantId: string): Promise<TagVista[]> {
  const filas = await traerTodo<{ id: unknown; tag: unknown; tag_original: unknown; unidad_id: unknown; proveedor: unknown; activo: unknown }>(
    (d, h) => acotada(supabaseAdmin()
      .from('peaje_tag').select('id, tag, tag_original, unidad_id, proveedor, activo', conteo(d))
      .eq('tenant_id', tenantId).order('tag').order('id').range(d, h), 'peajes.tags'),
    'peajes.tags',
  );
  const unidades = await listarUnidades(tenantId);
  const eco = new Map(unidades.map((u) => [u.id, u.numeroEconomico]));
  return filas.map((f) => ({
    id: String(f.id), tag: String(f.tag), tagOriginal: (f.tag_original as string | null) ?? null,
    unidadId: String(f.unidad_id), unidadEconomico: eco.get(String(f.unidad_id)) ?? null,
    proveedor: (f.proveedor as string | null) ?? null, activo: f.activo !== false,
  }));
}

/** TAG normalizado → unidad, solo los activos. Lanza ante error de base: un mapa a medias dejaría líneas «sin unidad» falsas. */
export async function cargarMapaTags(tenantId: string): Promise<Map<string, string>> {
  const filas = await traerTodo<{ tag: unknown; unidad_id: unknown }>(
    (d, h) => acotada(supabaseAdmin()
      .from('peaje_tag').select('tag, unidad_id', conteo(d))
      .eq('tenant_id', tenantId).eq('activo', true).order('tag').range(d, h), 'peajes.mapa_tags'),
    'peajes.mapa_tags',
  );
  return new Map(filas.map((f) => [String(f.tag), String(f.unidad_id)]));
}

export type ResultadoAltaTag = { ok: true } | { ok: false; motivo: string };

export async function altaTag(tenantId: string, entrada: { tag: string; unidadId: string; proveedor?: string | null }): Promise<ResultadoAltaTag> {
  const tag = normalizarTag(entrada.tag);
  if (!tag) return { ok: false, motivo: 'El TAG no es un identificador válido (4 a 40 letras o dígitos).' };
  const unidades = await listarUnidades(tenantId);
  if (!unidades.some((u) => u.id === entrada.unidadId)) return { ok: false, motivo: 'Esa unidad no existe en tu flota.' };
  const { error } = await acotada(supabaseAdmin().from('peaje_tag').upsert({
    tenant_id: tenantId, tag, tag_original: entrada.tag.trim().slice(0, 60), unidad_id: entrada.unidadId,
    proveedor: entrada.proveedor?.trim().slice(0, 60) || null, activo: true,
  }, { onConflict: 'tenant_id,tag' }), 'peajes.alta_tag');
  if (error) {
    logger.error('peajes.alta_tag', { tenant: tenantId, err: error.message });
    return { ok: false, motivo: 'No se pudo guardar el TAG. Inténtalo de nuevo.' };
  }
  return { ok: true };
}

export async function bajaTag(tenantId: string, tagId: string): Promise<boolean> {
  const { error } = await acotada(supabaseAdmin().from('peaje_tag').delete().eq('tenant_id', tenantId).eq('id', tagId), 'peajes.baja_tag');
  if (error) logger.error('peajes.baja_tag', { tenant: tenantId, err: error.message });
  return !error;
}

export interface ResultadoImportacionCatalogo {
  ok: boolean;
  /** Filas escritas. */
  guardadas: number;
  /** Filas que cambiaron algo ya existente (TAG de otra unidad, caseta con otras coordenadas). */
  actualizadas: number;
  rechazadas: Array<{ fila: number; motivo: string }>;
  error?: string;
}

export async function importarTagsArchivo(tenantId: string, nombre: string, buffer: Uint8Array): Promise<ResultadoImportacionCatalogo> {
  const falla = (error: string): ResultadoImportacionCatalogo => ({ ok: false, guardadas: 0, actualizadas: 0, rechazadas: [], error });
  const m = matrizDeArchivoCatalogo(nombre, buffer);
  if (!m.ok) return falla(m.motivo);
  const lectura = parsearTagsMatriz(m.matriz);
  if (lectura.error) return falla(lectura.error);

  let unidades;
  let existentes: Map<string, string>;
  try {
    unidades = await listarUnidades(tenantId);
    existentes = await cargarMapaTags(tenantId);
  } catch (e) {
    logger.error('peajes.importar_tags_lectura', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    return falla('No se pudo leer el catálogo actual. Inténtalo de nuevo.');
  }
  const { altas, rechazadas } = resolverUnidadesDeTags(lectura.tags, unidades);
  const todasRechazadas = [...lectura.rechazadas, ...rechazadas].sort((a, b) => a.fila - b.fila);
  if (altas.length === 0) return { ok: true, guardadas: 0, actualizadas: 0, rechazadas: todasRechazadas };

  let guardadas = 0;
  let actualizadas = 0;
  for (const lote of lotes(altas)) {
    const { error } = await acotada(supabaseAdmin().from('peaje_tag').upsert(
      lote.map((a) => ({
        tenant_id: tenantId, tag: a.tag, tag_original: a.tagOriginal, unidad_id: a.unidadId, proveedor: a.proveedor, activo: true,
      })),
      { onConflict: 'tenant_id,tag' },
    ), 'peajes.importar_tags');
    if (error) {
      logger.error('peajes.importar_tags', { tenant: tenantId, err: error.message });
      return { ok: false, guardadas, actualizadas, rechazadas: todasRechazadas, error: `Se guardaron ${guardadas} TAGs y el resto falló. Vuelve a subir el archivo: es seguro repetirlo.` };
    }
    for (const a of lote) {
      guardadas++;
      const previa = existentes.get(a.tag);
      if (previa !== undefined && previa !== a.unidadId) actualizadas++;
    }
  }
  return { ok: true, guardadas, actualizadas, rechazadas: todasRechazadas };
}

// ── Casetas ─────────────────────────────────────────────────────────────────
export interface CasetaVista extends CasetaCatalogo { activa: boolean; fuente: string | null }

export async function listarCasetas(tenantId: string, soloActivas = false): Promise<CasetaVista[]> {
  const filas = await traerTodo<{ id: unknown; nombre: unknown; nombre_norm: unknown; alias: unknown; lat: unknown; lng: unknown; radio_m: unknown; activa: unknown; fuente: unknown }>(
    (d, h) => {
      let q = supabaseAdmin().from('peaje_caseta')
        .select('id, nombre, nombre_norm, alias, lat, lng, radio_m, activa, fuente', conteo(d))
        .eq('tenant_id', tenantId);
      if (soloActivas) q = q.eq('activa', true);
      return acotada(q.order('nombre').order('id').range(d, h), 'peajes.casetas');
    },
    'peajes.casetas',
  );
  return filas.map((f) => ({
    id: String(f.id), nombre: String(f.nombre), nombreNorm: String(f.nombre_norm),
    alias: Array.isArray(f.alias) ? (f.alias as unknown[]).map(String) : [],
    lat: Number(f.lat), lng: Number(f.lng), radioM: Number(f.radio_m),
    activa: f.activa !== false, fuente: (f.fuente as string | null) ?? null,
  }));
}

export async function importarCasetasArchivo(tenantId: string, nombre: string, buffer: Uint8Array, fuenteDefault: string): Promise<ResultadoImportacionCatalogo> {
  const falla = (error: string): ResultadoImportacionCatalogo => ({ ok: false, guardadas: 0, actualizadas: 0, rechazadas: [], error });
  const m = matrizDeArchivoCatalogo(nombre, buffer);
  if (!m.ok) return falla(m.motivo);
  const lectura = parsearCasetasMatriz(m.matriz);
  if (lectura.error) return falla(lectura.error);
  if (lectura.casetas.length === 0) return { ok: true, guardadas: 0, actualizadas: 0, rechazadas: lectura.rechazadas };

  let previas: CasetaVista[];
  try {
    previas = await listarCasetas(tenantId);
  } catch (e) {
    logger.error('peajes.importar_casetas_lectura', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    return falla('No se pudo leer el catálogo actual. Inténtalo de nuevo.');
  }
  const porNorm = new Map(previas.map((c) => [c.nombreNorm, c]));
  let guardadas = 0;
  let actualizadas = 0;
  for (const lote of lotes(lectura.casetas)) {
    const { error } = await acotada(supabaseAdmin().from('peaje_caseta').upsert(
      lote.map((c) => ({
        tenant_id: tenantId, nombre: c.nombre, nombre_norm: c.nombreNorm, alias: c.alias,
        lat: c.lat, lng: c.lng, radio_m: c.radioM, activa: true, fuente: c.fuente ?? fuenteDefault,
      })),
      { onConflict: 'tenant_id,nombre_norm' },
    ), 'peajes.importar_casetas');
    if (error) {
      logger.error('peajes.importar_casetas', { tenant: tenantId, err: error.message });
      return { ok: false, guardadas, actualizadas, rechazadas: lectura.rechazadas, error: `Se guardaron ${guardadas} casetas y el resto falló. Vuelve a subir el archivo: es seguro repetirlo.` };
    }
    for (const c of lote) {
      guardadas++;
      const p = porNorm.get(c.nombreNorm);
      if (p && (p.lat !== c.lat || p.lng !== c.lng || p.radioM !== c.radioM)) actualizadas++;
    }
  }
  return { ok: true, guardadas, actualizadas, rechazadas: lectura.rechazadas };
}

export async function cambiarEstadoCaseta(tenantId: string, casetaId: string, activa: boolean): Promise<boolean> {
  const { error } = await acotada(supabaseAdmin().from('peaje_caseta').update({ activa }).eq('tenant_id', tenantId).eq('id', casetaId), 'peajes.estado_caseta');
  if (error) logger.error('peajes.estado_caseta', { tenant: tenantId, err: error.message });
  return !error;
}

// ── Geocercas (la tabla de la 0050; nadie creaba filas) ─────────────────────
export interface GeocercaVista {
  id: string; nombre: string; tipo: string; lat: number; lng: number; radioM: number; activa: boolean;
  /** 0630: polígono nativo (solo en `zonasParaReclamacion`) y si el círculo sustituye a uno que no se guardó. */
  poligono?: Array<{ lat: number; lng: number }> | null;
  aproximada?: boolean;
}
export const TIPOS_GEOCERCA = ['origen', 'destino', 'patio', 'punto_interes', 'restringida'] as const;

/**
 * Por omisión, solo el catálogo de peajes (0480): los clientes, plantas y andenes del Conductor son de SU pantalla.
 * `zonasParaReclamacion` (solo lectura) devuelve las ZONAS (patio / restringida) de AMBOS catálogos: la reclamación
 * cruza el PASE con las geocercas que la flota importó de SUS tablas (catálogo del Conductor, «patio»), no solo con las
 * capturadas a mano en peajes. El editor sigue usando la forma por omisión.
 */
export async function listarGeocercas(tenantId: string, opciones: { zonasParaReclamacion?: boolean } = {}): Promise<GeocercaVista[]> {
  type FilaGeocerca = { id: unknown; nombre: unknown; tipo: unknown; lat: unknown; lng: unknown; radio_m: unknown; activa: unknown; poligono?: unknown; aproximada?: unknown };
  const filas = await traerTodo<FilaGeocerca>(
    (d, h) => {
      // Solo la reclamación necesita el polígono (0630); con respaldo a círculo si la base aún no tiene la migración.
      const consulta = (conPoligono: boolean) => {
        const q = supabaseAdmin().from('geocerca')
          .select(conPoligono ? `id, nombre, tipo, lat, lng, radio_m, activa, ${COLUMNAS_POLIGONO}` : 'id, nombre, tipo, lat, lng, radio_m, activa', conteo(d))
          .eq('tenant_id', tenantId);
        // El select es una cadena calculada: el tipado de postgrest no la resuelve, la fila se declara en `traerTodo`.
        return acotada((opciones.zonasParaReclamacion ? q.in('tipo', ['patio', 'restringida']) : q.eq('catalogo', 'peajes'))
          .order('nombre').order('id').range(d, h), 'peajes.geocercas') as unknown as PromiseLike<RespuestaPg<FilaGeocerca[]>>;
      };
      return opciones.zonasParaReclamacion ? conPoligonoOCirculo(consulta) : consulta(false);
    },
    'peajes.geocercas',
  );
  return filas.map((f) => ({
    id: String(f.id), nombre: String(f.nombre), tipo: String(f.tipo),
    lat: Number(f.lat), lng: Number(f.lng), radioM: Number(f.radio_m), activa: f.activa !== false,
    ...(opciones.zonasParaReclamacion ? geometriaDeFila(f as Record<string, unknown>) : {}),
  }));
}

export type ResultadoGeocerca = { ok: true } | { ok: false; motivo: string };

const MOTIVO_SITIO_DEL_CONDUCTOR =
  'Ese nombre ya es un sitio del catálogo del Agente Conductor (clientes, plantas y andenes). Elige otro nombre, o edítalo en Agente Conductor → Sitios.';

export async function guardarGeocerca(
  tenantId: string,
  e: { nombre: string; tipo: string; lat: number; lng: number; radioM: number },
): Promise<ResultadoGeocerca> {
  const nombre = e.nombre.trim().replace(/\s+/g, ' ');
  if (!nombre || nombre.length > 120) return { ok: false, motivo: 'Ponle un nombre (hasta 120 caracteres).' };
  if (!(TIPOS_GEOCERCA as readonly string[]).includes(e.tipo)) return { ok: false, motivo: 'Tipo de geocerca no válido.' };
  if (![e.lat, e.lng, e.radioM].every(Number.isFinite)) return { ok: false, motivo: 'Latitud, longitud y radio deben ser números.' };
  if (e.lat < -90 || e.lat > 90 || e.lng < -180 || e.lng > 180) return { ok: false, motivo: 'Las coordenadas están fuera de rango.' };
  if (!Number.isInteger(e.radioM) || e.radioM < 25 || e.radioM > 100_000) return { ok: false, motivo: 'El radio va de 25 a 100,000 metros.' };
  // Dos catálogos comparten la tabla (0480): este editor SOLO escribe el de peajes. Si el nombre ya es un sitio del
  // Conductor (cliente, planta, andén…), el upsert por (tenant, nombre) lo pisaría —cambiaría su tipo y su círculo—;
  // se avisa antes y la base lo impide además (catálogo inmutable + CHECK de pareja con el tipo).
  const previa = await acotada(supabaseAdmin().from('geocerca').select('id, catalogo')
    .eq('tenant_id', tenantId).eq('nombre', nombre).order('id').limit(1), 'peajes.geocerca_previa');
  if (previa.error) {
    logger.error('peajes.guardar_geocerca', { tenant: tenantId, err: previa.error.message });
    return { ok: false, motivo: 'No se pudo guardar la geocerca. Inténtalo de nuevo.' };
  }
  if ((previa.data ?? []).some((f: { catalogo?: unknown }) => f.catalogo === 'conductor')) return { ok: false, motivo: MOTIVO_SITIO_DEL_CONDUCTOR };
  const { error } = await acotada(supabaseAdmin().from('geocerca').upsert({
    tenant_id: tenantId, nombre, tipo: e.tipo, lat: e.lat, lng: e.lng, radio_m: e.radioM, activa: true, catalogo: 'peajes',
  }, { onConflict: 'tenant_id,nombre' }), 'peajes.guardar_geocerca');
  if (error) {
    if ((error as { code?: string }).code === '23514') return { ok: false, motivo: MOTIVO_SITIO_DEL_CONDUCTOR };
    logger.error('peajes.guardar_geocerca', { tenant: tenantId, err: error.message });
    return { ok: false, motivo: 'No se pudo guardar la geocerca. Inténtalo de nuevo.' };
  }
  return { ok: true };
}

export async function cambiarEstadoGeocerca(tenantId: string, id: string, activa: boolean): Promise<boolean> {
  const { error } = await acotada(supabaseAdmin().from('geocerca').update({ activa }).eq('tenant_id', tenantId).eq('catalogo', 'peajes').eq('id', id), 'peajes.estado_geocerca');
  if (error) logger.error('peajes.estado_geocerca', { tenant: tenantId, err: error.message });
  return !error;
}

// ── Mapeo de columnas por proveedor ─────────────────────────────────────────
export interface MapeoVista { id: string; proveedor: string; columnas: ConfigMapeo; activo: boolean }

/** El mapeo ACTIVO del proveedor, o null. Lanza ante error de base: un null falso haría caer a la detección automática sin avisar. */
export async function cargarMapeo(tenantId: string, proveedor: string | null | undefined): Promise<ConfigMapeo | null> {
  const norm = normalizarNombre(proveedor);
  if (!norm) return null;
  const { data, error } = await acotada(supabaseAdmin().from('peaje_mapeo_columnas')
    .select('columnas, activo').eq('tenant_id', tenantId).eq('proveedor_norm', norm).maybeSingle(), 'peajes.cargar_mapeo');
  if (error) throw new Error(`cargarMapeo: ${error.message}`);
  if (!data || data.activo === false) return null;
  const v = validarMapeo(data.columnas);
  return v.ok ? v.mapeo : null;
}

export async function listarMapeos(tenantId: string): Promise<MapeoVista[]> {
  const { data, error } = await acotada(supabaseAdmin().from('peaje_mapeo_columnas')
    .select('id, proveedor, columnas, activo').eq('tenant_id', tenantId).order('proveedor').order('id').limit(200), 'peajes.mapeos');
  if (error) throw new Error(`listarMapeos: ${error.message}`);
  const out: MapeoVista[] = [];
  for (const f of data ?? []) {
    const v = validarMapeo(f.columnas);
    if (v.ok) out.push({ id: String(f.id), proveedor: String(f.proveedor), columnas: v.mapeo, activo: f.activo !== false });
  }
  return out;
}

export async function guardarMapeo(tenantId: string, proveedor: string, columnas: unknown): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const prov = proveedor.trim().replace(/\s+/g, ' ');
  const norm = normalizarNombre(prov);
  if (!norm || prov.length > 60) return { ok: false, motivo: 'Indica el proveedor (hasta 60 caracteres).' };
  const v = validarMapeo(columnas);
  if (!v.ok) return v;
  const { error } = await acotada(supabaseAdmin().from('peaje_mapeo_columnas').upsert({
    tenant_id: tenantId, proveedor_norm: norm, proveedor: prov, columnas: v.mapeo, activo: true, updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id,proveedor_norm' }), 'peajes.guardar_mapeo');
  if (error) {
    logger.error('peajes.guardar_mapeo', { tenant: tenantId, err: error.message });
    return { ok: false, motivo: 'No se pudo guardar el mapeo. Inténtalo de nuevo.' };
  }
  return { ok: true };
}

export async function borrarMapeo(tenantId: string, id: string): Promise<boolean> {
  const { error } = await acotada(supabaseAdmin().from('peaje_mapeo_columnas').delete().eq('tenant_id', tenantId).eq('id', id), 'peajes.borrar_mapeo');
  if (error) logger.error('peajes.borrar_mapeo', { tenant: tenantId, err: error.message });
  return !error;
}

// ── El buzón firmado: configuración de la flota (0376) ──────────────────────
export interface ConfigBuzon { activa: boolean; rotacion: number }

/** La configuración del buzón de la flota, o null si nunca se activó. Lanza ante error de base. */
export async function leerConfigBuzon(tenantId: string): Promise<ConfigBuzon | null> {
  const { data, error } = await acotada(supabaseAdmin().from('peaje_ingesta_config')
    .select('rotacion, activa').eq('tenant_id', tenantId).maybeSingle(), 'peajes.config_buzon');
  if (error) throw new Error(`leerConfigBuzon: ${error.message}`);
  return data ? { activa: data.activa !== false, rotacion: Number(data.rotacion) } : null;
}

/** Activa el buzón (o lo reactiva conservando la rotación vigente). */
export async function activarBuzon(tenantId: string): Promise<boolean> {
  const actual = await leerConfigBuzon(tenantId);
  const { error } = await acotada(supabaseAdmin().from('peaje_ingesta_config').upsert({
    tenant_id: tenantId, rotacion: actual?.rotacion ?? 1, activa: true, updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id' }), 'peajes.activar_buzon');
  if (error) logger.error('peajes.activar_buzon', { tenant: tenantId, err: error.message });
  return !error;
}

export async function desactivarBuzon(tenantId: string): Promise<boolean> {
  const { error } = await acotada(supabaseAdmin().from('peaje_ingesta_config')
    .update({ activa: false, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId), 'peajes.desactivar_buzon');
  if (error) logger.error('peajes.desactivar_buzon', { tenant: tenantId, err: error.message });
  return !error;
}

/** Sube la rotación: la llave anterior deja de servir al instante. Solo si el buzón existe. */
export async function rotarLlaveBuzon(tenantId: string): Promise<boolean> {
  const actual = await leerConfigBuzon(tenantId);
  if (!actual) return false;
  const { error } = await acotada(supabaseAdmin().from('peaje_ingesta_config')
    .update({ rotacion: actual.rotacion + 1, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('rotacion', actual.rotacion), 'peajes.rotar_llave');
  if (error) logger.error('peajes.rotar_llave', { tenant: tenantId, err: error.message });
  return !error;
}

// ── Los canales de entrada nuevos (0563): correo y pull ─────────────────────
// Son INDEPENDIENTES del buzón firmado: `activa` es solo del POST firmado. Crear
// la fila por el correo o el pull la deja con `activa:false`, para que activar
// uno no encienda (ni enseñe la llave de) el otro.

export interface ConfigEntradas {
  correoActivo: boolean;
  correoToken: string | null;
  remitentes: string[];
  pullUrl: string | null;
  pullActivo: boolean;
  pullIntervaloMin: number;
  pullUltimoEn: string | null;
  pullUltimoError: string | null;
  /** Hay un token guardado (cifrado); el valor NUNCA vuelve a la pantalla. */
  pullConCredencial: boolean;
}

const COLUMNAS_ENTRADAS = 'correo_activo, correo_token, remitentes_permitidos, pull_url, pull_activo, pull_intervalo_min, pull_ultimo_en, pull_ultimo_error, pull_credencial_cifrada';

/** La configuración de correo/pull de la flota, o null si nunca se configuró. Lanza ante error de base. */
export async function leerConfigEntradas(tenantId: string): Promise<ConfigEntradas | null> {
  const { data, error } = await acotada(supabaseAdmin().from('peaje_ingesta_config')
    .select(COLUMNAS_ENTRADAS).eq('tenant_id', tenantId).maybeSingle(), 'peajes.config_entradas');
  if (error) throw new Error(`leerConfigEntradas: ${error.message}`);
  if (!data) return null;
  return {
    correoActivo: data.correo_activo === true,
    correoToken: (data.correo_token as string | null) ?? null,
    remitentes: Array.isArray(data.remitentes_permitidos) ? (data.remitentes_permitidos as unknown[]).map(String) : [],
    pullUrl: (data.pull_url as string | null) ?? null,
    pullActivo: data.pull_activo === true,
    pullIntervaloMin: Number(data.pull_intervalo_min ?? 60),
    pullUltimoEn: (data.pull_ultimo_en as string | null) ?? null,
    pullUltimoError: (data.pull_ultimo_error as string | null) ?? null,
    pullConCredencial: typeof data.pull_credencial_cifrada === 'string' && data.pull_credencial_cifrada.length > 0,
  };
}

/** Guarda cambios de entradas creando la fila si falta (con `activa:false`: el buzón firmado no se enciende solo). */
async function guardarEntradas(tenantId: string, cambios: Record<string, unknown>, que: string): Promise<boolean> {
  const existe = await acotada(supabaseAdmin().from('peaje_ingesta_config')
    .select('tenant_id').eq('tenant_id', tenantId).maybeSingle(), `peajes.${que}.existe`);
  if (existe.error) { logger.error(`peajes.${que}`, { tenant: tenantId, err: existe.error.message }); return false; }
  const ahora = new Date().toISOString();
  const res = existe.data
    ? await acotada(supabaseAdmin().from('peaje_ingesta_config').update({ ...cambios, updated_at: ahora }).eq('tenant_id', tenantId), `peajes.${que}`)
    : await acotada(supabaseAdmin().from('peaje_ingesta_config').insert({ tenant_id: tenantId, activa: false, rotacion: 1, ...cambios, updated_at: ahora }), `peajes.${que}`);
  if (res.error) logger.error(`peajes.${que}`, { tenant: tenantId, err: res.error.message });
  return !res.error;
}

/** Activa el correo de la flota; si no tenía dirección, le crea el token. */
export async function activarCorreoPeajes(tenantId: string): Promise<boolean> {
  const actual = await leerConfigEntradas(tenantId);
  return guardarEntradas(tenantId, { correo_token: actual?.correoToken ?? generarToken(), correo_activo: true }, 'activar_correo');
}

export async function desactivarCorreoPeajes(tenantId: string): Promise<boolean> {
  return guardarEntradas(tenantId, { correo_activo: false }, 'desactivar_correo');
}

/** Cambia el token: la dirección anterior deja de servir al instante. */
export async function rotarCorreoPeajes(tenantId: string): Promise<boolean> {
  const actual = await leerConfigEntradas(tenantId);
  if (!actual?.correoToken) return false;
  return guardarEntradas(tenantId, { correo_token: generarToken() }, 'rotar_correo');
}

const CORREO_O_DOMINIO = /^@?[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$|^@?[a-z0-9.-]+\.[a-z]{2,}$/i;

/** Remitentes (correo o dominio) que pueden mandar por correo. Lista vacía = cualquiera que tenga la dirección. */
export async function guardarRemitentesPeajes(tenantId: string, crudos: readonly string[]): Promise<{ ok: true; guardados: number } | { ok: false; motivo: string }> {
  const lista = [...new Set(crudos.map((r) => r.trim().toLowerCase()).filter(Boolean))];
  if (lista.length > 20) return { ok: false, motivo: 'Hasta 20 remitentes.' };
  const mala = lista.find((r) => r.length > 120 || !CORREO_O_DOMINIO.test(r));
  if (mala) return { ok: false, motivo: `«${mala.slice(0, 40)}» no es un correo ni un dominio.` };
  const ok = await guardarEntradas(tenantId, { remitentes_permitidos: lista }, 'guardar_remitentes');
  return ok ? { ok: true, guardados: lista.length } : { ok: false, motivo: 'No se pudo guardar. Inténtalo de nuevo.' };
}

/** El buzón de correo dueño de un token (flota, si está activo y a quién acepta). Lanza ante error de base. */
export async function buzonCorreoPeajesPorToken(token: string): Promise<{ tenantId: string; activo: boolean; remitentes: string[] } | null> {
  if (!esTokenValido(token)) return null;
  const { data, error } = await acotada(supabaseAdmin().from('peaje_ingesta_config')
    .select('tenant_id, correo_activo, remitentes_permitidos').eq('correo_token', token).maybeSingle(), 'peajes.buzon_correo');
  if (error) throw new Error(`buzonCorreoPeajesPorToken: ${error.message}`);
  if (!data) return null;
  return {
    tenantId: String(data.tenant_id), activo: data.correo_activo === true,
    remitentes: Array.isArray(data.remitentes_permitidos) ? (data.remitentes_permitidos as unknown[]).map(String) : [],
  };
}

export type ResultadoPull = { ok: true } | { ok: false; motivo: string };

/** Valida una URL de pull: https público, sin credenciales en la URL. */
export function validarUrlPull(crudo: string): { ok: true; url: string } | { ok: false; motivo: string } {
  const t = crudo.trim();
  let u: URL;
  try { u = new URL(t); } catch { return { ok: false, motivo: 'La dirección no es una URL válida.' }; }
  if (u.protocol !== 'https:') return { ok: false, motivo: 'La dirección tiene que ser https.' };
  if (u.username || u.password) return { ok: false, motivo: 'No pongas usuario ni clave en la URL: el token va aparte.' };
  if (hostNoPublico(u.hostname)) return { ok: false, motivo: 'La dirección tiene que ser pública (no una red interna ni localhost).' };
  if (t.length > 500) return { ok: false, motivo: 'La dirección pasa de 500 caracteres.' };
  return { ok: true, url: t };
}

/**
 * Configura (y enciende) el pull. El token, si se da, se guarda CIFRADO con el cofre;
 * sin `LIKIDA_COFRE_LLAVE` NO se guarda nada (un token en claro no es una opción).
 * Si no se da token, se conserva el que ya hubiera.
 */
export async function guardarPullPeajes(
  tenantId: string, entrada: { url: string; token?: string | null; intervaloMin: number },
): Promise<ResultadoPull> {
  const v = validarUrlPull(entrada.url);
  if (!v.ok) return v;
  if (!Number.isInteger(entrada.intervaloMin) || entrada.intervaloMin < 15 || entrada.intervaloMin > 1440) {
    return { ok: false, motivo: 'El intervalo va de 15 a 1,440 minutos.' };
  }
  const cambios: Record<string, unknown> = {
    pull_url: v.url, pull_intervalo_min: entrada.intervaloMin, pull_activo: true, pull_proximo_en: new Date().toISOString(), pull_ultimo_error: null,
  };
  const token = entrada.token?.trim();
  if (token) {
    if (token.length > 500 || /[\r\n]/.test(token)) return { ok: false, motivo: 'El token no es válido (sin saltos de línea, hasta 500 caracteres).' };
    if (!cofreConfigurado()) return { ok: false, motivo: 'El cofre de credenciales no está configurado (LIKIDA_COFRE_LLAVE): no se puede guardar el token de forma segura.' };
    cambios.pull_credencial_cifrada = cifrar({ token });
  }
  const ok = await guardarEntradas(tenantId, cambios, 'guardar_pull');
  return ok ? { ok: true } : { ok: false, motivo: 'No se pudo guardar. Inténtalo de nuevo.' };
}

export async function apagarPullPeajes(tenantId: string): Promise<boolean> {
  return guardarEntradas(tenantId, { pull_activo: false }, 'apagar_pull');
}

/** Borra el token guardado del pull (el cifrado se pone en NULL). */
export async function borrarCredencialPull(tenantId: string): Promise<boolean> {
  return guardarEntradas(tenantId, { pull_credencial_cifrada: null }, 'borrar_credencial_pull');
}

export interface PullReclamado {
  tenantId: string; url: string; credencialCifrada: string | null; ultimoEn: string | null; intervaloMin: number;
}

/** Toma las flotas cuyo pull ya toca (claim con lease, `peaje_pull_reclamar`). Lanza ante error de base. */
export async function reclamarPullsPeajes(limite: number, leaseSegundos = 600): Promise<PullReclamado[]> {
  const r = await acotada(supabaseAdmin().rpc('peaje_pull_reclamar', { p_limite: limite, p_lease_segundos: leaseSegundos }), 'peajes.pull.reclamar');
  if (r.error) throw new Error(`peajes.pull.reclamar: ${r.error.message}`);
  return ((r.data ?? []) as Array<Record<string, unknown>>).map((f) => ({
    tenantId: String(f.tenant_id), url: String(f.pull_url), credencialCifrada: (f.pull_credencial_cifrada as string | null) ?? null,
    ultimoEn: (f.pull_ultimo_en as string | null) ?? null, intervaloMin: Number(f.pull_intervalo_min ?? 60),
  }));
}

/** Cierra un pull: con éxito avanza el cursor (`desde`) y programa el siguiente turno; con error, reintenta pronto (tope 30 min). */
export async function cerrarPullPeajes(
  tenantId: string, c: { ok: boolean; avanzarA: string | null; error: string | null; intervaloMin: number; ahora?: Date },
): Promise<void> {
  const ahora = c.ahora ?? new Date();
  const espera = c.ok ? c.intervaloMin : Math.min(c.intervaloMin, 30);
  const cambios: Record<string, unknown> = {
    pull_proximo_en: new Date(ahora.getTime() + espera * 60_000).toISOString(),
    pull_ultimo_error: c.error ? c.error.slice(0, 500) : null,
    updated_at: ahora.toISOString(),
  };
  if (c.avanzarA) cambios.pull_ultimo_en = c.avanzarA;
  const { error } = await acotada(supabaseAdmin().from('peaje_ingesta_config').update(cambios).eq('tenant_id', tenantId), 'peajes.pull.cerrar');
  if (error) logger.error('peajes.pull.cerrar', { tenant: tenantId, err: error.message });
}

// ── Aviso a la oficina y anulación del desglose (0563) ─────────────────────

export const MAX_INTENTOS_AVISO = 5;

export interface EstadoAvisoDesglose {
  anulado: boolean; avisoEn: string | null; intentos: number;
  proveedor: string | null; periodoDesde: string | null; periodoHasta: string | null;
}

/** El estado del aviso de UN desglose (de esta flota), o null si no existe. Lanza ante error de base. */
export async function leerEstadoAvisoDesglose(tenantId: string, desgloseId: string): Promise<EstadoAvisoDesglose | null> {
  const { data, error } = await acotada(supabaseAdmin().from('desglose_peaje')
    .select('anulado_en, aviso_oficina_en, aviso_intentos, proveedor, periodo_desde, periodo_hasta')
    .eq('tenant_id', tenantId).eq('id', desgloseId).maybeSingle(), 'peajes.estado_aviso');
  if (error) throw new Error(`leerEstadoAvisoDesglose: ${error.message}`);
  if (!data) return null;
  return {
    anulado: data.anulado_en != null, avisoEn: (data.aviso_oficina_en as string | null) ?? null, intentos: Number(data.aviso_intentos ?? 0),
    proveedor: (data.proveedor as string | null) ?? null,
    periodoDesde: (data.periodo_desde as string | null) ?? null, periodoHasta: (data.periodo_hasta as string | null) ?? null,
  };
}

/**
 * Reclama UN intento de aviso (compare-and-set sobre `aviso_intentos`): dos procesos que
 * leyeron el mismo conteo no pueden ganar los dos, así que el aviso no sale doble.
 */
export async function reclamarIntentoAviso(tenantId: string, desgloseId: string, intentosLeidos: number): Promise<boolean> {
  const { data, error } = await acotada(supabaseAdmin().from('desglose_peaje')
    .update({ aviso_requerido: true, aviso_intentos: intentosLeidos + 1 })
    .eq('tenant_id', tenantId).eq('id', desgloseId).eq('aviso_intentos', intentosLeidos)
    .is('aviso_oficina_en', null).is('anulado_en', null).select('id'), 'peajes.reclamar_aviso');
  if (error) throw new Error(`reclamarIntentoAviso: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function marcarAvisoEnviado(tenantId: string, desgloseId: string): Promise<void> {
  const { error } = await acotada(supabaseAdmin().from('desglose_peaje')
    .update({ aviso_oficina_en: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', desgloseId).is('aviso_oficina_en', null), 'peajes.marcar_aviso');
  if (error) logger.error('peajes.marcar_aviso', { tenant: tenantId, err: error.message });
}

/** Los desgloses con aviso por enviar, de todas las flotas (barrido del cron; solo ids). */
export async function avisosPendientesPeajes(limite: number): Promise<Array<{ tenantId: string; desgloseId: string }>> {
  const r = await acotada(supabaseAdmin().rpc('peaje_avisos_pendientes', { p_limite: limite, p_max_intentos: MAX_INTENTOS_AVISO }), 'peajes.avisos_pendientes');
  if (r.error) throw new Error(`peajes.avisos_pendientes: ${r.error.message}`);
  return ((r.data ?? []) as Array<Record<string, unknown>>).map((f) => ({ tenantId: String(f.tenant_id), desgloseId: String(f.desglose_id) }));
}

export type ResultadoAnulacion = 'anulado' | 'ya_anulado' | 'no_encontrado';

/**
 * Anula un desglose (de ESTA flota): condicional a «aún no anulado», así dos anulaciones
 * simultáneas dejan un solo autor. Además LIBERA la huella del archivo de la cola que lo
 * generó (la reemplaza por otra derivada, con la misma forma): el archivo correcto, o el
 * mismo ya arreglado, puede volver a mandarse sin que lo tome por duplicado.
 */
export async function anularDesgloseDb(tenantId: string, desgloseId: string, motivo: string, por: string): Promise<ResultadoAnulacion> {
  const ahora = new Date().toISOString();
  const upd = await acotada(supabaseAdmin().from('desglose_peaje')
    .update({ anulado_en: ahora, anulado_por: por.slice(0, 120), anulado_motivo: motivo.trim().slice(0, 500) })
    .eq('tenant_id', tenantId).eq('id', desgloseId).is('anulado_en', null).select('id'), 'peajes.anular');
  if (upd.error) throw new Error(`anularDesglose: ${upd.error.message}`);
  if ((upd.data ?? []).length === 0) {
    const ex = await acotada(supabaseAdmin().from('desglose_peaje').select('id').eq('tenant_id', tenantId).eq('id', desgloseId).maybeSingle(), 'peajes.anular_existe');
    if (ex.error) throw new Error(`anularDesglose: ${ex.error.message}`);
    return ex.data ? 'ya_anulado' : 'no_encontrado';
  }
  const arch = await acotada(supabaseAdmin().from('peaje_ingesta_archivo')
    .select('id, huella').eq('tenant_id', tenantId).eq('desglose_id', desgloseId).order('id'), 'peajes.anular_archivos');
  if (arch.error) throw new Error(`anularDesglose: ${arch.error.message}`);
  for (const a of (arch.data ?? []) as Array<{ id: string; huella: string }>) {
    const libre = createHash('sha256').update(`${a.huella}:anulada:${desgloseId}`).digest('hex');
    const r = await acotada(supabaseAdmin().from('peaje_ingesta_archivo').update({ huella: libre })
      .eq('tenant_id', tenantId).eq('id', a.id), 'peajes.anular_huella');
    if (r.error) logger.error('peajes.anular_huella', { tenant: tenantId, err: r.error.message });
  }
  return 'anulado';
}

export interface ArchivoIngestaVista {
  id: string; nombre: string; proveedor: string | null; estado: string; intentos: number; bytes: number;
  recibidaEn: string; procesadaEn: string | null; ultimoError: string | null; desgloseId: string | null; reintentable: boolean;
}

/** Los últimos archivos recibidos por el buzón (sin el contenido). */
export async function listarArchivosIngesta(tenantId: string, limite = 20): Promise<ArchivoIngestaVista[]> {
  const { data, error } = await acotada(supabaseAdmin().from('peaje_ingesta_archivo')
    .select('id, nombre, proveedor, estado, intentos, bytes, recibida_en, procesada_en, ultimo_error, desglose_id')
    .eq('tenant_id', tenantId).order('recibida_en', { ascending: false }).order('id').limit(limite), 'peajes.archivos_ingesta');
  if (error) throw new Error(`listarArchivosIngesta: ${error.message}`);
  return (data ?? []).map((f) => ({
    id: String(f.id), nombre: String(f.nombre), proveedor: (f.proveedor as string | null) ?? null, estado: String(f.estado),
    intentos: Number(f.intentos), bytes: Number(f.bytes), recibidaEn: String(f.recibida_en),
    procesadaEn: (f.procesada_en as string | null) ?? null, ultimoError: (f.ultimo_error as string | null) ?? null,
    desgloseId: (f.desglose_id as string | null) ?? null, reintentable: f.estado === 'fallida',
  }));
}

// ── El cruce por caseta: posiciones por ventana + motor puro (antes cruce_gps_datos.ts) ──
// Lanza ante error de base — un contexto a medias produciría «sin posiciones»
// falsos, que es el hueco que este módulo no inventa.

/** Ventanas por consulta: 100 ventanas × ~8 posiciones (cadencia de 5 min) ≈ 800 filas por tanda. */
const VENTANAS_POR_TANDA = 100;

export interface ResultadoGpsLinea { lineaId: string; casetaId: string | null; veredicto: VeredictoGps }

/** Una ventana de posiciones a traer: las de `unidadId` entre `desde` y `hasta`, identificada por la línea que la pide. */
export interface VentanaPosiciones { lineaId: string; unidadId: string; desde: string; hasta: string }

/** Las posiciones de cada ventana, por línea, en tandas (el RPC `peaje_posiciones_ventana`). Reusada por la conciliación y por el reporte de reclamación. */
export async function traerMuestrasPorLinea(tenantId: string, ventanas: readonly VentanaPosiciones[]): Promise<Map<string, Muestra[]>> {
  const porLinea = new Map<string, Muestra[]>();
  for (let i = 0; i < ventanas.length; i += VENTANAS_POR_TANDA) {
    const tanda = ventanas.slice(i, i + VENTANAS_POR_TANDA).map((p) => ({ linea_id: p.lineaId, unidad_id: p.unidadId, desde: p.desde, hasta: p.hasta }));
    const filas = await traerTodo<{ linea_id: unknown; lat: unknown; lng: unknown; medida_en: unknown }>(
      (d, h) => acotada(
        supabaseAdmin().rpc('peaje_posiciones_ventana', { p_tenant: tenantId, p_ventanas: tanda }, conteo(d))
          .order('linea_id').order('medida_en').order('lat').order('lng').range(d, h),
        'peajes.posiciones_ventana',
      ),
      'peajes.posiciones_ventana',
    );
    for (const f of filas) {
      const id = String(f.linea_id);
      const l = porLinea.get(id) ?? [];
      l.push({ lat: Number(f.lat), lng: Number(f.lng), t: Date.parse(String(f.medida_en)) });
      porLinea.set(id, l);
    }
  }
  return porLinea;
}

export async function evaluarGpsDeLineas(
  tenantId: string,
  lineas: readonly LineaParaGps[],
  catalogo: readonly CasetaCatalogo[],
): Promise<ResultadoGpsLinea[]> {
  const planes = planificarGps(lineas, catalogo);
  const listos = planes.filter((p): p is Extract<typeof p, { listo: true }> => p.listo);
  const muestrasPorLinea = await traerMuestrasPorLinea(tenantId, listos.map((p) => ({ lineaId: p.lineaId, unidadId: p.unidadId, desde: p.desde, hasta: p.hasta })));

  return planes.map((p) => {
    if (!p.listo) return { lineaId: p.lineaId, casetaId: p.casetaId, veredicto: p.veredicto };
    return { lineaId: p.lineaId, casetaId: p.casetaId, veredicto: evaluarCruceGps(p.cruceMs, p.caseta, muestrasPorLinea.get(p.lineaId) ?? []) };
  });
}
