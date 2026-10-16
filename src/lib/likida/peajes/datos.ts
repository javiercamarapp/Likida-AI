import { supabaseAdmin } from '@/lib/supabase/admin';
import { hoyMx } from '@/lib/formato';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';
import { traerTodo, traerPorIds, conteo, type RespuestaPg } from '../pg';
import { normalizarNombre, normalizarTag } from './formatos';
import { COLUMNAS_POLIGONO, conPoligonoOCirculo, geometriaDeFila } from '../conductor/geometria_datos';
import { matrizDeArchivoCatalogo } from './archivo';
import { parsearCasetasMatriz, type CasetaCatalogo } from './casetas';
import { parsearTarifasMatriz, planificarTarifa, type OrigenTarifa, type TarifaEntrada, type TarifaExistente } from './tarifario_archivo';
import { parsearTagsMatriz, resolverUnidadesDeTags, validarBajaTag, type VigenciaTag } from './tags';
import { validarMapeo, type ConfigMapeo } from './mapeo';
import { planificarGps, evaluarCruceGps, type LineaParaGps, type VeredictoGps, type Muestra } from './cruce_gps';
import { createHash } from 'node:crypto';
import { generarToken, esTokenValido } from '@/lib/correo/buzon';
import { hostNoPublico } from '@/lib/http/destino_publico';
import { cifrar, cofreConfigurado } from '../conectores/cofre';
import type { HallazgoAtipico, ConfigAtipicos } from './atipicos';
import { validarConfigAvisos, configAvisosEfectiva, type ConfigAvisos } from './config_avisos';
import { validarConfigAtipicos, configAtipicosEfectiva, esEstadoAtipico, puedeCambiarEstado, exigeRevisor, type EstadoAtipico } from './atipicos_config';

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
export interface TagVista { id: string; tag: string; tagOriginal: string | null; unidadId: string; unidadEconomico: string | null; proveedor: string | null; activo: boolean;
  /** Último día vigente, si el TAG se dio de baja (`peaje_tag_baja`). */
  bajaEn?: string | null; bajaMotivo?: string | null }

export async function listarTags(tenantId: string): Promise<TagVista[]> {
  const filas = await traerTodo<{ id: unknown; tag: unknown; tag_original: unknown; unidad_id: unknown; proveedor: unknown; activo: unknown }>(
    (d, h) => acotada(supabaseAdmin()
      .from('peaje_tag').select('id, tag, tag_original, unidad_id, proveedor, activo', conteo(d))
      .eq('tenant_id', tenantId).order('tag').order('id').range(d, h), 'peajes.tags'),
    'peajes.tags',
  );
  const unidades = await listarUnidades(tenantId);
  const eco = new Map(unidades.map((u) => [u.id, u.numeroEconomico]));
  const bajas = await leerBajas(tenantId);
  return filas.map((f) => {
    const baja = bajas.get(String(f.tag));
    return {
      id: String(f.id), tag: String(f.tag), tagOriginal: (f.tag_original as string | null) ?? null,
      unidadId: String(f.unidad_id), unidadEconomico: eco.get(String(f.unidad_id)) ?? null,
      proveedor: (f.proveedor as string | null) ?? null, activo: f.activo !== false,
      bajaEn: baja?.bajaEn ?? null, bajaMotivo: baja?.motivo ?? null,
    };
  });
}

/** TAG normalizado → su baja registrada (`peaje_tag_baja`, 0776). */
async function leerBajas(tenantId: string): Promise<Map<string, { bajaEn: string; motivo: string | null }>> {
  const filas = await traerTodo<{ tag: unknown; baja_en: unknown; motivo: unknown }>(
    (d, h) => acotada(supabaseAdmin()
      .from('peaje_tag_baja').select('tag, baja_en, motivo', conteo(d))
      .eq('tenant_id', tenantId).order('tag').range(d, h), 'peajes.tags_baja'),
    'peajes.tags_baja',
  );
  return new Map(filas.map((f) => [String(f.tag), { bajaEn: String(f.baja_en).slice(0, 10), motivo: (f.motivo as string | null) ?? null }]));
}

/**
 * TODOS los TAGs (activos o dados de baja) con la unidad que los tuvo y su baja, si la hay.
 * Es lo que necesita `resolverTagEnFecha` para que un cruce ANTERIOR a la baja conserve su
 * unidad y uno POSTERIOR no. Lanza ante error de base (un mapa a medias daría «sin alta» falsos).
 */
export async function cargarVigenciaTags(tenantId: string): Promise<Map<string, VigenciaTag>> {
  const filas = await traerTodo<{ tag: unknown; unidad_id: unknown }>(
    (d, h) => acotada(supabaseAdmin()
      .from('peaje_tag').select('tag, unidad_id', conteo(d))
      .eq('tenant_id', tenantId).order('tag').range(d, h), 'peajes.vigencia_tags'),
    'peajes.vigencia_tags',
  );
  const bajas = await leerBajas(tenantId);
  return new Map(filas.map((f) => [String(f.tag), { unidadId: String(f.unidad_id), bajaEn: bajas.get(String(f.tag))?.bajaEn ?? null }]));
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

export type ResultadoAltaTag = { ok: true; /** El TAG estaba de baja y volvió a darse de alta: la baja se retira. */ reactivadoDesdeBaja?: string } | { ok: false; motivo: string };

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
  return quitarBajasDeTags(tenantId, [tag]);
}

