import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';
import { traerTodo, conteo } from '../pg';
import { normalizarNombre, normalizarTag } from './formatos';
import { matrizDeArchivoCatalogo } from './archivo';
import { parsearCasetasMatriz, type CasetaCatalogo } from './casetas';
import { parsearTagsMatriz, resolverUnidadesDeTags } from './tags';
import { validarMapeo, type ConfigMapeo } from './mapeo';
import { planificarGps, evaluarCruceGps, type LineaParaGps, type VeredictoGps, type Muestra } from './cruce_gps';

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
export interface GeocercaVista { id: string; nombre: string; tipo: string; lat: number; lng: number; radioM: number; activa: boolean }
export const TIPOS_GEOCERCA = ['origen', 'destino', 'patio', 'punto_interes', 'restringida'] as const;

export async function listarGeocercas(tenantId: string): Promise<GeocercaVista[]> {
  const filas = await traerTodo<{ id: unknown; nombre: unknown; tipo: unknown; lat: unknown; lng: unknown; radio_m: unknown; activa: unknown }>(
    (d, h) => acotada(supabaseAdmin().from('geocerca')
      .select('id, nombre, tipo, lat, lng, radio_m, activa', conteo(d))
      .eq('tenant_id', tenantId).order('nombre').order('id').range(d, h), 'peajes.geocercas'),
    'peajes.geocercas',
  );
  return filas.map((f) => ({
    id: String(f.id), nombre: String(f.nombre), tipo: String(f.tipo),
    lat: Number(f.lat), lng: Number(f.lng), radioM: Number(f.radio_m), activa: f.activa !== false,
  }));
}

export type ResultadoGeocerca = { ok: true } | { ok: false; motivo: string };

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
  const { error } = await acotada(supabaseAdmin().from('geocerca').upsert({
    tenant_id: tenantId, nombre, tipo: e.tipo, lat: e.lat, lng: e.lng, radio_m: e.radioM, activa: true,
  }, { onConflict: 'tenant_id,nombre' }), 'peajes.guardar_geocerca');
  if (error) {
    logger.error('peajes.guardar_geocerca', { tenant: tenantId, err: error.message });
    return { ok: false, motivo: 'No se pudo guardar la geocerca. Inténtalo de nuevo.' };
  }
  return { ok: true };
}

export async function cambiarEstadoGeocerca(tenantId: string, id: string, activa: boolean): Promise<boolean> {
  const { error } = await acotada(supabaseAdmin().from('geocerca').update({ activa }).eq('tenant_id', tenantId).eq('id', id), 'peajes.estado_geocerca');
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
    .select('id, proveedor, columnas, activo').eq('tenant_id', tenantId).order('proveedor').limit(200), 'peajes.mapeos');
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

export interface ArchivoIngestaVista {
  id: string; nombre: string; proveedor: string | null; estado: string; intentos: number; bytes: number;
  recibidaEn: string; procesadaEn: string | null; ultimoError: string | null; desgloseId: string | null; reintentable: boolean;
}

/** Los últimos archivos recibidos por el buzón (sin el contenido). */
export async function listarArchivosIngesta(tenantId: string, limite = 20): Promise<ArchivoIngestaVista[]> {
  const { data, error } = await acotada(supabaseAdmin().from('peaje_ingesta_archivo')
    .select('id, nombre, proveedor, estado, intentos, bytes, recibida_en, procesada_en, ultimo_error, desglose_id')
    .eq('tenant_id', tenantId).order('recibida_en', { ascending: false }).limit(limite), 'peajes.archivos_ingesta');
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

export async function evaluarGpsDeLineas(
  tenantId: string,
  lineas: readonly LineaParaGps[],
  catalogo: readonly CasetaCatalogo[],
): Promise<ResultadoGpsLinea[]> {
  const planes = planificarGps(lineas, catalogo);
  const listos = planes.filter((p): p is Extract<typeof p, { listo: true }> => p.listo);

  const muestrasPorLinea = new Map<string, Muestra[]>();
  for (let i = 0; i < listos.length; i += VENTANAS_POR_TANDA) {
    const tanda = listos.slice(i, i + VENTANAS_POR_TANDA);
    const ventanas = tanda.map((p) => ({ linea_id: p.lineaId, unidad_id: p.unidadId, desde: p.desde, hasta: p.hasta }));
    const filas = await traerTodo<{ linea_id: unknown; lat: unknown; lng: unknown; medida_en: unknown }>(
      (d, h) => acotada(
        supabaseAdmin().rpc('peaje_posiciones_ventana', { p_tenant: tenantId, p_ventanas: ventanas }, conteo(d))
          .order('linea_id').order('medida_en').order('lat').order('lng').range(d, h),
        'peajes.posiciones_ventana',
      ),
      'peajes.posiciones_ventana',
    );
    for (const f of filas) {
      const id = String(f.linea_id);
      const l = muestrasPorLinea.get(id) ?? [];
      l.push({ lat: Number(f.lat), lng: Number(f.lng), t: Date.parse(String(f.medida_en)) });
      muestrasPorLinea.set(id, l);
    }
  }

  return planes.map((p) => {
    if (!p.listo) return { lineaId: p.lineaId, casetaId: p.casetaId, veredicto: p.veredicto };
    return { lineaId: p.lineaId, casetaId: p.casetaId, veredicto: evaluarCruceGps(p.cruceMs, p.caseta, muestrasPorLinea.get(p.lineaId) ?? []) };
  });
}