/** Dar de alta otra vez un TAG dado de baja lo reactiva: se retira su baja para que sus cruces nuevos no se marquen. */
async function quitarBajasDeTags(tenantId: string, tags: readonly string[]): Promise<ResultadoAltaTag> {
  let desde: string | undefined;
  for (const lote of lotes(tags)) {
    const { data: previas, error: eLeer } = await acotada(
      supabaseAdmin().from('peaje_tag_baja').select('tag, baja_en').eq('tenant_id', tenantId).in('tag', lote), 'peajes.reactivar_leer');
    if (eLeer) { logger.error('peajes.reactivar_leer', { tenant: tenantId, err: eLeer.message }); return { ok: false, motivo: 'El TAG se guardó, pero no se pudo comprobar si estaba de baja. Vuelve a guardarlo.' }; }
    if (!previas || previas.length === 0) continue;
    desde = String((previas[0] as { baja_en: unknown }).baja_en).slice(0, 10);
    const { error } = await acotada(supabaseAdmin().from('peaje_tag_baja').delete().eq('tenant_id', tenantId).in('tag', lote), 'peajes.reactivar');
    if (error) { logger.error('peajes.reactivar', { tenant: tenantId, err: error.message }); return { ok: false, motivo: 'El TAG se guardó, pero no se pudo retirar su baja. Vuelve a guardarlo.' }; }
  }
  return desde ? { ok: true, reactivadoDesdeBaja: desde } : { ok: true };
}

/**
 * BAJA LÓGICA (ya no borra la fila). Registra la fecha y el motivo en `peaje_tag_baja` y, si la
 * baja ya rige (`fecha` ≤ hoy), deja el TAG en `activo=false`. El historial de cruces anteriores
 * sigue resolviendo su unidad (`cargarVigenciaTags` + `resolverTagEnFecha`) y la regla
 * `tag_dado_de_baja` marca los cruces posteriores. Es idempotente: repetirla actualiza fecha y motivo.
 */
export async function bajaTag(
  tenantId: string,
  tagId: string,
  baja: { fecha: unknown; motivo?: unknown },
  hoy: string = hoyMx(),
): Promise<ResultadoAltaTag> {
  const v = validarBajaTag(baja, hoy);
  if (!v.ok) return v;
  const { data: fila, error: eLeer } = await acotada(
    supabaseAdmin().from('peaje_tag').select('id, tag, tag_original').eq('tenant_id', tenantId).eq('id', tagId).maybeSingle(), 'peajes.baja_tag_leer');
  if (eLeer) { logger.error('peajes.baja_tag_leer', { tenant: tenantId, err: eLeer.message }); return { ok: false, motivo: 'No se pudo leer el TAG. Inténtalo de nuevo.' }; }
  if (!fila) return { ok: false, motivo: 'Ese TAG ya no existe en tu flota.' };
  const f = fila as { tag: unknown; tag_original: unknown };
  const { error: eBaja } = await acotada(supabaseAdmin().from('peaje_tag_baja').upsert({
    tenant_id: tenantId, tag: String(f.tag), tag_original: (f.tag_original as string | null) ?? null, baja_en: v.fecha, motivo: v.motivo,
  }, { onConflict: 'tenant_id,tag' }), 'peajes.baja_tag');
  if (eBaja) { logger.error('peajes.baja_tag', { tenant: tenantId, err: eBaja.message }); return { ok: false, motivo: 'No se pudo registrar la baja del TAG. Inténtalo de nuevo.' }; }
  // Una baja programada (fecha futura) no apaga el TAG hoy; una vencida o de hoy sí.
  const { error: eAct } = await acotada(
    supabaseAdmin().from('peaje_tag').update({ activo: !v.vigente }).eq('tenant_id', tenantId).eq('id', tagId), 'peajes.baja_tag_activo');
  if (eAct) { logger.error('peajes.baja_tag_activo', { tenant: tenantId, err: eAct.message }); return { ok: false, motivo: 'La baja quedó registrada, pero no se pudo apagar el TAG. Repite la baja.' }; }
  return { ok: true };
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
    // `tipo_unidad` (0812) solo se escribe si el CSV lo trae: una celda vacía NO borra el tipo ya capturado.
    // Las filas con y sin tipo van en upserts separados para que cada lote tenga las mismas columnas.
    const fila = (a: (typeof lote)[number]) => ({
      tenant_id: tenantId, tag: a.tag, tag_original: a.tagOriginal, unidad_id: a.unidadId, proveedor: a.proveedor, activo: true,
    });
    const conTipo = lote.filter((a) => a.tipoUnidad).map((a) => ({ ...fila(a), tipo_unidad: a.tipoUnidad }));
    const sinTipo = lote.filter((a) => !a.tipoUnidad).map(fila);
    let error: { message: string } | null = null;
    for (const grupo of [sinTipo, conTipo]) {
      if (grupo.length === 0 || error) continue;
      ({ error } = await acotada(supabaseAdmin().from('peaje_tag').upsert(grupo, { onConflict: 'tenant_id,tag' }), 'peajes.importar_tags'));
    }
    if (error) {
      logger.error('peajes.importar_tags', { tenant: tenantId, err: error.message });
      return { ok: false, guardadas, actualizadas, rechazadas: todasRechazadas, error: `Se guardaron ${guardadas} TAGs y el resto falló. Vuelve a subir el archivo: es seguro repetirlo.` };
    }
    // El importador reactiva (activo=true): un TAG que estaba de baja deja de estarlo.
    const reactivadas = await quitarBajasDeTags(tenantId, lote.map((a) => a.tag));
    if (!reactivadas.ok) return { ok: false, guardadas, actualizadas, rechazadas: todasRechazadas, error: reactivadas.motivo };
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
    lat: f.lat === null || f.lat === undefined ? null : Number(f.lat),
    lng: f.lng === null || f.lng === undefined ? null : Number(f.lng),
    radioM: Number(f.radio_m),
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
    // Las filas SIN coordenadas se escriben sin las llaves lat/lng: un archivo que solo trae nombres no debe
    // borrar las coordenadas que la flota ya había cargado de esa caseta.
    const fila = (c: (typeof lote)[number]) => ({
      tenant_id: tenantId, nombre: c.nombre, nombre_norm: c.nombreNorm, alias: c.alias,
      radio_m: c.radioM, activa: true, fuente: c.fuente ?? fuenteDefault,
      ...(c.lat !== null && c.lng !== null ? { lat: c.lat, lng: c.lng } : {}),
      ...(c.porPasada === undefined ? {} : { por_pasada: c.porPasada }),
    });
    let error = null as { message: string } | null;
    // Se agrupan por forma (con/sin coordenadas, con/sin por_pasada) para que cada upsert lleve las mismas columnas.
    const grupos = new Map<string, typeof lote>();
    for (const c of lote) {
      const k = `${c.lat !== null ? 'c' : 's'}${c.porPasada === undefined ? 'n' : 'p'}`;
      grupos.set(k, [...(grupos.get(k) ?? []), c]);
    }
    for (const grupo of grupos.values()) {
      const r = await acotada(supabaseAdmin().from('peaje_caseta').upsert(grupo.map(fila), { onConflict: 'tenant_id,nombre_norm' }), 'peajes.importar_casetas');
      if (r.error) { error = r.error; break; }
    }
    if (error) {
      logger.error('peajes.importar_casetas', { tenant: tenantId, err: error.message });
      return { ok: false, guardadas, actualizadas, rechazadas: lectura.rechazadas, error: `Se guardaron ${guardadas} casetas y el resto falló. Vuelve a subir el archivo: es seguro repetirlo.` };
    }
    for (const c of lote) {
      guardadas++;
      const p = porNorm.get(c.nombreNorm);
      if (p && ((c.lat !== null && (p.lat !== c.lat || p.lng !== c.lng)) || p.radioM !== c.radioM)) actualizadas++;
    }
  }
  return { ok: true, guardadas, actualizadas, rechazadas: lectura.rechazadas };
}

export async function cambiarEstadoCaseta(tenantId: string, casetaId: string, activa: boolean): Promise<boolean> {
  const { error } = await acotada(supabaseAdmin().from('peaje_caseta').update({ activa }).eq('tenant_id', tenantId).eq('id', casetaId), 'peajes.estado_caseta');
  if (error) logger.error('peajes.estado_caseta', { tenant: tenantId, err: error.message });
  return !error;
}

// ── Tarifario por caseta y clase (migración 0811) ───────────────────────────
// Las reglas (traslapes, confirmación) viven en `tarifario_archivo.ts`; aquí solo se lee y se escribe.
// Ninguna tarifa se crea confirmada salvo una carga marcada «proveedor»; confirmar es `confirmarTarifa`.
export interface TarifaVista extends TarifaExistente { id: string; creadaEn: string | null }

const COLUMNAS_TARIFA = 'id, caseta_norm, clase, importe, vigente_desde, vigente_hasta, origen, confirmada, confirmada_por, created_at';

type FilaTarifa = { id: unknown; caseta_norm: unknown; clase: unknown; importe: unknown; vigente_desde: unknown; vigente_hasta: unknown; origen: unknown; confirmada: unknown; confirmada_por: unknown; created_at: unknown };

function tarifaDeFila(f: FilaTarifa): TarifaVista {
  return {
    id: String(f.id), casetaNorm: String(f.caseta_norm), clase: Number(f.clase), importe: Number(f.importe),
    vigenteDesde: String(f.vigente_desde), vigenteHasta: f.vigente_hasta === null || f.vigente_hasta === undefined ? null : String(f.vigente_hasta),
    origen: f.origen as OrigenTarifa, confirmada: f.confirmada === true,
    confirmadaPor: f.confirmada_por === null || f.confirmada_por === undefined ? null : String(f.confirmada_por),
    creadaEn: f.created_at === null || f.created_at === undefined ? null : String(f.created_at),
  };
}

export async function listarTarifas(tenantId: string, filtro: { caseta?: string; clase?: number } = {}): Promise<TarifaVista[]> {
  const casetaNorm = filtro.caseta === undefined ? null : normalizarNombre(filtro.caseta);
  const filas = await traerTodo<FilaTarifa>(
    (d, h) => {
      let q = supabaseAdmin().from('peaje_tarifa').select(COLUMNAS_TARIFA, conteo(d)).eq('tenant_id', tenantId);
      if (casetaNorm !== null) q = q.eq('caseta_norm', casetaNorm);
      if (filtro.clase !== undefined) q = q.eq('clase', filtro.clase);
      return acotada(q.order('caseta_norm').order('clase').order('vigente_desde').order('id').range(d, h), 'peajes.tarifas');
    },
    'peajes.tarifas',
  );
  return filas.map(tarifaDeFila);
}

const filaParaEscribir = (tenantId: string, t: TarifaExistente) => ({
  tenant_id: tenantId, caseta_norm: t.casetaNorm, clase: t.clase, importe: t.importe,
  vigente_desde: t.vigenteDesde, vigente_hasta: t.vigenteHasta, origen: t.origen,
  confirmada: t.confirmada, confirmada_por: t.confirmadaPor,
});

export type ResultadoGuardarTarifa =
  | { ok: true; accion: 'creada' | 'actualizada' | 'sin_cambios'; confirmada: boolean }
  | { ok: false; motivo: string };

/** Guarda (crea o actualiza por caseta+clase+inicio) UNA tarifa. `origen` por omisión: «declarada» (nunca nace confirmada). */
export async function guardarTarifa(tenantId: string, entrada: TarifaEntrada, origen: OrigenTarifa = 'declarada'): Promise<ResultadoGuardarTarifa> {
  let existentes: TarifaVista[];
  try {
    existentes = await listarTarifas(tenantId, { caseta: entrada.caseta, clase: entrada.clase });
  } catch (e) {
    logger.error('peajes.guardar_tarifa_lectura', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    return { ok: false, motivo: 'No se pudo leer el tarifario actual. Inténtalo de nuevo.' };
  }
  const plan = planificarTarifa(existentes, entrada, origen);
  if (plan.tipo === 'rechazada') return { ok: false, motivo: plan.motivo };
  if (plan.tipo === 'igual') return { ok: true, accion: 'sin_cambios', confirmada: plan.fila.confirmada };
  const { error } = await acotada(
    supabaseAdmin().from('peaje_tarifa').upsert(filaParaEscribir(tenantId, plan.fila), { onConflict: 'tenant_id,caseta_norm,clase,vigente_desde' }),
    'peajes.guardar_tarifa',
  );
  if (error) {
    logger.error('peajes.guardar_tarifa', { tenant: tenantId, err: error.message });
    return { ok: false, motivo: 'No se pudo guardar la tarifa. Inténtalo de nuevo.' };
  }
  return { ok: true, accion: plan.tipo === 'crear' ? 'creada' : 'actualizada', confirmada: plan.fila.confirmada };
}

export type ResultadoConfirmarTarifa = { ok: true; yaConfirmada: boolean } | { ok: false; motivo: string };

/** La acción humana que vuelve «confirmada» una tarifa: queda quién la confirmó. */
export async function confirmarTarifa(tenantId: string, tarifaId: string, por: string): Promise<ResultadoConfirmarTarifa> {
  const quien = por.trim().replace(/\s+/g, ' ');
  if (!quien) return { ok: false, motivo: 'Indica quién confirma la tarifa.' };
  if (quien.length > 120) return { ok: false, motivo: 'El nombre de quien confirma pasa de 120 caracteres.' };
  const { data, error } = await acotada(
    supabaseAdmin().from('peaje_tarifa').select(COLUMNAS_TARIFA).eq('tenant_id', tenantId).eq('id', tarifaId).maybeSingle(),
    'peajes.confirmar_tarifa_lectura',
  );
  if (error) {
    logger.error('peajes.confirmar_tarifa_lectura', { tenant: tenantId, err: error.message });
    return { ok: false, motivo: 'No se pudo leer la tarifa. Inténtalo de nuevo.' };
  }
  if (!data) return { ok: false, motivo: 'No encontré esa tarifa.' };
  if ((data as FilaTarifa).confirmada === true) return { ok: true, yaConfirmada: true };
  const upd = await acotada(
    supabaseAdmin().from('peaje_tarifa').update({ confirmada: true, confirmada_por: quien }).eq('tenant_id', tenantId).eq('id', tarifaId),
    'peajes.confirmar_tarifa',
  );
  if (upd.error) {
    logger.error('peajes.confirmar_tarifa', { tenant: tenantId, err: upd.error.message });
    return { ok: false, motivo: 'No se pudo confirmar la tarifa. Inténtalo de nuevo.' };
  }
  return { ok: true, yaConfirmada: false };
}

/**
 * Importa un CSV/Excel de tarifas (`caseta;clase;importe;desde;hasta`). `origen` es lo que el llamador
 * DECLARA del archivo: solo «proveedor» deja las tarifas confirmadas. Si el archivo no trae «desde», la
 * vigencia empieza hoy (hora de México). Repetirlo es seguro.
 */
export async function importarTarifasArchivo(
  tenantId: string, nombre: string, buffer: Uint8Array, origen: OrigenTarifa = 'declarada',
): Promise<ResultadoImportacionCatalogo> {
  const falla = (error: string): ResultadoImportacionCatalogo => ({ ok: false, guardadas: 0, actualizadas: 0, rechazadas: [], error });
  const m = matrizDeArchivoCatalogo(nombre, buffer);
  if (!m.ok) return falla(m.motivo);
  const lectura = parsearTarifasMatriz(m.matriz, { desdePorDefecto: hoyMx() });
  if (lectura.error) return falla(lectura.error);
  if (lectura.tarifas.length === 0) return { ok: true, guardadas: 0, actualizadas: 0, rechazadas: lectura.rechazadas };

  let vigentes: TarifaExistente[];
  try {
    vigentes = await listarTarifas(tenantId);
  } catch (e) {
    logger.error('peajes.importar_tarifas_lectura', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    return falla('No se pudo leer el tarifario actual. Inténtalo de nuevo.');
  }
  const rechazadas = [...lectura.rechazadas];
  const aEscribir: TarifaExistente[] = [];
  let guardadas = 0;
  let actualizadas = 0;
  for (const t of lectura.tarifas) {
    // Se planifica contra lo guardado MÁS lo ya aceptado de este mismo archivo.
    const plan = planificarTarifa(vigentes, t, origen);
    if (plan.tipo === 'rechazada') { rechazadas.push({ fila: t.fila, motivo: plan.motivo }); continue; }
    guardadas++;
    if (plan.tipo === 'actualizar') actualizadas++;
    if (plan.tipo !== 'igual') aEscribir.push(plan.fila);
    vigentes = [...vigentes.filter((v) => !(v.casetaNorm === plan.fila.casetaNorm && v.clase === plan.fila.clase && v.vigenteDesde === plan.fila.vigenteDesde)), plan.fila];
  }
  rechazadas.sort((a, b) => a.fila - b.fila);
  for (const lote of lotes(aEscribir)) {
    const { error } = await acotada(
      supabaseAdmin().from('peaje_tarifa').upsert(lote.map((t) => filaParaEscribir(tenantId, t)), { onConflict: 'tenant_id,caseta_norm,clase,vigente_desde' }),
      'peajes.importar_tarifas',
    );
    if (error) {
      logger.error('peajes.importar_tarifas', { tenant: tenantId, err: error.message });
      return { ok: false, guardadas: 0, actualizadas: 0, rechazadas, error: 'No se pudo guardar el tarifario y no se aplicó ninguna fila de este lote. Vuelve a subir el archivo: es seguro repetirlo.' };
    }
  }
  return { ok: true, guardadas, actualizadas, rechazadas };
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

// ── Cursos (rutas autorizadas, 0665) ────────────────────────────────────────
// El I/O de `peaje_curso` y `peaje_curso_caseta`. Las reglas (qué es «fuera de curso») viven en `cursos.ts` (puro) y la
// traducción de nombres a ids en `cursos_importar.ts`; aquí solo se lee y se guarda. El guardado es la RPC 0665: todo-o-nada.

export interface CursoVista {
  id: string; codigo: string; nombre: string; tipo: 'casetas' | 'corredor';
  unidadId: string | null; convenioId: string | null;
  vigenteDesde: string | null; vigenteHasta: string | null; activo: boolean;
  /** Las casetas autorizadas, en orden de recorrido (solo `casetas`). */
  casetas: Array<{ id: string; nombre: string }>;
  corredor: Array<{ lat: number; lng: number }> | null;
  bufferM: number | null;
}

const puntosDeCorredor = (v: unknown): Array<{ lat: number; lng: number }> | null => {
  if (!Array.isArray(v)) return null;
  const pts = v.map((p) => ({ lat: Number((p as { lat?: unknown })?.lat), lng: Number((p as { lng?: unknown })?.lng) }));
  return pts.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)) ? pts : null;
};

/** Todos los cursos de la flota (activos o no) con sus casetas por nombre. Lanza si la base no contesta: un curso que falta produciría reclamos de más. */
export async function listarCursos(tenantId: string): Promise<CursoVista[]> {
  const admin = supabaseAdmin();
  const [cursos, enlaces, casetas] = await Promise.all([
    traerTodo<Record<string, unknown>>(
      (d, h) => acotada(admin.from('peaje_curso')
        .select('id, codigo, nombre, tipo, unidad_id, convenio_id, vigente_desde, vigente_hasta, activo, corredor, buffer_m', conteo(d))
        .eq('tenant_id', tenantId).order('codigo').order('id').range(d, h), 'peajes.cursos'),
      'peajes.cursos',
    ),
    traerTodo<{ curso_id: unknown; caseta_id: unknown; orden: unknown }>(
      (d, h) => acotada(admin.from('peaje_curso_caseta').select('curso_id, caseta_id, orden', conteo(d))
        .eq('tenant_id', tenantId).order('curso_id').order('orden').order('caseta_id').range(d, h), 'peajes.cursos_casetas'),
      'peajes.cursos_casetas',
    ),
    listarCasetas(tenantId),
  ]);
  const nombre = new Map(casetas.map((c) => [c.id, c.nombre]));
  const porCurso = new Map<string, Array<{ id: string; nombre: string }>>();
  for (const e of enlaces) {
    const lista = porCurso.get(String(e.curso_id)) ?? [];
    lista.push({ id: String(e.caseta_id), nombre: nombre.get(String(e.caseta_id)) ?? '' });
    porCurso.set(String(e.curso_id), lista);
  }
  return cursos.map((c) => ({
    id: String(c.id), codigo: String(c.codigo), nombre: String(c.nombre), tipo: c.tipo === 'corredor' ? 'corredor' : 'casetas',
    unidadId: (c.unidad_id as string | null) ?? null, convenioId: (c.convenio_id as string | null) ?? null,
    vigenteDesde: (c.vigente_desde as string | null) ?? null, vigenteHasta: (c.vigente_hasta as string | null) ?? null,
    activo: c.activo !== false, casetas: porCurso.get(String(c.id)) ?? [],
    corredor: puntosDeCorredor(c.corredor), bufferM: c.buffer_m === null || c.buffer_m === undefined ? null : Number(c.buffer_m),
  }));
}

/** Los convenios de la flota por nombre (para que el importador resuelva «Convenio X» a su id). */
export async function listarConveniosPorNombre(tenantId: string): Promise<Array<{ id: string; nombre: string }>> {
  const filas = await traerTodo<{ id: unknown; nombre: unknown }>(
    (d, h) => acotada(supabaseAdmin().from('cliente_convenio').select('id, nombre', conteo(d)).eq('tenant_id', tenantId).order('nombre').order('id').range(d, h), 'peajes.cursos_convenios'),
    'peajes.cursos_convenios',
  );
  return filas.map((f) => ({ id: String(f.id), nombre: String(f.nombre) }));
}

/** viaje → convenio ligado (0580 `viaje_convenio`), solo de los viajes pedidos. Los viajes sin convenio no aparecen. */
export async function convenioPorViaje(tenantId: string, viajeIds: readonly string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (viajeIds.length === 0) return m;
  const filas = await traerPorIds<{ viaje_id: unknown; convenio_id: unknown }>(
    [...viajeIds],
    (tanda) => acotada(supabaseAdmin().from('viaje_convenio').select('viaje_id, convenio_id').eq('tenant_id', tenantId).in('viaje_id', tanda), 'peajes.cursos_viaje_convenio'),
    'peajes.cursos_viaje_convenio',
  );
  for (const f of filas) if (f.convenio_id) m.set(String(f.viaje_id), String(f.convenio_id));
  return m;
}

export interface CursoParaGuardar {
  codigo: string; nombre: string; tipo: 'casetas' | 'corredor';
  unidadId: string | null; convenioId: string | null;
  vigenteDesde: string | null; vigenteHasta: string | null;
  casetaIds: string[];
  corredor: Array<{ lat: number; lng: number }> | null;
  bufferM: number | null;
}
export type ResultadoGuardarCursos =
  | { estado: 'ok'; creados: number; actualizados: number }
  | { estado: 'invalida' | 'referencia_invalida' | 'error' };

/** Guarda el lote TODO-O-NADA por la RPC 0665. Una referencia de otra flota (unidad, convenio o caseta) vuelve como `referencia_invalida` y no escribe nada. */
export async function guardarCursosLote(tenantId: string, cursos: readonly CursoParaGuardar[]): Promise<ResultadoGuardarCursos> {
  const lote = cursos.map((c) => ({
    codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, unidad_id: c.unidadId, convenio_id: c.convenioId,
    vigente_desde: c.vigenteDesde, vigente_hasta: c.vigenteHasta, buffer_m: c.bufferM, corredor: c.corredor, casetas: c.casetaIds,
  }));
  const { data, error } = await acotada(supabaseAdmin().rpc('peaje_curso_reemplazar', { p_tenant: tenantId, p_cursos: lote }), 'peajes.cursos_guardar');
  if (error) {
    logger.error('peajes.cursos_guardar', { tenant: tenantId, err: error.message });
    return { estado: 'error' };
  }
  // PostgREST entrega el jsonb de la función tal cual; un doble que entrega filas lo trae en la primera.
  const r = ((Array.isArray(data) ? data[0] : data) ?? {}) as { estado?: string; creados?: number; actualizados?: number };
  if (r.estado === 'ok') return { estado: 'ok', creados: Number(r.creados ?? 0), actualizados: Number(r.actualizados ?? 0) };
  return { estado: r.estado === 'referencia_invalida' ? 'referencia_invalida' : 'invalida' };
}

export async function cambiarEstadoCurso(tenantId: string, cursoId: string, activo: boolean): Promise<boolean> {
  const { error } = await acotada(supabaseAdmin().from('peaje_curso').update({ activo, actualizado_en: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', cursoId), 'peajes.estado_curso');
  if (error) logger.error('peajes.estado_curso', { tenant: tenantId, err: error.message });
  return !error;
}

// ── Cruces atípicos: umbrales y hallazgos (T-A2-12, migración 0779) ─────────

export interface ConfigAtipicosFlota {
  /** El detector corre SOLO si la flota lo activó. Apagado de origen. */
  activo: boolean;
  /** Umbrales vigentes (guardados y válidos, o los defaults). */
  umbrales: ConfigAtipicos;
}

/** La configuración de la flota. Sin fila = apagado y defaults. Lanza ante error de base. */
export async function leerConfigAtipicos(tenantId: string): Promise<ConfigAtipicosFlota> {
  const { data, error } = await acotada(supabaseAdmin().from('peaje_atipico_config')
    .select('activo, umbrales').eq('tenant_id', tenantId).maybeSingle(), 'peajes.config_atipicos');
  if (error) throw new Error(`leerConfigAtipicos: ${error.message}`);
  return { activo: data?.activo === true, umbrales: configAtipicosEfectiva(data?.umbrales) };
}

/** Valida y guarda los umbrales (y si el detector está activo). Un umbral inválido se rechaza con mensaje llano y no se guarda nada. */
export async function guardarConfigAtipicos(
  tenantId: string, entrada: { activo: boolean; umbrales?: unknown },
): Promise<{ ok: true; config: ConfigAtipicosFlota } | { ok: false; motivo: string }> {
  if (typeof entrada.activo !== 'boolean') return { ok: false, motivo: 'Indica si el detector está activo (sí o no).' };
  const v = validarConfigAtipicos(entrada.umbrales);
  if (!v.ok) return { ok: false, motivo: v.motivo };
  // El destinatario del aviso (`umbrales.aviso`, T-A2-14) no es un umbral: guardar umbrales no lo borra.
  const previa = await acotada(supabaseAdmin().from('peaje_atipico_config').select('umbrales').eq('tenant_id', tenantId).maybeSingle(), 'peajes.guardar_config_atipicos_previa');
  if (previa.error) {
    logger.error('peajes.guardar_config_atipicos', { tenant: tenantId, err: previa.error.message });
    return { ok: false, motivo: 'No se pudo guardar la configuración. Intenta de nuevo.' };
  }
  const aviso = (previa.data?.umbrales as { aviso?: unknown } | null | undefined)?.aviso;
  const { error } = await acotada(supabaseAdmin().from('peaje_atipico_config').upsert({
    tenant_id: tenantId, activo: entrada.activo, umbrales: aviso === undefined ? v.valor : { ...v.valor, aviso }, actualizado_en: new Date().toISOString(),
  }, { onConflict: 'tenant_id' }), 'peajes.guardar_config_atipicos');
  if (error) {
    logger.error('peajes.guardar_config_atipicos', { tenant: tenantId, err: error.message });
    return { ok: false, motivo: 'No se pudo guardar la configuración. Intenta de nuevo.' };
  }
  return { ok: true, config: { activo: entrada.activo, umbrales: v.valor } };
}

const LOTE_ATIPICOS = 200;

export interface ResultadoUpsertAtipicos { nuevos: number; yaExistian: number }

/**
 * Guarda los hallazgos de un desglose de forma IDEMPOTENTE: la `llave` (única por flota)
 * identifica la situación; re-correr el mismo desglose no duplica ni toca lo ya guardado
 * (el estado, la nota y quién revisó se conservan). `unidadIds` liga la unidad del archivo
 * con la unidad del sistema cuando se conoce. Lanza ante error de base.
 */
export async function upsertAtipicos(
  tenantId: string, desgloseId: string | null, hallazgos: readonly HallazgoAtipico[],
  unidadIds: ReadonlyMap<string, string> = new Map(),
): Promise<ResultadoUpsertAtipicos> {
  const unicos = [...new Map(hallazgos.map((h) => [h.llave, h])).values()];
  const existentes = new Set<string>();
  for (let i = 0; i < unicos.length; i += LOTE_ATIPICOS) {
    const llaves = unicos.slice(i, i + LOTE_ATIPICOS).map((h) => h.llave);
    const { data, error } = await acotada(supabaseAdmin().from('peaje_atipico')
      .select('llave').eq('tenant_id', tenantId).in('llave', llaves), 'peajes.atipicos_existentes');
    if (error) throw new Error(`upsertAtipicos: ${error.message}`);
    for (const f of (data ?? []) as Array<{ llave: unknown }>) existentes.add(String(f.llave));
  }
  const faltan = unicos.filter((h) => !existentes.has(h.llave));
  for (let i = 0; i < faltan.length; i += LOTE_ATIPICOS) {
    const filas = faltan.slice(i, i + LOTE_ATIPICOS).map((h) => ({
      tenant_id: tenantId,
      llave: h.llave,
      desglose_id: desgloseId,
      unidad_id: unidadIds.get(h.unidad) ?? null,
      unidad_archivo: h.unidad,
      regla: h.regla,
      monto: Math.round(h.monto * 100) / 100,
      estado: 'nuevo',
      detalle: {
        casetas: h.casetas, desde: h.desde, hasta: h.hasta, desdeLocal: h.desdeLocal, hastaLocal: h.hastaLocal,
        nCruces: h.nCruces, quePaso: h.quePaso, queSignifica: h.queSignifica, queHacer: h.queHacer,
      },
    }));
    // ignoreDuplicates = ON CONFLICT DO NOTHING: una carrera con otra corrida tampoco pisa un estado.
    const { error } = await acotada(supabaseAdmin().from('peaje_atipico')
      .upsert(filas, { onConflict: 'tenant_id,llave', ignoreDuplicates: true }), 'peajes.upsert_atipicos');
    if (error) throw new Error(`upsertAtipicos: ${error.message}`);
  }
  return { nuevos: faltan.length, yaExistian: unicos.length - faltan.length };
}

export type ResultadoMarcarAtipico = { ok: true; estado: EstadoAtipico } | { ok: false; motivo: string };

/**
 * Cambia el estado de un hallazgo (nuevo → avisado → revisado → justificado). El estado NO retrocede
 * (un hallazgo justificado nunca vuelve a «nuevo»). «Revisado» y «justificado» exigen quién revisa.
 */
export async function marcarAtipico(
  tenantId: string, id: string, cambio: { estado: EstadoAtipico; por?: string | null; nota?: string | null },
): Promise<ResultadoMarcarAtipico> {
  if (!esEstadoAtipico(cambio.estado)) return { ok: false, motivo: 'El estado no es válido.' };
  const por = typeof cambio.por === 'string' ? cambio.por.trim().slice(0, 120) : '';
  if (exigeRevisor(cambio.estado) && !por) return { ok: false, motivo: 'Indica quién revisó el hallazgo.' };
  const nota = typeof cambio.nota === 'string' && cambio.nota.trim() ? cambio.nota.trim().slice(0, 300) : null;
  if (cambio.estado === 'justificado' && !nota) return { ok: false, motivo: 'Escribe el motivo por el que queda justificado.' };

  const { data: previa, error: e1 } = await acotada(supabaseAdmin().from('peaje_atipico')
    .select('estado, avisado_en').eq('tenant_id', tenantId).eq('id', id).maybeSingle(), 'peajes.atipico_previo');
  if (e1) throw new Error(`marcarAtipico: ${e1.message}`);
  if (!previa) return { ok: false, motivo: 'No se encontró el hallazgo.' };
  const actual = String(previa.estado);
  if (!esEstadoAtipico(actual)) return { ok: false, motivo: 'El hallazgo tiene un estado desconocido.' };
  if (!puedeCambiarEstado(actual, cambio.estado)) {
    return { ok: false, motivo: `El hallazgo ya está «${actual}»: no puede volver a «${cambio.estado}».` };
  }

  const ahora = new Date().toISOString();
  const parche: Record<string, unknown> = { estado: cambio.estado, actualizado_en: ahora };
  if (nota !== null) parche.nota = nota;
  if (cambio.estado === 'avisado' && !previa.avisado_en) parche.avisado_en = ahora;
  if (exigeRevisor(cambio.estado)) { parche.revisado_en = ahora; parche.revisado_por = por; if (!previa.avisado_en) parche.avisado_en = ahora; }
  const { error: e2 } = await acotada(supabaseAdmin().from('peaje_atipico')
    .update(parche).eq('tenant_id', tenantId).eq('id', id).eq('estado', actual), 'peajes.marcar_atipico');
  if (e2) {
    logger.error('peajes.marcar_atipico', { tenant: tenantId, err: e2.message });
    return { ok: false, motivo: 'No se pudo guardar el cambio. Intenta de nuevo.' };
  }
  return { ok: true, estado: cambio.estado };
}

/** Reclamos enviados con saldo por acreditar: contra ellos se casa una nota de crédito (`notas_credito.ts`). Solo lectura; lanza ante error de base. */
export async function reclamosParaCasar(tenantId: string): Promise<import('./notas_credito').ReclamoParaCasar[]> {
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(supabaseAdmin().from('peaje_reclamo')
      .select('id, estado, monto_reclamado, monto_acreditado, fecha_cobro_mas_antiguo', conteo(d))
      .eq('tenant_id', tenantId).in('estado', ['enviado', 'acreditado_parcial'])
      .order('fecha_cobro_mas_antiguo').order('id').range(d, h), 'peajes.reclamos_para_casar'),
    'peajes.reclamos_para_casar',
  );
  return filas
    .map((f) => ({
      id: String(f.id), estado: String(f.estado) as import('./reclamos_seguimiento').EstadoReclamo,
      montoReclamable: Math.round((Number(f.monto_reclamado ?? 0) - Number(f.monto_acreditado ?? 0)) * 100) / 100,
      fechaCobroMasAntiguo: String(f.fecha_cobro_mas_antiguo).slice(0, 10),
    }))
    .filter((r) => r.montoReclamable > 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// EL I/O de la configuración de umbrales, plazo y avisos (T-A2-29b). Vive aquí y no en un archivo
// nuevo para no subir el techo de archivos con acceso directo a Supabase (frontera_datos_guardiana).
//
// Vive en la MISMA fila por flota de `peaje_atipico_config` (migración 0779):
//   · `activo`                       → interruptor del detector de atípicos,
//   · `umbrales` (reglas atípicas)   → validados por `atipicos_config.ts`,
//   · `umbrales.aviso.telefono`      → destinatario del aviso (lo escribe `guardarDestinatarioAtipicos`),
//   · `umbrales.config_peajes`       → plazo, recordatorio e interruptores (`config_avisos.ts`).
// Sin migración nueva: es un objeto jsonb libre. CADA escritura conserva las claves que no
// le tocan (guardar umbrales no borra el destinatario ni el plazo, y al revés).
// Una flota sin fila = todo apagado y con valores por omisión.
// ═══════════════════════════════════════════════════════════════════════════

type DetalleCfg = Record<string, unknown>;
const comoDetalleCfg = (x: unknown): DetalleCfg => (x && typeof x === 'object' && !Array.isArray(x) ? (x as DetalleCfg) : {});

export interface ConfigPeajesVista {
  /** El detector de cruces atípicos corre solo si la flota lo encendió. */
  atipicosActivo: boolean;
  umbrales: ConfigAtipicos;
  avisos: ConfigAvisos;
  /** Destinatario de los avisos por WhatsApp; `null` = solo se ve en pantalla. */
  telefono: string | null;
}

type FilaCfg = { activo: boolean; umbrales: DetalleCfg };

/** Lee la fila de la flota (o `null` si no hay). Lanza ante error de base: un error no se lee como «apagado». */
async function leerFila(tenantId: string, etiqueta: string): Promise<FilaCfg | null> {
  const { data, error } = await acotada(supabaseAdmin().from('peaje_atipico_config')
    .select('activo, umbrales').eq('tenant_id', tenantId).maybeSingle(), etiqueta);
  if (error) throw new Error(`${etiqueta}: ${error.message}`);
  if (!data) return null;
  return { activo: data.activo === true, umbrales: comoDetalleCfg(data.umbrales) };
}

async function escribirFila(tenantId: string, fila: FilaCfg, etiqueta: string): Promise<boolean> {
  const { error } = await acotada(supabaseAdmin().from('peaje_atipico_config').upsert({
    tenant_id: tenantId, activo: fila.activo, umbrales: fila.umbrales, actualizado_en: new Date().toISOString(),
  }, { onConflict: 'tenant_id' }), etiqueta);
  if (error) {
    logger.error(etiqueta, { tenant: tenantId, err: error.message });
    return false;
  }
  return true;
}

/** Todo lo que la pantalla de configuración muestra de umbrales, plazo y avisos. Lanza ante error de base. */
export async function leerConfigPeajes(tenantId: string): Promise<ConfigPeajesVista> {
  const fila = await leerFila(tenantId, 'peajes.config_peajes_leer');
  const u = fila?.umbrales ?? {};
  const tel = comoDetalleCfg(u.aviso).telefono;
  return {
    atipicosActivo: fila?.activo === true,
    umbrales: configAtipicosEfectiva(u),
    avisos: configAvisosEfectiva(u.config_peajes),
    telefono: typeof tel === 'string' && tel.trim() !== '' ? tel : null,
  };
}

export type ResultadoConfigPeajes<T> = { ok: true; valor: T } | { ok: false; motivo: string };
const NO_SE_PUDO_CONFIG = 'No se pudo guardar la configuración. Intenta de nuevo.';

/**
 * Guarda el interruptor del detector y sus umbrales (N, H, velocidad, madrugada). Un valor fuera de
 * rango se RECHAZA con mensaje llano y no se escribe nada. Conserva el destinatario y el plazo.
 */
export async function guardarUmbralesPeajes(
  tenantId: string, entrada: { activo: boolean; umbrales?: unknown },
): Promise<ResultadoConfigPeajes<{ activo: boolean; umbrales: ConfigAtipicos }>> {
  if (typeof entrada.activo !== 'boolean') return { ok: false, motivo: 'Indica si el detector está encendido (sí o no).' };
  const v = validarConfigAtipicos(entrada.umbrales);
  if (!v.ok) return { ok: false, motivo: v.motivo };
  let previa: FilaCfg | null;
  try { previa = await leerFila(tenantId, 'peajes.config_peajes_umbrales_previa'); } catch (e) {
    logger.error('peajes.config_peajes_umbrales_previa', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    return { ok: false, motivo: NO_SE_PUDO_CONFIG };
  }
  const resto = previa?.umbrales ?? {};
  const ok = await escribirFila(tenantId, { activo: entrada.activo, umbrales: { ...resto, ...v.valor } }, 'peajes.config_peajes_umbrales');
  return ok ? { ok: true, valor: { activo: entrada.activo, umbrales: v.valor } } : { ok: false, motivo: NO_SE_PUDO_CONFIG };
}

/**
 * Guarda el plazo de reclamo, los días de aviso, el recordatorio y los interruptores. Se valida
 * COMPLETO antes de escribir. Conserva los umbrales, el interruptor del detector y el destinatario.
 */
export async function guardarConfigAvisos(tenantId: string, entrada: unknown): Promise<ResultadoConfigPeajes<ConfigAvisos>> {
  const v = validarConfigAvisos(entrada);
  if (!v.ok) return { ok: false, motivo: v.motivo };
  let previa: FilaCfg | null;
  try { previa = await leerFila(tenantId, 'peajes.config_peajes_avisos_previa'); } catch (e) {
    logger.error('peajes.config_peajes_avisos_previa', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    return { ok: false, motivo: NO_SE_PUDO_CONFIG };
  }
  const ok = await escribirFila(tenantId, {
    activo: previa?.activo === true, umbrales: { ...(previa?.umbrales ?? {}), config_peajes: v.valor },
  }, 'peajes.config_peajes_avisos');
  return ok ? { ok: true, valor: v.valor } : { ok: false, motivo: NO_SE_PUDO_CONFIG };
}
