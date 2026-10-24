// ═══════════════════════════════════════════════════════════════════════════
// T-A2-35 (gate de arquitectura, 18-oct-2026) — `peajes/repo.ts`, el punto
// único de acceso a Supabase del módulo de peajes.
//
// `frontera_datos_guardiana.test.ts` mide archivos FUERA de `lib/likida/
// repo.ts`/`pg.ts` (la frontera declarada del árbol) con acceso directo a
// Supabase. El módulo de peajes creció con SEIS archivos llamando a
// `supabaseAdmin()` cada uno por su cuenta — `datos.ts`, `revision_cobros.ts`,
// `bitacora_conciliada.ts`, `vinculos_conciliacion.ts`, `vinculos_reporte.ts`
// e `ingesta.ts` (parcial; sus funciones puras de firma/validación se
// quedaron en `ingesta.ts`) — igual que ya hacen `vigia/repo.ts`,
// `conductor/repo.ts` y `reglas/repo.ts` para sus propios módulos: NO exime
// a este archivo del conteo del guardia (`FRONTERA` solo exime la raíz), pero
// consolida seis archivos contados en uno solo, que es lo que el guardia
// realmente mide (archivos, no líneas).
//
// Este archivo es la UNIÓN literal de esos módulos: cada bloque se relocalizó
// tal cual (misma firma, mismo cuerpo), sin cambiar comportamiento. Los
// archivos originales quedan como `export * from './repo'` para que ningún
// importador en el resto del árbol tenga que cambiar su ruta.
//
// `intake/desglose_peaje.ts` y `app/dashboard/agentes/peajes/page.tsx`
// (los otros dos de la lista original de ocho) NO se movieron aquí —
// ver la nota al pie de cada uno de esos archivos.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { hoyMx, mxn } from '@/lib/formato';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { acotada } from '../presupuesto';
import { traerTodo, traerPorIds, conteo, type RespuestaPg } from '../pg';
import { normalizarNombre, normalizarTag } from './formatos';
import { COLUMNAS_POLIGONO, conPoligonoOCirculo, geometriaDeFila } from '../conductor/geometria_datos';
import { matrizDeArchivoCatalogo } from './archivo';
import { sumarMeses, limitesDelMes, mesAnterior } from './periodo';
import { revisarDobleEntreArchivos, VENTANA_MESES_DEFAULT, type ArchivoPrevio, type ResultadoDobleEntreArchivos } from './doble_entre_archivos';
import { parsearCasetasMatriz, coordenadaDeCelda, validarCoordenadasMexico, type CasetaCatalogo } from './casetas';
import { parsearTarifasMatriz, planificarTarifa, type OrigenTarifa, type TarifaEntrada, type TarifaExistente } from './tarifario_archivo';
import { parsearTagsMatriz, resolverUnidadesDeTags, validarBajaTag, type VigenciaTag } from './tags';
import { parsearInmovilizadasMatriz, resolverUnidadesInmovilizadas, validarExcepcionUnidad, validarJustificacion } from './reglas_cobro_config';
import {
  revisarCobros, ETIQUETA_CATEGORIA_COBRO, ROTULO_CANDIDATO, TIPOS_UNIDAD_PEAJE, esCategoriaInterna,
  type CategoriaCobro, type LineaCobro, type MotivoInmovilizada, type ReglasCobro, type ResultadoRevision, type TipoUnidadPeaje, type VentanaInmovilizada,
} from './reglas_cobro';
import { validarMapeo, type ConfigMapeo } from './mapeo';
import { planificarGps, evaluarCruceGps, VENTANA_GPS_MIN, type LineaParaGps, type VeredictoGps, type Muestra } from './cruce_gps';
import { createHash } from 'node:crypto';
import { generarToken, esTokenValido } from '@/lib/correo/buzon';
import { hostNoPublico } from '@/lib/http/destino_publico';
import { cifrar, cofreConfigurado } from '../conectores/cofre';
import { partirUrlSftp, leerHuellas, normalizarLlave } from '../conectores/tabla_propia/sftp';
import type { HallazgoAtipico, ConfigAtipicos } from './atipicos';
import { validarConfigAvisos, configAvisosEfectiva, type ConfigAvisos } from './config_avisos';
import { validarMargenLejos, margenLejosEfectivo } from './gps_umbral';
import { validarConfigAtipicos, configAtipicosEfectiva, umbralesDePantalla, sinSenalesApagadas, esEstadoAtipico, puedeCambiarEstado, exigeRevisor, type EstadoAtipico } from './atipicos_config';
import { matrizDeCsv } from './csv';
import { detectarAtipicos, type ResultadoAtipicos, type UmbralesAtipicos } from './cruces_atipicos';
import { cierreMensual, type ArchivoCierre, type CierreMensual } from './cierre_mensual';
import {
  estadoTrasAcreditar, evaluarReclamo, resumirSeguimiento, ESTADOS_RECLAMO,
  type EstadoReclamo, type EvaluacionReclamo, type ResumenSeguimiento,
} from './reclamos_seguimiento';
import { cursosQueAplican, type CursoDeFlota } from './cursos';
import { leyendasDePerfil } from './reclamacion_perfil';
import {
  construirReclamacion, LEYENDAS_RECLAMACION, type LineaReclamable, type ReporteReclamacion,
} from './reclamacion';
import {
  clasificarVerificacion, resumirVerificacion, textoMotivoGps,
  type EstadoConciliado, type MotivoVerificacion, type ResumenVerificacion,
} from './verificacion';
import { vincularPorIcident, type CruceIcident } from './vincular_viaje';
import { desdeTablaViajeLocal, type ViajeFuente, type PosicionConViaje, type RangoFechas } from './viajes_fuente';

// ─────────────────────────────────────────────────────────────────────────
// De `datos.ts` — catálogos (TAGs, casetas, geocercas, mapeos, buzón, pull,
// aviso, cursos, configuración, vínculos de conciliación y candidatos).
// ─────────────────────────────────────────────────────────────────────────


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

// ── Unidades inmovilizadas (taller / siniestro / baja, T-A2-36) ─────────────
export interface InmovilizadaVista {
  id: string; unidadId: string; unidadEconomico: string | null;
  desde: string; hasta: string | null; motivo: MotivoInmovilizada; nota: string | null;
}

/** Las ventanas de inmovilización de la flota (`peaje_unidad_inmovilizada`, 0813). Lanza ante error de base. */
export async function listarInmovilizadas(tenantId: string): Promise<InmovilizadaVista[]> {
  const [filas, unidades] = await Promise.all([
    traerTodo<Record<string, unknown>>(
      (d, h) => acotada(supabaseAdmin().from('peaje_unidad_inmovilizada')
        .select('id, unidad_id, desde, hasta, motivo, nota', conteo(d))
        .eq('tenant_id', tenantId).order('desde', { ascending: false }).order('id').range(d, h), 'peajes.inmovilizadas'),
      'peajes.inmovilizadas',
    ),
    listarUnidades(tenantId),
  ]);
  const eco = new Map(unidades.map((u) => [u.id, u.numeroEconomico]));
  return filas.map((f) => ({
    id: String(f.id), unidadId: String(f.unidad_id), unidadEconomico: eco.get(String(f.unidad_id)) ?? null,
    desde: String(f.desde).slice(0, 10), hasta: f.hasta ? String(f.hasta).slice(0, 10) : null,
    motivo: f.motivo as MotivoInmovilizada, nota: (f.nota as string | null) ?? null,
  }));
}

/**
 * TAG normalizado → ventanas de inmovilización de SU unidad, para la regla `unidad_inmovilizada`. Cruza el
 * maestro TAG↔unidad (`peaje_tag`) con las ventanas por unidad: un TAG sin alta no aparece (no se adivina la
 * unidad). Lanza ante error de base: un mapa a medias leería «sin candidatos» estando ciego.
 */
export async function inmovilizadasPorTag(tenantId: string): Promise<Map<string, VentanaInmovilizada[]>> {
  const ventanas = await listarInmovilizadas(tenantId);
  const mapa = new Map<string, VentanaInmovilizada[]>();
  if (ventanas.length === 0) return mapa;
  const porUnidad = new Map<string, VentanaInmovilizada[]>();
  for (const v of ventanas) {
    porUnidad.set(v.unidadId, [...(porUnidad.get(v.unidadId) ?? []), { desde: v.desde, hasta: v.hasta, motivo: v.motivo }]);
  }
  const tags = await traerTodo<{ tag: unknown; unidad_id: unknown }>(
    (d, h) => acotada(supabaseAdmin().from('peaje_tag').select('tag, unidad_id', conteo(d))
      .eq('tenant_id', tenantId).order('tag').range(d, h), 'peajes.inmovilizadas_tags'),
    'peajes.inmovilizadas_tags',
  );
  for (const t of tags) {
    const w = porUnidad.get(String(t.unidad_id));
    if (w) mapa.set(String(t.tag), w);
  }
  return mapa;
}

/** Importa la lista de unidades inmovilizadas (CSV/XLSX). Repetirlo es seguro: actualiza `hasta` y nota. */
export async function importarInmovilizadasArchivo(tenantId: string, nombre: string, buffer: Uint8Array): Promise<ResultadoImportacionCatalogo> {
  const falla = (error: string): ResultadoImportacionCatalogo => ({ ok: false, guardadas: 0, actualizadas: 0, rechazadas: [], error });
  const m = matrizDeArchivoCatalogo(nombre, buffer);
  if (!m.ok) return falla(m.motivo);
  const lectura = parsearInmovilizadasMatriz(m.matriz);
  if (lectura.error) return falla(lectura.error);

  let unidades;
  let previas: InmovilizadaVista[];
  try {
    unidades = await listarUnidades(tenantId);
    previas = await listarInmovilizadas(tenantId);
  } catch (e) {
    logger.error('peajes.importar_inmovilizadas_lectura', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    return falla('No se pudo leer la lista actual. Inténtalo de nuevo.');
  }
  const { altas, rechazadas } = resolverUnidadesInmovilizadas(lectura.ventanas, unidades);
  const todasRechazadas = [...lectura.rechazadas, ...rechazadas].sort((a, b) => a.fila - b.fila);
  if (altas.length === 0) return { ok: true, guardadas: 0, actualizadas: 0, rechazadas: todasRechazadas };

  const existente = new Map(previas.map((p) => [`${p.unidadId}|${p.desde}|${p.motivo}`, p]));
  let guardadas = 0;
  let actualizadas = 0;
  for (const lote of lotes(altas)) {
    const filas = lote.map((a) => ({
      tenant_id: tenantId, unidad_id: a.unidadId, desde: a.desde, hasta: a.hasta, motivo: a.motivo, nota: a.nota,
    }));
    const { error } = await acotada(supabaseAdmin().from('peaje_unidad_inmovilizada').upsert(filas, { onConflict: 'tenant_id,unidad_id,desde,motivo' }), 'peajes.importar_inmovilizadas');
    if (error) {
      logger.error('peajes.importar_inmovilizadas', { tenant: tenantId, err: error.message });
      return { ok: false, guardadas, actualizadas, rechazadas: todasRechazadas, error: `Se guardaron ${guardadas} renglones y el resto falló. Vuelve a subir el archivo: es seguro repetirlo.` };
    }
    for (const a of lote) {
      guardadas++;
      const previa = existente.get(`${a.unidadId}|${a.desde}|${a.motivo}`);
      if (previa && (previa.hasta !== a.hasta || previa.nota !== a.nota)) actualizadas++;
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
  sftpHost: string | null;
  sftpPuerto: number;
  sftpUsuario: string | null;
  sftpRuta: string | null;
  sftpHuellas: string[];
  sftpActivo: boolean;
  sftpIntervaloMin: number;
  sftpUltimoEn: string | null;
  sftpUltimoError: string | null;
  /** Hay una credencial guardada (cifrada); el valor NUNCA vuelve a la pantalla. */
  sftpConCredencial: boolean;
}

// Un solo literal (no concatenado): Supabase infiere las columnas del TEXTO LITERAL de `.select()` — partido en
// dos `+` deja de ser literal para TypeScript y el `data` que vuelve cae a un tipo genérico sin esas propiedades.
const COLUMNAS_ENTRADAS = 'correo_activo, correo_token, remitentes_permitidos, pull_url, pull_activo, pull_intervalo_min, pull_ultimo_en, pull_ultimo_error, pull_credencial_cifrada, sftp_host, sftp_puerto, sftp_usuario, sftp_ruta, sftp_huellas, sftp_activo, sftp_intervalo_min, sftp_ultimo_en, sftp_ultimo_error, sftp_credencial_cifrada';

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
    sftpHost: (data.sftp_host as string | null) ?? null,
    sftpPuerto: Number(data.sftp_puerto ?? 22),
    sftpUsuario: (data.sftp_usuario as string | null) ?? null,
    sftpRuta: (data.sftp_ruta as string | null) ?? null,
    sftpHuellas: Array.isArray(data.sftp_huellas) ? (data.sftp_huellas as unknown[]).map(String) : [],
    sftpActivo: data.sftp_activo === true,
    sftpIntervaloMin: Number(data.sftp_intervalo_min ?? 60),
    sftpUltimoEn: (data.sftp_ultimo_en as string | null) ?? null,
    sftpUltimoError: (data.sftp_ultimo_error as string | null) ?? null,
    sftpConCredencial: typeof data.sftp_credencial_cifrada === 'string' && data.sftp_credencial_cifrada.length > 0,
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

// ── El canal SFTP (0843) ─────────────────────────────────────────────────────
// Mismo molde que el pull: la flota da host, puerto, usuario, credencial
// (contraseña y/o llave+frase) y la RUTA de un archivo fijo que el proveedor
// sobrescribe cada corte. La huella SHA256 del host es obligatoria (sin ella
// no se guarda, igual que en `tabla_propia`): no hay «confiar en el primer
// contacto». `partirUrlSftp`/`leerHuellas`/`normalizarLlave` son los MISMOS
// helpers de `tabla_propia/sftp.ts`: nada se valida dos veces con reglas que
// puedan divergir.

export interface EntradaSftpPeajes {
  /** `sftp://host[:puerto]/ruta/archivo.ext` — sin usuario ni clave dentro de la dirección. */
  url: string;
  usuario: string;
  /** Contraseña. Al menos una de `clave`/`llave` es obligatoria. */
  clave?: string;
  /** Llave privada en PEM/OpenSSH (una sola línea o ya con saltos: se normaliza igual que en tabla_propia). */
  llave?: string;
  /** Solo tiene sentido con `llave`. */
  frase?: string;
  /** Huellas separadas por coma/espacio/salto de línea, «SHA256:…» (hasta 5). */
  huellas: string;
  intervaloMin: number;
}

/** Valida y guarda la configuración del canal SFTP. No conecta: eso lo hace `ingesta_sftp.ts` al correr el cron. */
export async function guardarSftpPeajes(tenantId: string, entrada: EntradaSftpPeajes): Promise<ResultadoPull> {
  const u = partirUrlSftp(entrada.url);
  if ('error' in u) return { ok: false, motivo: `la dirección sftp:// ${u.error}` };
  const usuario = entrada.usuario.trim();
  if (!/^[A-Za-z0-9_.@-]{1,64}$/.test(usuario)) return { ok: false, motivo: 'falta el usuario SFTP (letras, dígitos, . _ - @)' };
  const clave = entrada.clave ?? '';
  if (/[\u0000-\u001f]/.test(clave) || clave.length > 256) return { ok: false, motivo: 'la contraseña SFTP tiene caracteres no permitidos o es demasiado larga' };
  const llaveCruda = entrada.llave ?? '';
  if (clave === '' && llaveCruda.trim() === '') return { ok: false, motivo: 'falta la contraseña SFTP o la llave privada' };
  let llave: string | undefined;
  if (llaveCruda.trim() !== '') {
    const l = normalizarLlave(llaveCruda);
    if ('error' in l) return { ok: false, motivo: l.error };
    llave = l.ok;
  }
  const frase = entrada.frase ?? '';
  if (frase !== '' && llave === undefined) return { ok: false, motivo: 'la frase de la llave solo aplica con una llave privada' };
  if (frase.length > 256) return { ok: false, motivo: 'la frase de la llave es demasiado larga' };
  const h = leerHuellas(entrada.huellas);
  if ('error' in h) return { ok: false, motivo: h.error };
  if (!Number.isInteger(entrada.intervaloMin) || entrada.intervaloMin < 15 || entrada.intervaloMin > 1440) {
    return { ok: false, motivo: 'El intervalo va de 15 a 1,440 minutos.' };
  }
  if (!cofreConfigurado()) return { ok: false, motivo: 'El cofre de credenciales no está configurado (LIKIDA_COFRE_LLAVE): no se puede guardar la credencial SFTP de forma segura.' };
  const cambios: Record<string, unknown> = {
    sftp_host: u.ok.host, sftp_puerto: u.ok.puerto, sftp_usuario: usuario, sftp_ruta: u.ok.ruta, sftp_huellas: h.ok,
    sftp_credencial_cifrada: cifrar({ clave: clave || undefined, llave, frase: frase || undefined }),
    sftp_activo: true, sftp_intervalo_min: entrada.intervaloMin, sftp_proximo_en: new Date().toISOString(), sftp_ultimo_error: null,
  };
  const ok = await guardarEntradas(tenantId, cambios, 'guardar_sftp');
  return ok ? { ok: true } : { ok: false, motivo: 'No se pudo guardar. Inténtalo de nuevo.' };
}

export async function apagarSftpPeajes(tenantId: string): Promise<boolean> {
  return guardarEntradas(tenantId, { sftp_activo: false }, 'apagar_sftp');
}

/** Borra la credencial guardada (contraseña/llave/frase quedan en NULL); el host/usuario/ruta se conservan. */
export async function borrarCredencialSftp(tenantId: string): Promise<boolean> {
  return guardarEntradas(tenantId, { sftp_credencial_cifrada: null, sftp_activo: false }, 'borrar_credencial_sftp');
}

export interface SftpReclamado {
  tenantId: string;
  destino: { host: string; puerto: number; usuario: string; ruta: string; huellas: readonly string[] };
  /** La credencial YA DESCIFRADA es responsabilidad de `ingesta_sftp.ts` (necesita `descifrar` del cofre, inyectable para pruebas). */
  credencialCifrada: string | null;
  ultimoEn: string | null;
  intervaloMin: number;
}

/** Toma las flotas cuyo SFTP ya toca (claim con lease, `peaje_sftp_reclamar`). Lanza ante error de base. */
export async function reclamarSftpsPeajes(limite: number, leaseSegundos = 600): Promise<SftpReclamado[]> {
  const r = await acotada(supabaseAdmin().rpc('peaje_sftp_reclamar', { p_limite: limite, p_lease_segundos: leaseSegundos }), 'peajes.sftp.reclamar');
  if (r.error) throw new Error(`peajes.sftp.reclamar: ${r.error.message}`);
  return ((r.data ?? []) as Array<Record<string, unknown>>).map((f) => ({
    tenantId: String(f.tenant_id),
    destino: {
      host: String(f.sftp_host), puerto: Number(f.sftp_puerto ?? 22), usuario: String(f.sftp_usuario),
      ruta: String(f.sftp_ruta), huellas: Array.isArray(f.sftp_huellas) ? (f.sftp_huellas as unknown[]).map(String) : [],
    },
    credencialCifrada: (f.sftp_credencial_cifrada as string | null) ?? null,
    ultimoEn: (f.sftp_ultimo_en as string | null) ?? null, intervaloMin: Number(f.sftp_intervalo_min ?? 60),
  }));
}

/** Cierra un SFTP: con éxito avanza `sftp_ultimo_en` y programa el siguiente turno; con error, reintenta pronto (tope 30 min). */
export async function cerrarSftpPeajes(
  tenantId: string, c: { ok: boolean; avanzarA: string | null; error: string | null; intervaloMin: number; ahora?: Date },
): Promise<void> {
  const ahora = c.ahora ?? new Date();
  const espera = c.ok ? c.intervaloMin : Math.min(c.intervaloMin, 30);
  const cambios: Record<string, unknown> = {
    sftp_proximo_en: new Date(ahora.getTime() + espera * 60_000).toISOString(),
    sftp_ultimo_error: c.error ? c.error.slice(0, 500) : null,
    updated_at: ahora.toISOString(),
  };
  if (c.avanzarA) cambios.sftp_ultimo_en = c.avanzarA;
  const { error } = await acotada(supabaseAdmin().from('peaje_ingesta_config').update(cambios).eq('tenant_id', tenantId), 'peajes.sftp.cerrar');
  if (error) logger.error('peajes.sftp.cerrar', { tenant: tenantId, err: error.message });
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
  // El margen «lejos» es de la flota (T-A2-24). Si no se puede leer, el de siempre: nunca afirma de más por un fallo de lectura.
  let margen = margenLejosEfectivo(undefined);
  // (El mensaje de la base NO va al log: puede traer valores de la fila.)
  try { margen = await leerMargenLejosM(tenantId); } catch {
    logger.warn('peajes.margen_gps_lectura', { tenant: tenantId });
  }
  const listos = planes.filter((p): p is Extract<typeof p, { listo: true }> => p.listo);
  const muestrasPorLinea = await traerMuestrasPorLinea(tenantId, listos.map((p) => ({ lineaId: p.lineaId, unidadId: p.unidadId, desde: p.desde, hasta: p.hasta })));

  return planes.map((p) => {
    if (!p.listo) return { lineaId: p.lineaId, casetaId: p.casetaId, veredicto: p.veredicto };
    return { lineaId: p.lineaId, casetaId: p.casetaId, veredicto: evaluarCruceGps(p.cruceMs, p.caseta, muestrasPorLinea.get(p.lineaId) ?? [], margen) };
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

/**
 * El margen «lejos de la caseta» de la flota (m) para el cruce con GPS (T-A2-24). Vive en `umbrales.gps` de la misma fila de
 * configuración (sin tabla nueva). Sin fila o con un valor corrupto: el de siempre. Lanza ante error de base: un error no se lee como «el de siempre».
 */
export async function leerMargenLejosM(tenantId: string): Promise<number> {
  const fila = await leerFila(tenantId, 'peajes.config_peajes_margen_gps_leer');
  return margenLejosEfectivo(comoDetalleCfg(fila?.umbrales.gps).margenLejosM);
}

/** Guarda el margen de la flota. Se valida ANTES de escribir; conserva el resto de la configuración (umbrales, plazo, destinatario, interruptor). */
export async function guardarMargenLejosM(tenantId: string, entrada: unknown): Promise<ResultadoConfigPeajes<number>> {
  const v = validarMargenLejos(entrada);
  if (!v.ok) return { ok: false, motivo: v.motivo };
  let previa: FilaCfg | null;
  try { previa = await leerFila(tenantId, 'peajes.config_peajes_margen_gps_previa'); } catch (e) {
    logger.error('peajes.config_peajes_margen_gps_previa', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    return { ok: false, motivo: NO_SE_PUDO_CONFIG };
  }
  const ok = await escribirFila(tenantId, {
    activo: previa?.activo === true, umbrales: { ...(previa?.umbrales ?? {}), gps: { margenLejosM: v.valor } },
  }, 'peajes.config_peajes_margen_gps');
  return ok ? { ok: true, valor: v.valor } : { ok: false, motivo: NO_SE_PUDO_CONFIG };
}

// ── Líneas de los desgloses PREVIOS de la flota (T-A2-38: doble cobro entre archivos) ──────────────
/**
 * Los desgloses anteriores de la flota con sus líneas, para buscar el mismo cobro tardío en un archivo
 * previo. Solo se LEEN las líneas de los que caen en la ventana (`ventanaMeses` hacia atrás desde
 * `periodoDesde`); los demás viajan sin líneas para que el motor puro diga por qué no se consultaron.
 * Solo existen las líneas de la hoja principal (la hoja repetida de utilitarios no se guarda). Lanza ante error.
 */
export async function lineasPreviasDeFlota(
  tenantId: string, desgloseActualId: string, periodoDesde: string, ventanaMeses: number,
): Promise<ArchivoPrevio[]> {
  const metas = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(supabaseAdmin().from('desglose_peaje')
      .select('id, archivo_nombre, periodo_oficial_desde, periodo_oficial_hasta', conteo(d))
      .eq('tenant_id', tenantId).is('anulado_en', null).order('id').range(d, h), 'peajes.previos.desgloses'),
    'peajes.previos.desgloses',
  );
  const limite = sumarMeses(periodoDesde, -ventanaMeses);
  const previos: ArchivoPrevio[] = [];
  for (const m of metas) {
    const id = String(m.id);
    if (id === desgloseActualId) continue;
    const desde = (m.periodo_oficial_desde as string | null) ?? null;
    const hasta = (m.periodo_oficial_hasta as string | null) ?? null;
    const fin = hasta ?? desde;
    const enVentana = desde !== null && fin !== null && desde < periodoDesde && fin >= limite;
    const filas = enVentana ? await traerTodo<Record<string, unknown>>(
      (d, h) => acotada(supabaseAdmin().from('desglose_peaje_linea')
        .select('indice, fecha, hora, caseta, tag, monto', conteo(d))
        .eq('tenant_id', tenantId).eq('desglose_id', id).order('indice').order('id').range(d, h), 'peajes.previos.lineas'),
      'peajes.previos.lineas',
    ) : [];
    previos.push({
      id, etiqueta: String(m.archivo_nombre ?? 'archivo sin nombre'), periodoDesde: desde, periodoHasta: hasta,
      lineas: filas.map((f) => ({
        indice: Number(f.indice), fecha: (f.fecha as string | null) ?? null, hora: f.hora ? String(f.hora).slice(0, 8) : null,
        caseta: (f.caseta as string | null) ?? null, tag: (f.tag as string | null) ?? null, monto: Number(f.monto),
      })),
    });
  }
  return previos;
}

// ── Vínculo cruce → viaje (T-A2-21, migración 0811) ─────────────────────────
// NO toca `desglose_peaje_linea.viaje_id` (viaje del gasto que respalda, 0106): el vínculo vive aparte.

/** Interruptor por flota del cálculo cruce→viaje. Sin fila = apagado. Lanza ante error de base. */
export async function leerVinculosActivo(tenantId: string): Promise<boolean> {
  const { data, error } = await acotada(supabaseAdmin().from('peaje_vinculo_config')
    .select('activo').eq('tenant_id', tenantId).maybeSingle(), 'peajes.config_vinculos');
  if (error) throw new Error(`leerVinculosActivo: ${error.message}`);
  return data?.activo === true;
}

/** Prende o apaga el cálculo cruce→viaje de la flota. */
export async function guardarVinculosActivo(tenantId: string, activo: boolean): Promise<boolean> {
  const { error } = await acotada(supabaseAdmin().from('peaje_vinculo_config').upsert({
    tenant_id: tenantId, activo, actualizado_en: new Date().toISOString(),
  }, { onConflict: 'tenant_id' }), 'peajes.guardar_config_vinculos');
  if (error) logger.error('peajes.guardar_config_vinculos', { tenant: tenantId, err: error.message });
  return !error;
}

export interface VinculoGuardado {
  lineaId: string;
  estado: 'ligado' | 'ambiguo' | 'sin_viaje' | 'sin_unidad' | 'conflicto';
  viajeId: string | null;
  via: 'icident' | 'unidad_ventana';
  candidatos: readonly string[];
  icident?: string | null;
  motivo?: string | null;
}

export interface VinculoVista extends VinculoGuardado { id: string; desgloseId: string; calculadoEn: string }

const LOTE_VINCULOS = 200;

/**
 * Guarda los vínculos de un desglose de forma RECALCULABLE: la clave (flota, línea) es única y un
 * nuevo cálculo SOBRESCRIBE la fila (nunca la duplica). Solo `ligado` conserva `viaje_id`. Lanza ante error de base.
 */
export async function guardarVinculos(tenantId: string, desgloseId: string, vinculos: readonly VinculoGuardado[]): Promise<{ guardados: number }> {
  const porLinea = new Map(vinculos.map((v) => [v.lineaId, v]));
  const unicos = [...porLinea.values()];
  const ahora = new Date().toISOString();
  for (let i = 0; i < unicos.length; i += LOTE_VINCULOS) {
    const filas = unicos.slice(i, i + LOTE_VINCULOS).map((v) => ({
      tenant_id: tenantId,
      desglose_id: desgloseId,
      linea_id: v.lineaId,
      viaje_id: v.estado === 'ligado' ? v.viajeId : null,
      estado: v.estado,
      via: v.via,
      candidatos: [...v.candidatos],
      icident: v.icident ?? null,
      motivo: v.motivo ?? null,
      calculado_en: ahora,
    }));
    const { error } = await acotada(supabaseAdmin().from('peaje_cruce_viaje')
      .upsert(filas, { onConflict: 'tenant_id,linea_id' }), 'peajes.guardar_vinculos');
    if (error) throw new Error(`guardarVinculos: ${error.message}`);
  }
  return { guardados: unicos.length };
}

/** Los vínculos guardados de un desglose (de esa flota). Lanza ante error de base. */
export async function vinculosDeDesglose(tenantId: string, desgloseId: string): Promise<VinculoVista[]> {
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(supabaseAdmin().from('peaje_cruce_viaje')
      .select('id, desglose_id, linea_id, viaje_id, estado, via, candidatos, icident, motivo, calculado_en', conteo(d))
      .eq('tenant_id', tenantId).eq('desglose_id', desgloseId).order('id').range(d, h), 'peajes.vinculos_de_desglose'),
    'peajes.vinculos_de_desglose',
  );
  return filas.map((f) => ({
    id: String(f.id), desgloseId: String(f.desglose_id), lineaId: String(f.linea_id),
    viajeId: typeof f.viaje_id === 'string' ? f.viaje_id : null,
    estado: String(f.estado) as VinculoGuardado['estado'], via: String(f.via) as VinculoGuardado['via'],
    candidatos: Array.isArray(f.candidatos) ? f.candidatos.map(String) : [],
    icident: typeof f.icident === 'string' ? f.icident : null,
    motivo: typeof f.motivo === 'string' ? f.motivo : null,
    calculadoEn: String(f.calculado_en),
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// LA DECISIÓN SOBRE CADA CANDIDATO (T-A2-28b, migración 0815).
//
// Los candidatos se calculan al leer; aquí solo vive lo que finanzas decidió: reclamado, descartado o
// justificado, con motivo, quién y cuándo. La llave única (flota, desglose, renglón, categoría) hace
// idempotente el doble clic: la segunda inserción no escribe nada y no devuelve la fila. Nada de esto
// toca `desglose_peaje_linea`: el cobro del proveedor no cambia.
// ═══════════════════════════════════════════════════════════════════════════

export type AccionDecisionCandidato = 'reclamado' | 'descartado' | 'justificado';

export interface DecisionCandidatoVista {
  id: string;
  indice: number;
  categoria: string;
  accion: AccionDecisionCandidato;
  motivo: string | null;
  reclamoId: string | null;
  actor: string;
  creadoEn: string;
}

const LOTE_DECISIONES = 500;

/** Las decisiones de un desglose (de esa flota). Lanza ante error de base: leer a medias diría «todo pendiente». */
export async function listarDecisionesCandidatos(tenantId: string, desgloseId: string): Promise<DecisionCandidatoVista[]> {
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(supabaseAdmin().from('peaje_candidato_accion')
      .select('id, indice, categoria, accion, motivo, reclamo_id, actor, creado_en', conteo(d))
      .eq('tenant_id', tenantId).eq('desglose_id', desgloseId).order('indice').order('id').range(d, h), 'peajes.listar_decisiones_candidatos'),
    'peajes.listar_decisiones_candidatos',
  );
  return filas.map((f) => ({
    id: String(f.id), indice: Number(f.indice), categoria: String(f.categoria),
    accion: String(f.accion) as AccionDecisionCandidato, motivo: typeof f.motivo === 'string' ? f.motivo : null,
    reclamoId: typeof f.reclamo_id === 'string' ? f.reclamo_id : null, actor: String(f.actor), creadoEn: String(f.creado_en),
  }));
}

/**
 * Registra la decisión sobre varios candidatos en lotes. Devuelve SOLO las filas que de verdad se insertaron:
 * un renglón que ya tenía decisión (otro clic, otra pestaña) no se pisa ni se devuelve. Lanza ante error de base.
 */
export async function registrarDecisionesCandidatos(
  tenantId: string, desgloseId: string, items: ReadonlyArray<{ indice: number; categoria: string }>,
  accion: AccionDecisionCandidato, extra: { motivo: string | null; actor: string },
): Promise<Array<{ id: string; indice: number; categoria: string }>> {
  const unicos = [...new Map(items.map((i) => [`${i.indice}|${i.categoria}`, i])).values()];
  const insertadas: Array<{ id: string; indice: number; categoria: string }> = [];
  for (let i = 0; i < unicos.length; i += LOTE_DECISIONES) {
    const filas = unicos.slice(i, i + LOTE_DECISIONES).map((x) => ({
      tenant_id: tenantId, desglose_id: desgloseId, indice: x.indice, categoria: x.categoria, accion,
      motivo: accion === 'reclamado' ? null : extra.motivo, actor: extra.actor,
    }));
    const { data, error } = await acotada(supabaseAdmin().from('peaje_candidato_accion')
      .upsert(filas, { onConflict: 'tenant_id,desglose_id,indice,categoria', ignoreDuplicates: true }).select('id, indice, categoria'),
    'peajes.registrar_decisiones_candidatos');
    if (error) {
      // Lo ya insertado de esta llamada se retira: no queda una decisión a medias sin su efecto.
      if (insertadas.length > 0) await retirarDecisionesCandidatos(tenantId, insertadas.map((x) => x.id)).catch(() => undefined);
      throw new Error(`registrarDecisionesCandidatos: ${error.message}`);
    }
    for (const f of (data ?? []) as Array<Record<string, unknown>>) insertadas.push({ id: String(f.id), indice: Number(f.indice), categoria: String(f.categoria) });
  }
  return insertadas;
}

/** Liga decisiones «reclamado» con su reclamo. Lanza ante error de base. */
export async function ligarDecisionesAReclamo(tenantId: string, ids: readonly string[], reclamoId: string): Promise<void> {
  for (const lote of lotes(ids)) {
    const { error } = await acotada(supabaseAdmin().from('peaje_candidato_accion')
      .update({ reclamo_id: reclamoId }).eq('tenant_id', tenantId).eq('accion', 'reclamado').in('id', lote), 'peajes.ligar_decisiones_reclamo');
    if (error) throw new Error(`ligarDecisionesAReclamo: ${error.message}`);
  }
}

/** Retira decisiones que esta misma llamada acababa de insertar (compensación si el reclamo no se pudo crear). */
export async function retirarDecisionesCandidatos(tenantId: string, ids: readonly string[]): Promise<void> {
  for (const lote of lotes(ids)) {
    const { error } = await acotada(supabaseAdmin().from('peaje_candidato_accion')
      .delete().eq('tenant_id', tenantId).in('id', lote), 'peajes.retirar_decisiones_candidatos');
    if (error) throw new Error(`retirarDecisionesCandidatos: ${error.message}`);
  }
}

/**
 * Crea UN reclamo (preparado, o enviado si trae fecha de envío) a partir de un grupo de candidatos ya elegidos.
 * Los números salen de los candidatos, no del formulario. `fechaCobroMasAntigua` es de donde corre el plazo.
 */
export async function crearReclamoDeCandidatos(
  tenantId: string,
  e: { desgloseId: string; proveedor: string | null; categoria: string; nCruces: number; monto: number; fechaCobroMasAntigua: string; enviadoEn: string | null; referenciaPortal?: string | null },
): Promise<string> {
  const { data, error } = await acotada(supabaseAdmin().from('peaje_reclamo').insert({
    tenant_id: tenantId, desglose_id: e.desgloseId, proveedor: e.proveedor, categoria: e.categoria,
    estado: e.enviadoEn ? 'enviado' : 'preparado', n_cruces: e.nCruces, monto_reclamado: Math.round(e.monto * 100) / 100, monto_acreditado: 0,
    fecha_cobro_mas_antiguo: e.fechaCobroMasAntigua, enviado_en: e.enviadoEn, referencia_portal: e.referenciaPortal?.trim().slice(0, 120) || null,
  }).select('id').single(), 'peajes.crear_reclamo_candidatos');
  if (error || !data) throw new Error(`crearReclamoDeCandidatos: ${error?.message ?? 'sin id'}`);
  return String(data.id);
}

/** Justifica cruces de «caseta que no debe cruzarse» en lote (la misma tabla que `justificarCruce`, para que la regla los marque). */
export async function guardarJustificacionesDeCruces(
  tenantId: string, desgloseId: string, items: ReadonlyArray<{ indice: number; motivo: string }>,
): Promise<void> {
  for (let i = 0; i < items.length; i += LOTE_DECISIONES) {
    const filas = items.slice(i, i + LOTE_DECISIONES).map((x) => ({
      tenant_id: tenantId, desglose_id: desgloseId, indice: x.indice, categoria: 'caseta_no_debe_cruzarse', motivo: x.motivo,
    }));
    const { error } = await acotada(supabaseAdmin().from('peaje_cruce_justificado')
      .upsert(filas, { onConflict: 'tenant_id,desglose_id,indice,categoria', ignoreDuplicates: true }), 'peajes.guardar_justificaciones_cruces');
    if (error) throw new Error(`guardarJustificacionesDeCruces: ${error.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// De `revision_cobros.ts` — reglas de la flota, revisión de UN desglose,
// cierre mensual y seguimiento de reclamos/notas de crédito.
// ─────────────────────────────────────────────────────────────────────────


// ═══════════════════════════════════════════════════════════════════════════
// EL I/O DE LA REVISIÓN DE COBROS: arma las líneas de un desglose, carga la
// configuración de la flota (excepciones de clase, casetas que no deben cruzarse,
// TAGs dados de baja), aplica las reglas puras de `reglas_cobro.ts` y guarda el
// seguimiento de reclamos. Todo se CALCULA AL LEER: los candidatos no se guardan
// (cambiar una regla o un periodo los recalcula; nada envejece en la base).
//
// Los errores de lectura LANZAN (la pantalla los dice): un mapa a medias o una
// lista de reglas vacía por un fallo leería «sin candidatos» estando ciego.
// ═══════════════════════════════════════════════════════════════════════════

const LOTE_UPSERT = 500;

// ── Las reglas de la flota ──────────────────────────────────────────────────

export interface ReglaCasetaVista {
  id: string;
  nombre: string;
  nombreNorm: string;
  lat: number | null;
  lng: number | null;
  clasesPermitidas: number[];
  noCruzar: boolean;
  nota: string | null;
  crucesVistos: number;
  ultimaVez: string | null;
}

export interface TagBajaVista { id: string; tag: string; tagOriginal: string | null; bajaEn: string; motivo: string | null }

export async function listarReglasCasetas(tenantId: string): Promise<ReglaCasetaVista[]> {
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(supabaseAdmin().from('peaje_caseta_nombre')
      .select('id, nombre, nombre_norm, lat, lng, clases_permitidas, no_cruzar, nota, cruces_vistos, ultima_vez', conteo(d))
      .eq('tenant_id', tenantId).order('nombre').order('id').range(d, h), 'revision_cobros.listar_casetas'),
    'revision_cobros.listar_casetas',
  );
  return filas.map((f) => ({
    id: String(f.id), nombre: String(f.nombre), nombreNorm: String(f.nombre_norm),
    lat: f.lat === null || f.lat === undefined ? null : Number(f.lat), lng: f.lng === null || f.lng === undefined ? null : Number(f.lng),
    clasesPermitidas: ((f.clases_permitidas as number[] | null) ?? []).map(Number),
    noCruzar: f.no_cruzar === true, nota: (f.nota as string | null) ?? null,
    crucesVistos: Number(f.cruces_vistos ?? 0), ultimaVez: (f.ultima_vez as string | null) ?? null,
  }));
}

export async function listarTagsBaja(tenantId: string): Promise<TagBajaVista[]> {
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(supabaseAdmin().from('peaje_tag_baja')
      .select('id, tag, tag_original, baja_en, motivo', conteo(d))
      .eq('tenant_id', tenantId).order('baja_en', { ascending: false }).order('id').range(d, h), 'revision_cobros.listar_bajas'),
    'revision_cobros.listar_bajas',
  );
  return filas.map((f) => ({
    id: String(f.id), tag: String(f.tag), tagOriginal: (f.tag_original as string | null) ?? null,
    bajaEn: String(f.baja_en).slice(0, 10), motivo: (f.motivo as string | null) ?? null,
  }));
}

export interface ExcepcionUnidadVista { id: string; casetaNorm: string; unidad: string; unidadNorm: string; nota: string | null }

export async function listarExcepcionesUnidad(tenantId: string): Promise<ExcepcionUnidadVista[]> {
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(supabaseAdmin().from('peaje_caseta_excepcion_unidad')
      .select('id, caseta_norm, unidad_norm, unidad, nota', conteo(d))
      .eq('tenant_id', tenantId).order('caseta_norm').order('unidad_norm').order('id').range(d, h), 'revision_cobros.listar_excepciones_unidad'),
    'revision_cobros.listar_excepciones_unidad',
  );
  return filas.map((f) => ({
    id: String(f.id), casetaNorm: String(f.caseta_norm), unidad: String(f.unidad), unidadNorm: String(f.unidad_norm), nota: (f.nota as string | null) ?? null,
  }));
}

/**
 * TAG normalizado → tipo de su unidad (`peaje_tag.tipo_unidad`, 0812). Solo entran los TAGs con tipo declarado:
 * un TAG sin alta o sin tipo no aparece (la regla de clase lo trata como «sin tipo de unidad»). Lanza ante error.
 */
export async function listarTiposUnidadPorTag(tenantId: string): Promise<Map<string, TipoUnidadPeaje>> {
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(supabaseAdmin().from('peaje_tag')
      .select('tag, tipo_unidad', conteo(d))
      .eq('tenant_id', tenantId).order('tag').range(d, h), 'revision_cobros.listar_tipos_unidad'),
    'revision_cobros.listar_tipos_unidad',
  );
  const mapa = new Map<string, TipoUnidadPeaje>();
  for (const f of filas) {
    const tipo = TIPOS_UNIDAD_PEAJE.find((t) => t === f.tipo_unidad);
    if (tipo) mapa.set(String(f.tag), tipo);
  }
  return mapa;
}

/** Convierte lo guardado en las `ReglasCobro` que entiende el motor puro. */
export function reglasDesdeConfig(
  casetas: readonly ReglaCasetaVista[], bajas: readonly TagBajaVista[], periodoDesde: string | null,
  excepciones: readonly ExcepcionUnidadVista[] = [], justificados: ReadonlyMap<number, string> = new Map(),
  clasesUtilitario: readonly number[] = [],
  inmovilizadasPorTag: ReadonlyMap<string, readonly VentanaInmovilizada[]> = new Map(),
): ReglasCobro {
  const excepcionesClase = new Map<string, readonly number[]>();
  const casetasNoCruzar = new Set<string>();
  for (const c of casetas) {
    if (c.clasesPermitidas.length > 0) excepcionesClase.set(c.nombreNorm, c.clasesPermitidas);
    if (c.noCruzar) casetasNoCruzar.add(c.nombreNorm);
  }
  const excepcionesPorUnidad = new Map<string, Set<string>>();
  for (const e of excepciones) {
    const set = excepcionesPorUnidad.get(e.casetaNorm) ?? new Set<string>();
    set.add(e.unidadNorm);
    excepcionesPorUnidad.set(e.casetaNorm, set);
  }
  return { periodoDesde, excepcionesClase, casetasNoCruzar, tagsBaja: new Map(bajas.map((b) => [b.tag, b.bajaEn])), excepcionesPorUnidad, justificados, clasesUtilitario, inmovilizadasPorTag };
}

export type Resultado = { ok: true } | { ok: false; motivo: string };

/** Guarda la regla de UNA caseta (clases válidas extra y/o «no debe cruzarse»). La caseta se crea si no estaba. */
export async function guardarReglaCaseta(
  tenantId: string,
  entrada: { nombre: string; clasesPermitidas: readonly number[]; noCruzar: boolean; nota?: string | null },
): Promise<Resultado> {
  const nombre = entrada.nombre.trim().replace(/\s+/g, ' ');
  const norm = normalizarNombre(nombre);
  if (!nombre || !norm || nombre.length > 120) return { ok: false, motivo: 'El nombre de la caseta es obligatorio (máximo 120 caracteres).' };
  const clases = [...new Set(entrada.clasesPermitidas)].sort((a, b) => a - b);
  if (clases.some((c) => !Number.isInteger(c) || c < 0 || c > 99) || clases.length > 20) return { ok: false, motivo: 'Las clases deben ser números enteros de 0 a 99.' };
  const { error } = await acotada(supabaseAdmin().from('peaje_caseta_nombre').upsert({
    tenant_id: tenantId, nombre, nombre_norm: norm, clases_permitidas: clases, no_cruzar: entrada.noCruzar,
    nota: entrada.nota?.trim().slice(0, 300) || null, actualizado_en: new Date().toISOString(),
  }, { onConflict: 'tenant_id,nombre_norm' }), 'revision_cobros.guardar_regla');
  if (error) {
    logger.error('revision_cobros.guardar_regla', { tenant: tenantId, err: error.message });
    return { ok: false, motivo: 'No se pudo guardar la regla. Inténtalo de nuevo.' };
  }
  return { ok: true };
}

/** Texto libre «1, 3» → [1, 3]; null si algo no es un entero 0–99. */
export function parsearClases(texto: string): number[] | null {
  const partes = texto.split(/[\s,;y]+/).map((p) => p.trim()).filter(Boolean);
  const out: number[] = [];
  for (const p of partes) {
    if (!/^\d{1,2}$/.test(p)) return null;
    out.push(Number(p));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

export async function altaBajaDeTag(
  tenantId: string,
  entrada: { tag: string; bajaEn: string; motivo?: string | null },
): Promise<Resultado> {
  const tag = normalizarTag(entrada.tag);
  if (!tag) return { ok: false, motivo: 'El TAG no es válido (4 a 40 letras o dígitos).' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entrada.bajaEn) || Number.isNaN(Date.parse(`${entrada.bajaEn}T00:00:00Z`))) {
    return { ok: false, motivo: 'La fecha de baja debe ser AAAA-MM-DD.' };
  }
  const { error } = await acotada(supabaseAdmin().from('peaje_tag_baja').upsert({
    tenant_id: tenantId, tag, tag_original: entrada.tag.trim().slice(0, 60), baja_en: entrada.bajaEn, motivo: entrada.motivo?.trim().slice(0, 300) || null,
  }, { onConflict: 'tenant_id,tag' }), 'revision_cobros.alta_baja');
  if (error) {
    logger.error('revision_cobros.alta_baja', { tenant: tenantId, err: error.message });
    return { ok: false, motivo: 'No se pudo registrar la baja del TAG. Inténtalo de nuevo.' };
  }
  return { ok: true };
}

/**
 * Exceptúa una UNIDAD de una caseta que no debe cruzarse (p. ej. la camioneta de rescates): sus cruces por esa
 * caseta dejan de marcarse. La caseta tiene que estar en el catálogo de la flota (sale sola de los archivos).
 */
export async function guardarExcepcionUnidad(
  tenantId: string, entrada: { caseta: string; unidad: string; nota?: string | null },
): Promise<Resultado> {
  const v = validarExcepcionUnidad(entrada);
  if (!v.ok) return v;
  const { data: existe, error: errC } = await acotada(supabaseAdmin().from('peaje_caseta_nombre')
    .select('id').eq('tenant_id', tenantId).eq('nombre_norm', v.valor.casetaNorm).maybeSingle(), 'revision_cobros.excepcion_caseta');
  if (errC) { logger.error('revision_cobros.excepcion_caseta', { tenant: tenantId, err: errC.message }); return { ok: false, motivo: 'No se pudo leer el catálogo de casetas.' }; }
  if (!existe) return { ok: false, motivo: 'Esa caseta no está en el catálogo de tu flota. Aparece sola cuando un archivo del proveedor la trae.' };
  const { error } = await acotada(supabaseAdmin().from('peaje_caseta_excepcion_unidad').upsert({
    tenant_id: tenantId, caseta_norm: v.valor.casetaNorm, unidad_norm: v.valor.unidadNorm, unidad: v.valor.unidad, nota: v.valor.nota,
  }, { onConflict: 'tenant_id,caseta_norm,unidad_norm' }), 'revision_cobros.guardar_excepcion_unidad');
  if (error) {
    logger.error('revision_cobros.guardar_excepcion_unidad', { tenant: tenantId, err: error.message });
    return { ok: false, motivo: 'No se pudo guardar la excepción. Inténtalo de nuevo.' };
  }
  return { ok: true };
}

export async function quitarExcepcionUnidad(tenantId: string, id: string): Promise<boolean> {
  const { error } = await acotada(supabaseAdmin().from('peaje_caseta_excepcion_unidad').delete().eq('tenant_id', tenantId).eq('id', id), 'revision_cobros.quitar_excepcion_unidad');
  if (error) logger.error('revision_cobros.quitar_excepcion_unidad', { tenant: tenantId, err: error.message });
  return !error;
}

/** Los cruces justificados de un desglose: renglón → motivo. */
export async function listarJustificaciones(tenantId: string, desgloseId: string): Promise<Map<number, string>> {
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(supabaseAdmin().from('peaje_cruce_justificado')
      .select('indice, motivo', conteo(d))
      .eq('tenant_id', tenantId).eq('desglose_id', desgloseId).eq('categoria', 'caseta_no_debe_cruzarse').order('indice').order('id').range(d, h), 'revision_cobros.listar_justificaciones'),
    'revision_cobros.listar_justificaciones',
  );
  return new Map(filas.map((f) => [Number(f.indice), String(f.motivo)]));
}

/**
 * «Justificar este cruce»: marca como revisado un cruce que la revisión señala como caseta que no debe cruzarse,
 * con su motivo. NO borra nada: el candidato sigue en el historial, rotulado como justificado. Solo se puede
 * justificar un cruce que hoy es candidato (no cualquier renglón).
 */
export async function justificarCruce(
  tenantId: string, entrada: { desgloseId: string; indice: number; motivo: string },
): Promise<Resultado> {
  const v = validarJustificacion(entrada);
  if (!v.ok) return v;
  const reporte = await revisionDeDesglose(tenantId, entrada.desgloseId);
  if (!reporte) return { ok: false, motivo: 'Ese desglose no existe en tu flota (o fue anulado).' };
  if (!reporte.revision.candidatos.some((c) => c.categoria === 'caseta_no_debe_cruzarse' && c.indice === v.valor.indice)) {
    return { ok: false, motivo: 'Ese cruce ya no aparece como «caseta que no debe cruzarse»: no hay nada que justificar.' };
  }
  const { error } = await acotada(supabaseAdmin().from('peaje_cruce_justificado').upsert({
    tenant_id: tenantId, desglose_id: entrada.desgloseId, indice: v.valor.indice, categoria: 'caseta_no_debe_cruzarse', motivo: v.valor.motivo,
  }, { onConflict: 'tenant_id,desglose_id,indice,categoria' }), 'revision_cobros.justificar_cruce');
  if (error) {
    logger.error('revision_cobros.justificar_cruce', { tenant: tenantId, err: error.message });
    return { ok: false, motivo: 'No se pudo guardar la justificación. Inténtalo de nuevo.' };
  }
  return { ok: true };
}

export async function quitarBajaDeTag(tenantId: string, id: string): Promise<boolean> {
  const { error } = await acotada(supabaseAdmin().from('peaje_tag_baja').delete().eq('tenant_id', tenantId).eq('id', id), 'revision_cobros.quitar_baja');
  if (error) logger.error('revision_cobros.quitar_baja', { tenant: tenantId, err: error.message });
  return !error;
}

// ── El catálogo de casetas por NOMBRE ───────────────────────────────────────

/**
 * Registra los nombres de casetas que trajo un archivo (los ~115 salen del propio archivo).
 * SOLO agrega las que faltan: jamás pisa una regla ni una coordenada ya capturadas.
 * Best-effort: un fallo aquí no tumba la importación del desglose (se registra).
 */
export async function registrarNombresDeCasetas(
  tenantId: string,
  lineas: ReadonlyArray<{ caseta: string | null; fecha: string | null }>,
): Promise<number> {
  const porNorm = new Map<string, { nombre: string; n: number; desde: string | null; hasta: string | null }>();
  for (const l of lineas) {
    if (!l.caseta) continue;
    const norm = normalizarNombre(l.caseta);
    if (!norm) continue;
    const a = porNorm.get(norm) ?? { nombre: l.caseta.slice(0, 120), n: 0, desde: null, hasta: null };
    a.n++;
    if (l.fecha) {
      if (a.desde === null || l.fecha < a.desde) a.desde = l.fecha;
      if (a.hasta === null || l.fecha > a.hasta) a.hasta = l.fecha;
    }
    porNorm.set(norm, a);
  }
  if (porNorm.size === 0) return 0;
  const filas = [...porNorm.entries()].map(([norm, a]) => ({
    tenant_id: tenantId, nombre: a.nombre, nombre_norm: norm, primera_vez: a.desde, ultima_vez: a.hasta, cruces_vistos: a.n,
  }));
  let nuevas = 0;
  try {
    for (let i = 0; i < filas.length; i += LOTE_UPSERT) {
      const { data, error } = await acotada(supabaseAdmin().from('peaje_caseta_nombre')
        .upsert(filas.slice(i, i + LOTE_UPSERT), { onConflict: 'tenant_id,nombre_norm', ignoreDuplicates: true }).select('id'), 'revision_cobros.registrar_nombres');
      if (error) throw new Error(error.message);
      nuevas += (data ?? []).length;
    }
  } catch (e) {
    logger.error('revision_cobros.registrar_nombres', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
  }
  return nuevas;
}

/**
 * Carga coordenadas OPCIONALES a casetas por nombre (CSV: nombre;lat;lng;fuente). Solo actualiza
 * las coordenadas de nombres que ya existen en el catálogo o los crea; no toca reglas. Una coordenada
 * fuera de México o invertida se rechaza con su fila: nada se inventa ni se «corrige» solo.
 */
export async function cargarCoordenadasDeCasetas(
  tenantId: string, buffer: Uint8Array,
): Promise<{ ok: boolean; guardadas: number; rechazadas: Array<{ fila: number; motivo: string }>; error?: string }> {
  const matriz = matrizDeCsv(Buffer.from(buffer));
  if (matriz.length === 0) return { ok: false, guardadas: 0, rechazadas: [], error: 'El archivo está vacío.' };
  const enc = matriz[0].map(normalizarNombre);
  const idx = (nombres: string[]) => enc.findIndex((e) => nombres.includes(e));
  const iN = idx(['nombre', 'caseta', 'plaza', 'nombre de caseta']);
  const iLat = idx(['lat', 'latitud']);
  const iLng = idx(['lng', 'lon', 'long', 'longitud']);
  const iFuente = idx(['fuente', 'origen']);
  if (iN < 0 || iLat < 0 || iLng < 0) return { ok: false, guardadas: 0, rechazadas: [], error: 'Faltan columnas: el CSV necesita nombre, lat y lng (y opcional fuente).' };
  if (matriz.length - 1 > 5_000) return { ok: false, guardadas: 0, rechazadas: [], error: 'El archivo trae más de 5000 casetas. Pártelo.' };
  const rechazadas: Array<{ fila: number; motivo: string }> = [];
  const filas: Array<Record<string, unknown>> = [];
  for (let f = 1; f < matriz.length; f++) {
    const fila = matriz[f];
    if (fila.every((c) => String(c ?? '').trim() === '')) continue;
    const nombre = String(fila[iN] ?? '').trim().replace(/\s+/g, ' ');
    const norm = normalizarNombre(nombre);
    if (!norm || nombre.length > 120) { rechazadas.push({ fila: f + 1, motivo: 'nombre vacío o demasiado largo' }); continue; }
    const lat = coordenadaDeCelda(fila[iLat]);
    const lng = coordenadaDeCelda(fila[iLng]);
    if (lat === null || lng === null) { rechazadas.push({ fila: f + 1, motivo: 'latitud o longitud ilegible' }); continue; }
    const fuera = validarCoordenadasMexico(lat, lng);
    if (fuera) { rechazadas.push({ fila: f + 1, motivo: fuera }); continue; }
    filas.push({
      tenant_id: tenantId, nombre, nombre_norm: norm, lat, lng,
      fuente_coordenada: (iFuente >= 0 ? String(fila[iFuente] ?? '').trim().slice(0, 200) : '') || 'archivo cargado',
      actualizado_en: new Date().toISOString(),
    });
  }
  let guardadas = 0;
  for (let i = 0; i < filas.length; i += LOTE_UPSERT) {
    const { error } = await acotada(supabaseAdmin().from('peaje_caseta_nombre').upsert(filas.slice(i, i + LOTE_UPSERT), { onConflict: 'tenant_id,nombre_norm' }), 'revision_cobros.cargar_coordenadas');
    if (error) {
      logger.error('revision_cobros.cargar_coordenadas', { tenant: tenantId, err: error.message });
      return { ok: false, guardadas, rechazadas, error: `Se guardaron ${guardadas} casetas y el resto falló. Vuelve a subir el archivo: es seguro repetirlo.` };
    }
    guardadas += Math.min(LOTE_UPSERT, filas.length - i);
  }
  return { ok: true, guardadas, rechazadas };
}

// ── La revisión de UN desglose ──────────────────────────────────────────────

export interface ReporteRevision {
  desgloseId: string;
  proveedor: string | null;
  archivoNombre: string | null;
  periodoMedidoDesde: string | null;
  periodoMedidoHasta: string | null;
  periodoOficialDesde: string | null;
  periodoOficialHasta: string | null;
  periodoOrigen: 'declarado' | 'nombre_archivo' | null;
  noPeriodo: string | null;
  /** El reporte de calidad que se guardó al importar (`CalidadArchivo`), tal cual. */
  calidad: Record<string, unknown> | null;
  revision: ResultadoRevision;
  atipicos: ResultadoAtipicos;
  /** T-A2-38: extemporáneos ya cobrados en un archivo previo (candidatos) y tardíos legítimos (informativo). */
  dobleEntreArchivos?: ResultadoDobleEntreArchivos;
  rotulo: string;
}

export async function lineasDeDesglose(tenantId: string, desgloseId: string) {
  return traerTodo<Record<string, unknown>>(
    (d, h) => acotada(supabaseAdmin().from('desglose_peaje_linea')
      .select('indice, fecha, hora, caseta, tag, monto, clase, unidad_archivo, unidad_id', conteo(d))
      .eq('tenant_id', tenantId).eq('desglose_id', desgloseId).order('indice').order('id').range(d, h), 'revision_cobros.lineas'),
    'revision_cobros.lineas',
  );
}

/** Una fila de la base → la línea que entienden las reglas. La unidad es la que declara el archivo. */
export function lineaCobroDeFila(f: Record<string, unknown>): LineaCobro {
  return {
    indice: Number(f.indice), fecha: (f.fecha as string | null) ?? null,
    hora: f.hora ? String(f.hora).slice(0, 8) : null,
    caseta: (f.caseta as string | null) ?? null, tag: (f.tag as string | null) ?? null,
    unidad: (f.unidad_archivo as string | null) ?? null,
    clase: f.clase === null || f.clase === undefined ? null : Number(f.clase),
    monto: Number(f.monto),
  };
}

/** `null` si el desglose no existe en la flota (o está anulado). */
export async function revisionDeDesglose(
  tenantId: string, desgloseId: string, umbrales?: Partial<UmbralesAtipicos>, ventanaMeses: number = VENTANA_MESES_DEFAULT,
): Promise<ReporteRevision | null> {
  const { data: d, error } = await acotada(supabaseAdmin().from('desglose_peaje')
    .select('id, proveedor, archivo_nombre, periodo_desde, periodo_hasta, periodo_oficial_desde, periodo_oficial_hasta, periodo_origen, no_periodo, calidad')
    .eq('tenant_id', tenantId).eq('id', desgloseId).is('anulado_en', null).maybeSingle(), 'revision_cobros.desglose');
  if (error) throw new Error(`revisionDeDesglose: ${error.message}`);
  if (!d) return null;

  const [filas, casetas, bajas, excepciones, justificados, tipos, inmovilizadas] = await Promise.all([
    lineasDeDesglose(tenantId, desgloseId), listarReglasCasetas(tenantId), listarTagsBaja(tenantId),
    listarExcepcionesUnidad(tenantId), listarJustificaciones(tenantId, desgloseId), listarTiposUnidadPorTag(tenantId),
    inmovilizadasPorTag(tenantId),
  ]);
  const periodoOficialDesde = (d.periodo_oficial_desde as string | null) ?? null;
  // El tipo de unidad sale del maestro TAG→unidad (no del archivo): un TAG sin alta o sin tipo queda `null`.
  const lineas = filas.map(lineaCobroDeFila).map((l) => {
    const tag = normalizarTag(l.tag);
    return { ...l, tipoUnidad: (tag ? tipos.get(tag) : undefined) ?? null };
  });
  const revision = revisarCobros(lineas, reglasDesdeConfig(casetas, bajas, periodoOficialDesde, excepciones, justificados, [], inmovilizadas));
  const conCoords = casetas.filter((c) => c.lat !== null && c.lng !== null).map((c) => ({ nombre: c.nombre, lat: c.lat as number, lng: c.lng as number }));
  // A37-A2-17: sin umbrales explícitos, la pantalla usa los que la flota guardó en Configuración (los mismos del aviso). Si no se pueden leer, los de partida.
  let umbralesFlota: Partial<UmbralesAtipicos> = umbrales ?? {};
  let apagadas: ReturnType<typeof umbralesDePantalla>['apagadas'] = [];
  if (umbrales === undefined) {
    try {
      const traducido = umbralesDePantalla((await leerConfigAtipicos(tenantId)).umbrales);
      umbralesFlota = traducido.umbrales;
      apagadas = traducido.apagadas;
    } catch (e) {
      logger.warn('peajes.revision_config_atipicos', { tenant: tenantId, codigo: codigoDeError(e) }); // sin el mensaje de la base: puede traer TAG/unidad/importe
    }
  }
  const atipicos = sinSenalesApagadas(detectarAtipicos(lineas, conCoords, umbralesFlota), apagadas);
  // Solo se leen los desgloses previos si hay periodo y al menos un extemporáneo que buscar.
  const hayExtemporaneos = periodoOficialDesde !== null && lineas.some((l) => l.fecha !== null && l.fecha < periodoOficialDesde);
  const previos = hayExtemporaneos && periodoOficialDesde !== null
    ? await lineasPreviasDeFlota(tenantId, desgloseId, periodoOficialDesde, ventanaMeses) : [];
  const dobleEntreArchivos = revisarDobleEntreArchivos(lineas, previos, { periodoDesde: periodoOficialDesde, archivoActualId: desgloseId, ventanaMeses });
  return {
    desgloseId, proveedor: (d.proveedor as string | null) ?? null, archivoNombre: (d.archivo_nombre as string | null) ?? null,
    periodoMedidoDesde: (d.periodo_desde as string | null) ?? null, periodoMedidoHasta: (d.periodo_hasta as string | null) ?? null,
    periodoOficialDesde, periodoOficialHasta: (d.periodo_oficial_hasta as string | null) ?? null,
    periodoOrigen: (d.periodo_origen as ReporteRevision['periodoOrigen']) ?? null,
    noPeriodo: (d.no_periodo as string | null) ?? null,
    calidad: (d.calidad as Record<string, unknown> | null) ?? null,
    revision, atipicos, dobleEntreArchivos, rotulo: ROTULO_CANDIDATO,
  };
}

// ── El cierre mensual de la flota ───────────────────────────────────────────

/**
 * Consolida los desgloses de un mes (y trae los del mes anterior para comprobar tardíos
 * ya cobrados). Un desglose pertenece al mes en que TERMINA su periodo oficial.
 */
export async function cierreMensualDeFlota(tenantId: string, mes: string): Promise<CierreMensual | { error: string }> {
  const lim = limitesDelMes(mes);
  const previo = mesAnterior(mes);
  if (!lim || !previo) return { error: `El mes «${mes}» no es válido (usa AAAA-MM).` };
  const limPrevio = limitesDelMes(previo) as { desde: string; hasta: string };

  const desgloses = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(supabaseAdmin().from('desglose_peaje')
      .select('id, archivo_nombre, periodo_oficial_desde, periodo_oficial_hasta', conteo(d))
      .eq('tenant_id', tenantId).is('anulado_en', null)
      .gte('periodo_oficial_hasta', limPrevio.desde).lte('periodo_oficial_hasta', lim.hasta)
      .order('periodo_oficial_desde').order('id').range(d, h), 'revision_cobros.cierre_desgloses'),
    'revision_cobros.cierre_desgloses',
  );
  const archivos: ArchivoCierre[] = [];
  for (const d of desgloses) {
    const filas = await lineasDeDesglose(tenantId, String(d.id));
    archivos.push({
      id: String(d.id), etiqueta: String(d.archivo_nombre ?? d.id),
      periodoDesde: (d.periodo_oficial_desde as string | null) ?? null, periodoHasta: (d.periodo_oficial_hasta as string | null) ?? null,
      lineas: filas.map((f) => ({
        fecha: (f.fecha as string | null) ?? null, hora: f.hora ? String(f.hora).slice(0, 8) : null,
        caseta: (f.caseta as string | null) ?? null, tag: (f.tag as string | null) ?? null, monto: Number(f.monto),
      })),
    });
  }
  return cierreMensual(mes, archivos);
}

// ── El seguimiento de reclamos y notas de crédito ───────────────────────────

export interface ReclamoVista {
  id: string;
  desgloseId: string | null;
  proveedor: string | null;
  categoria: string;
  estado: EstadoReclamo;
  nCruces: number;
  montoReclamado: number;
  montoAcreditado: number;
  fechaCobroMasAntiguo: string;
  enviadoEn: string | null;
  referenciaPortal: string | null;
  notas: string | null;
  evaluacion: EvaluacionReclamo;
}

export async function listarReclamos(tenantId: string, hoy: string): Promise<{ reclamos: ReclamoVista[]; resumen: ResumenSeguimiento }> {
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(supabaseAdmin().from('peaje_reclamo')
      .select('id, desglose_id, proveedor, categoria, estado, n_cruces, monto_reclamado, monto_acreditado, fecha_cobro_mas_antiguo, enviado_en, referencia_portal, notas', conteo(d))
      .eq('tenant_id', tenantId).order('fecha_cobro_mas_antiguo').order('id').range(d, h), 'revision_cobros.listar_reclamos'),
    'revision_cobros.listar_reclamos',
  );
  const reclamos: ReclamoVista[] = filas.map((f) => {
    const base = {
      id: String(f.id), estado: String(f.estado) as EstadoReclamo,
      fechaCobroMasAntiguo: String(f.fecha_cobro_mas_antiguo).slice(0, 10),
      montoReclamado: Number(f.monto_reclamado ?? 0), montoAcreditado: Number(f.monto_acreditado ?? 0),
    };
    return {
      ...base, desgloseId: (f.desglose_id as string | null) ?? null, proveedor: (f.proveedor as string | null) ?? null,
      categoria: String(f.categoria), nCruces: Number(f.n_cruces), enviadoEn: f.enviado_en ? String(f.enviado_en).slice(0, 10) : null,
      referenciaPortal: (f.referencia_portal as string | null) ?? null, notas: (f.notas as string | null) ?? null,
      evaluacion: evaluarReclamo(base, hoy),
    };
  });
  return { reclamos, resumen: resumirSeguimiento(reclamos, hoy) };
}

/**
 * Registra un reclamo a partir de los CANDIDATOS de una categoría de un desglose: cuántos cruces, cuánto
 * dinero y el cobro más antiguo salen del cálculo (no de lo que diga el formulario). Nace `preparado`, o
 * `enviado` si se da la fecha de envío.
 *
 * CANDADO DE IDEMPOTENCIA (auditoría adversarial, HALLAZGO ALTO #1; migración 0845): el formulario ya
 * deshabilita su botón mientras la acción corre, pero esa es defensa de UI — dos pestañas, un doble POST
 * de red o un reintento igual podían llegar aquí dos veces y crear dos reclamos gemelos por el mismo
 * dinero. El candado real es el índice único parcial `peaje_reclamo_activo_unico` (mismo molde que 0815):
 * el segundo INSERT choca con el unique y aquí se traduce a un motivo legible (mismo criterio de
 * `ingesta.ts` con `peaje_ingesta_archivo_huella_unica`: se detecta por el MENSAJE del error, no por
 * `error.code` — PostgREST no siempre lo trae, y es lo único que la base en memoria de las pruebas puede fingir).
 */
export async function crearReclamoDeCategoria(
  tenantId: string,
  entrada: { desgloseId: string; categoria: CategoriaCobro; enviadoEn?: string | null; referenciaPortal?: string | null; notas?: string | null },
): Promise<{ ok: true; id: string } | { ok: false; motivo: string }> {
  const reporte = await revisionDeDesglose(tenantId, entrada.desgloseId);
  if (!reporte) return { ok: false, motivo: 'Ese desglose no existe en tu flota (o fue anulado).' };
  // A37-A2-05: lo interno de la flota no se le reclama al proveedor, y lo que una persona ya descartó, justificó o reclamó
  // renglón por renglón no se vuelve a sumar (antes el reclamo por categoría los incluía y el monto salía inflado).
  if (esCategoriaInterna(entrada.categoria)) {
    return { ok: false, motivo: `«${ETIQUETA_CATEGORIA_COBRO[entrada.categoria]}» es un asunto interno de la flota, no un cobro del proveedor: no se registra como reclamo.` };
  }
  const decididos = new Set((await listarDecisionesCandidatos(tenantId, entrada.desgloseId)).map((d) => `${d.indice}|${d.categoria}`));
  const cands = reporte.revision.candidatos.filter((c) => c.categoria === entrada.categoria && !c.justificacion && !decididos.has(`${c.indice}|${c.categoria}`));
  if (cands.length === 0) return { ok: false, motivo: `No hay candidatos pendientes de «${ETIQUETA_CATEGORIA_COBRO[entrada.categoria]}» en ese desglose (los que había ya se descartaron, justificaron o reclamaron).` };
  const fechas = cands.map((c) => c.fecha).filter((f): f is string => f !== null).sort();
  if (fechas.length === 0) return { ok: false, motivo: 'Los candidatos no traen fecha de cobro: no se puede calcular el plazo de reclamo.' };
  const enviado = entrada.enviadoEn?.trim() || null;
  if (enviado && !/^\d{4}-\d{2}-\d{2}$/.test(enviado)) return { ok: false, motivo: 'La fecha de envío debe ser AAAA-MM-DD.' };
  const monto = Math.round(cands.reduce((s, c) => s + c.monto, 0) * 100) / 100;
  const { data, error } = await acotada(supabaseAdmin().from('peaje_reclamo').insert({
    tenant_id: tenantId, desglose_id: entrada.desgloseId, proveedor: reporte.proveedor, categoria: entrada.categoria,
    estado: enviado ? 'enviado' : 'preparado', n_cruces: cands.length, monto_reclamado: monto, monto_acreditado: 0,
    fecha_cobro_mas_antiguo: fechas[0], enviado_en: enviado,
    referencia_portal: entrada.referenciaPortal?.trim().slice(0, 120) || null, notas: entrada.notas?.trim().slice(0, 1000) || null,
  }).select('id').single(), 'revision_cobros.crear_reclamo');
  if (error && /duplicate key|unique/i.test(error.message)) {
    return { ok: false, motivo: `Ya hay un reclamo abierto de «${ETIQUETA_CATEGORIA_COBRO[entrada.categoria]}» para este desglose. Revisa el seguimiento antes de crear otro (probable doble envío).` };
  }
  if (error || !data) {
    logger.error('revision_cobros.crear_reclamo', { tenant: tenantId, err: error?.message ?? 'sin id' });
    return { ok: false, motivo: 'No se pudo registrar el reclamo. Inténtalo de nuevo.' };
  }
  return { ok: true, id: String(data.id) };
}

/** Marca un reclamo preparado como enviado. */
export async function marcarReclamoEnviado(tenantId: string, id: string, enviadoEn: string, referenciaPortal?: string | null): Promise<Resultado> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(enviadoEn)) return { ok: false, motivo: 'La fecha de envío debe ser AAAA-MM-DD.' };
  const { data, error } = await acotada(supabaseAdmin().from('peaje_reclamo')
    .update({ estado: 'enviado', enviado_en: enviadoEn, referencia_portal: referenciaPortal?.trim().slice(0, 120) || null, actualizado_en: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', id).eq('estado', 'preparado').select('id'), 'revision_cobros.marcar_enviado');
  if (error) { logger.error('revision_cobros.marcar_enviado', { tenant: tenantId, err: error.message }); return { ok: false, motivo: 'No se pudo actualizar el reclamo.' }; }
  if ((data ?? []).length === 0) return { ok: false, motivo: 'Ese reclamo no existe o ya no estaba en «preparado».' };
  return { ok: true };
}

const MOTIVO_NOTA_RECHAZADO = 'El proveedor rechazó este reclamo: no se le registran notas de crédito. Si te acreditó algo después, crea un reclamo nuevo.';
const motivoNotaExcede = (nuevo: number, reclamado: number, acreditado: number): string =>
  `Con esta nota lo acreditado (${mxn(nuevo)}) pasaría de lo reclamado (${mxn(reclamado)}); ya llevaba ${mxn(acreditado)}. Revisa el monto de la nota.`;

/**
 * Registra una nota de crédito recibida y actualiza lo acreditado y el estado del reclamo. Las notas del
 * proveedor llegan sin detalle: aquí solo se suma lo que SÍ se acreditó.
 */
export async function registrarNotaDeCredito(
  tenantId: string, entrada: { reclamoId: string; monto: number; fecha: string; referencia?: string | null; versionVista?: string | null },
): Promise<Resultado> {
  if (!Number.isFinite(entrada.monto) || entrada.monto <= 0 || entrada.monto > 1e9) return { ok: false, motivo: 'El monto de la nota de crédito debe ser mayor a cero.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entrada.fecha)) return { ok: false, motivo: 'La fecha de la nota debe ser AAAA-MM-DD.' };

  // A33-06 (migración 0860): camino ATÓMICO e IDEMPOTENTE en la base (candado de fila + clave por reclamo). La clave junta el reclamo, lo que
  // la pantalla VIO (`versionVista`: estado y total acreditado al pintar el formulario) y el contenido de la nota: un doble clic o dos pestañas
  // mandan la misma y se registra UNA vez; dos notas legítimas distintas (otro monto/fecha/folio, u otro estado visto) llevan claves distintas.
  const clave = entrada.versionVista == null ? null
    : createHash('sha256').update([entrada.reclamoId, entrada.versionVista, entrada.monto.toFixed(2), entrada.fecha, entrada.referencia?.trim() ?? ''].join('|')).digest('hex');
  // A36-R03-05: la función 0860 no veta un reclamo `rechazado` (la nota lo «revivía» a `acreditado` y chocaba con el único parcial
  // `peaje_reclamo_activo_unico` de la 0847) ni topa lo acreditado contra lo reclamado. Sin migrar, el veto vive aquí: una lectura previa.
  // Esta lectura NO es atómica frente a otra sesión que registre al mismo tiempo: desde la migración 0861 el MISMO veto y tope viven dentro de
  // `peaje_nota_credito_registrar`, bajo el `for update` (códigos `rechazado` y `excede_reclamado`, traducidos abajo). La lectura se conserva
  // para la base que aún no tiene la 0861 y para dar el mensaje sin ir a la función. Si el reclamo no se encuentra, decide la función (`no_existe`).
  const { data: r, error: errR } = await acotada(supabaseAdmin().from('peaje_reclamo')
    .select('id, estado, monto_reclamado, monto_acreditado').eq('tenant_id', tenantId).eq('id', entrada.reclamoId).maybeSingle(), 'revision_cobros.reclamo');
  if (errR) { logger.error('revision_cobros.reclamo', { tenant: tenantId, err: errR.message }); return { ok: false, motivo: 'No se pudo leer el reclamo.' }; }
  if (r) {
    // El reintento idéntico (misma clave ya registrada) lo contesta la función como duplicado: no se veta aquí.
    let yaRegistrada = false;
    if (clave !== null) {
      const { data: previa, error: errPrevia } = await acotada(supabaseAdmin().from('peaje_reclamo_nota')
        .select('id').eq('tenant_id', tenantId).eq('reclamo_id', entrada.reclamoId).eq('clave_idempotencia', clave).maybeSingle(), 'revision_cobros.nota_previa');
      if (errPrevia) { logger.error('revision_cobros.nota_previa', { tenant: tenantId, err: errPrevia.message }); return { ok: false, motivo: 'No se pudo leer el reclamo.' }; }
      yaRegistrada = !!previa;
    }
    if (!yaRegistrada) {
      if (r.estado === 'rechazado') return { ok: false, motivo: MOTIVO_NOTA_RECHAZADO };
      const reclamado = Math.round(Number(r.monto_reclamado) * 100);
      const nuevo = Math.round(Number(r.monto_acreditado ?? 0) * 100) + Math.round(entrada.monto * 100);
      if (Number.isFinite(reclamado) && nuevo > reclamado) {
        return { ok: false, motivo: motivoNotaExcede(nuevo / 100, reclamado / 100, Number(r.monto_acreditado ?? 0)) };
      }
    }
  }
  const viaRpc = await acotada(supabaseAdmin().rpc('peaje_nota_credito_registrar', {
    p_tenant: tenantId, p_reclamo: entrada.reclamoId, p_monto: entrada.monto, p_fecha: entrada.fecha,
    p_referencia: entrada.referencia?.trim().slice(0, 120) || null, p_clave: clave,
  }), 'revision_cobros.nota_rpc');
  if (!viaRpc.error) {
    const d = (Array.isArray(viaRpc.data) ? viaRpc.data[0] : viaRpc.data) as { ok?: boolean; codigo?: string; monto_acreditado?: number | string; monto_reclamado?: number | string } | null;
    if (d?.ok) return { ok: true };
    // 0861 (A36-R03-05): veto y tope atómicos de la función. Antes de la 0861 estos códigos no existen y caen en el error genérico de abajo.
    if (d?.codigo === 'rechazado') return { ok: false, motivo: MOTIVO_NOTA_RECHAZADO };
    if (d?.codigo === 'excede_reclamado') {
      const acreditado = Number(d.monto_acreditado ?? 0); const reclamado = Number(d.monto_reclamado ?? 0);
      return { ok: false, motivo: motivoNotaExcede(Math.round((acreditado + entrada.monto) * 100) / 100, reclamado, acreditado) };
    }
    if (d?.codigo === 'no_existe') return { ok: false, motivo: 'Ese reclamo no existe en tu flota.' };
    if (d?.codigo === 'sin_enviar') return { ok: false, motivo: 'El reclamo aún no está enviado: márcalo como enviado antes de registrar una nota de crédito.' };
    if (d?.codigo === 'monto_invalido') return { ok: false, motivo: 'El monto de la nota de crédito debe ser mayor a cero.' };
    if (d?.codigo === 'fecha_invalida') return { ok: false, motivo: 'La fecha de la nota debe ser AAAA-MM-DD.' };
    logger.error('revision_cobros.nota_rpc', { tenant: tenantId, err: 'respuesta inesperada de la función' });
    return { ok: false, motivo: 'No se pudo guardar la nota de crédito.' };
  }
  const codigoRpc = (viaRpc.error as { code?: string }).code;
  if (codigoRpc !== '42883' && codigoRpc !== 'PGRST202') {
    logger.error('revision_cobros.nota_rpc', { tenant: tenantId, err: viaRpc.error.message });
    return { ok: false, motivo: 'No se pudo guardar la nota de crédito.' };
  }
  // La migración 0860 aún no está aplicada en esta base: se cae al camino anterior (leer-sumar-escribir, SIN candado) y se avisa.
  logger.warn('revision_cobros.nota_sin_0860', { tenant: tenantId, aviso: 'peaje_nota_credito_registrar no existe: camino sin candado; aplicar la migración 0860' });
  if (!r) return { ok: false, motivo: 'Ese reclamo no existe en tu flota.' };
  if (r.estado === 'preparado') return { ok: false, motivo: 'El reclamo aún no está enviado: márcalo como enviado antes de registrar una nota de crédito.' };

  const { error: errN } = await acotada(supabaseAdmin().from('peaje_reclamo_nota').insert({
    tenant_id: tenantId, reclamo_id: entrada.reclamoId, monto: Math.round(entrada.monto * 100) / 100, fecha: entrada.fecha,
    referencia: entrada.referencia?.trim().slice(0, 120) || null,
  }), 'revision_cobros.nota');
  if (errN) { logger.error('revision_cobros.nota', { tenant: tenantId, err: errN.message }); return { ok: false, motivo: 'No se pudo guardar la nota de crédito.' }; }

  const acreditado = Math.round((Number(r.monto_acreditado ?? 0) + entrada.monto) * 100) / 100;
  const estado = estadoTrasAcreditar(r.estado as EstadoReclamo, Number(r.monto_reclamado), acreditado);
  const { error: errU } = await acotada(supabaseAdmin().from('peaje_reclamo')
    .update({ monto_acreditado: acreditado, estado, actualizado_en: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', entrada.reclamoId), 'revision_cobros.actualizar_reclamo');
  if (errU) {
    logger.error('revision_cobros.actualizar_reclamo', { tenant: tenantId, err: errU.message });
    return { ok: false, motivo: 'La nota quedó guardada, pero no se pudo actualizar el total acreditado. Vuelve a abrir el reclamo.' };
  }
  return { ok: true };
}

export async function marcarReclamoRechazado(tenantId: string, id: string): Promise<boolean> {
  const { error } = await acotada(supabaseAdmin().from('peaje_reclamo')
    .update({ estado: 'rechazado', actualizado_en: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', id).in('estado', ['enviado', 'acreditado_parcial']), 'revision_cobros.rechazar');
  if (error) logger.error('revision_cobros.rechazar', { tenant: tenantId, err: error.message });
  return !error;
}

export { ESTADOS_RECLAMO };

// ─────────────────────────────────────────────────────────────────────────
// De `bitacora_conciliada.ts` — la bitácora conciliada, su CSV y el reporte
// de reclamación.
// ─────────────────────────────────────────────────────────────────────────


// ═══════════════════════════════════════════════════════════════════════════
// LA BITÁCORA CONCILIADA — el cruce del proveedor, línea por línea, con su
// estado honesto y exportable a CSV.
//
// A diferencia de la bitácora RMF 9.1.8 (`bitacoraRmf918`: solo las líneas que
// cuadran, para el documento fiscal), esta lista TODAS las líneas del desglose
// con uno de tres estados —cuadra / sin respaldo / por verificar— y el motivo.
// Es la herramienta del contralor para resolver lo que el agente no pudo
// afirmar, y el insumo del CSV a SAP/Excel. El estado se calcula al leer, con
// `clasificarVerificacion` (pura), sobre lo que el cruce dejó en cada línea.
// ═══════════════════════════════════════════════════════════════════════════

export const ETIQUETA_ESTADO: Record<EstadoConciliado, string> = {
  cuadra: 'cuadra',
  sin_respaldo: 'sin respaldo',
  por_verificar: 'por verificar',
};

export interface FilaConciliada {
  indice: number;
  fecha: string;
  hora: string;
  casetaProveedor: string;
  casetaCatalogo: string;
  tag: string;
  unidad: string;
  monto: number;
  estado: EstadoConciliado;
  motivo: MotivoVerificacion;
  explicacion: string;
  viaje: string;
  diferencia: number | null;
  gps: 'confirma' | 'no coincide' | 'sin datos' | 'sin evaluar';
  gpsDistanciaM: number | null;
  gpsNota: string;
  /** Para el reporte de reclamación (no salen en el CSV). */
  unidadId?: string | null;
  casetaId?: string | null;
  /** El viaje contra el que cuadró la línea (para el convenio del curso). */
  viajeId?: string | null;
  /** ISO UTC del pase (`cruce_en`), si el archivo trae hora. */
  cruceEn?: string | null;
}

export interface BitacoraConciliada {
  desgloseId: string;
  proveedor: string | null;
  periodoDesde: string | null;
  periodoHasta: string | null;
  filas: FilaConciliada[];
  resumen: ResumenVerificacion;
  /** Líneas que el cruce no ha evaluado con GPS (desglose anterior a la 0375): conviene re-conciliar. */
  sinEvaluarGps: number;
  leyendas: readonly string[];
}

export const LEYENDAS_BITACORA_CONCILIADA: readonly string[] = [
  'Bitácora conciliada del desglose del proveedor de peaje: TODAS las líneas del archivo, cada una con su estado y el motivo. Es una herramienta de revisión: el estado es una anotación recalculable sobre el archivo, no un sello fiscal.',
  'cuadra = un gasto de caseta respalda el cobro (monto y día) y ninguna otra evidencia lo contradice.',
  'sin respaldo = hay tickets de caseta cargados en el periodo y ninguno respalda este cobro, y el GPS (si existe) tampoco lo confirma. Es un hecho sobre los datos de Likida; NO afirma que el cobro sea indebido.',
  'por verificar = el dato no alcanza para afirmar nada, o hay una señal que un humano debe mirar (monto distinto, dos gastos igual de posibles, TAG de otra unidad, GPS que no ubica la unidad en la caseta, falta de fecha o de tickets cargados). El motivo dice qué falta.',
  'El GPS compara la trayectoria de la unidad contra las coordenadas de la caseta del catálogo (distancia Haversine) en una ventana de minutos alrededor de la hora del cobro; la hora es hora local de México tal como la trae el archivo. «sin datos» significa que el dato no alcanzó (sin hora, TAG sin dar de alta, caseta sin coordenadas, sin posiciones cerca) — no es evidencia en contra de nadie.',
];

const rotuloGps = (v: unknown): FilaConciliada['gps'] =>
  v === 'confirma' ? 'confirma' : v === 'no_coincide' ? 'no coincide' : v === 'sin_datos' ? 'sin datos' : 'sin evaluar';

export async function bitacoraConciliada(tenantId: string, desgloseId: string): Promise<BitacoraConciliada | null> {
  const admin = supabaseAdmin();
  const { data: desglose, error: errD } = await acotada(admin.from('desglose_peaje')
    .select('id, proveedor, periodo_desde, periodo_hasta').eq('tenant_id', tenantId).eq('id', desgloseId).is('anulado_en', null).maybeSingle(), 'bitacora_conciliada.desglose');
  if (errD) throw new Error(`bitacoraConciliada: ${errD.message}`);
  if (!desglose) return null;

  const crudas = await traerTodo<Record<string, unknown>>(
    (d, h) => acotada(admin.from('desglose_peaje_linea')
      .select('indice, fecha, hora, cruce_en, caseta, monto, tag, estatus, diferencia, detalle, viaje_id, unidad_id, caseta_id, gps_veredicto, gps_distancia_m, gps_detalle', conteo(d))
      .eq('tenant_id', tenantId).eq('desglose_id', desgloseId)
      .order('indice').order('id').range(d, h), 'bitacora_conciliada.lineas'),
    'bitacora_conciliada.lineas',
  );

  const viajeIds = [...new Set(crudas.map((l) => l.viaje_id as string | null).filter((v): v is string => !!v))];
  const folioPorViaje = new Map<string, string>();
  if (viajeIds.length > 0) {
    const vs = await traerPorIds<{ id: unknown; folio: unknown }>(
      viajeIds,
      (tanda) => acotada(admin.from('viaje').select('id, folio').eq('tenant_id', tenantId).in('id', tanda), 'bitacora_conciliada.viajes'),
      'bitacora_conciliada.viajes',
    );
    for (const v of vs) folioPorViaje.set(String(v.id), String(v.folio ?? ''));
  }
  const [unidades, casetas] = await Promise.all([listarUnidades(tenantId), listarCasetas(tenantId)]);
  const ecoPorUnidad = new Map(unidades.map((u) => [u.id, u.numeroEconomico]));
  const nombrePorCaseta = new Map(casetas.map((c) => [c.id, c.nombre]));

  let sinEvaluarGps = 0;
  const filas: FilaConciliada[] = crudas.map((l) => {
    const estatus = String(l.estatus) as 'cuadra' | 'no_cuadra' | 'sin_contraparte';
    const detalle = (l.detalle as Record<string, unknown> | null) ?? null;
    const gpsVeredicto = (l.gps_veredicto as 'confirma' | 'no_coincide' | 'sin_datos' | null) ?? null;
    const gpsDetalle = (l.gps_detalle as Record<string, unknown> | null) ?? null;
    const gpsMotivo = typeof gpsDetalle?.motivo === 'string' ? gpsDetalle.motivo : null;
    if (gpsVeredicto === null) sinEvaluarGps++;
    const v = clasificarVerificacion({ estatus, detalle, gpsVeredicto, gpsMotivo });
    return {
      indice: Number(l.indice),
      fecha: (l.fecha as string | null) ?? '',
      hora: l.hora ? String(l.hora).slice(0, 8) : '',
      casetaProveedor: (l.caseta as string | null) ?? '',
      casetaCatalogo: l.caseta_id ? (nombrePorCaseta.get(String(l.caseta_id)) ?? '') : '',
      tag: (l.tag as string | null) ?? '',
      unidad: l.unidad_id ? (ecoPorUnidad.get(String(l.unidad_id)) ?? '') : '',
      monto: Number(l.monto),
      estado: v.estado,
      motivo: v.motivo,
      explicacion: v.explicacion,
      viaje: l.viaje_id ? (folioPorViaje.get(String(l.viaje_id)) ?? '') : '',
      diferencia: l.diferencia === null || l.diferencia === undefined ? null : Number(l.diferencia),
      gps: rotuloGps(gpsVeredicto),
      gpsDistanciaM: l.gps_distancia_m === null || l.gps_distancia_m === undefined ? null : Number(l.gps_distancia_m),
      gpsNota: gpsVeredicto === 'sin_datos' ? textoMotivoGps(gpsMotivo) : '',
      unidadId: (l.unidad_id as string | null) ?? null,
      casetaId: (l.caseta_id as string | null) ?? null,
      viajeId: (l.viaje_id as string | null) ?? null,
      cruceEn: (l.cruce_en as string | null) ?? null,
    };
  });

  return {
    desgloseId,
    proveedor: (desglose.proveedor as string | null) ?? null,
    periodoDesde: (desglose.periodo_desde as string | null) ?? null,
    periodoHasta: (desglose.periodo_hasta as string | null) ?? null,
    filas,
    resumen: resumirVerificacion(filas.map((f) => ({ estado: f.estado, monto: f.monto }))),
    sinEvaluarGps,
    leyendas: LEYENDAS_BITACORA_CONCILIADA,
  };
}

// ── El CSV ──────────────────────────────────────────────────────────────────

/**
 * Neutraliza la inyección de fórmulas (CSV injection): un texto del PROVEEDOR
 * que empiece con =, +, -, @, tab o retorno se abriría en Excel como fórmula.
 * Se antepone «'» a los TEXTOS peligrosos; los números no se tocan.
 */
export function celdaCsvSegura(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const ENCABEZADOS_CSV_CONCILIADA = [
  'linea', 'fecha_cruce', 'hora_cruce', 'caseta_proveedor', 'caseta_catalogo', 'tag', 'unidad_tag', 'monto', 'estado', 'motivo',
  'explicacion', 'viaje', 'diferencia_mxn', 'gps', 'gps_distancia_m', 'gps_nota',
] as const;

export function bitacoraConciliadaACsv(b: BitacoraConciliada): string {
  const r = b.resumen;
  const cab = [
    ...b.leyendas.map((l) => `# ${l}`),
    `# Desglose: ${b.desgloseId}${b.proveedor ? ` · Proveedor: ${b.proveedor}` : ''}${b.periodoDesde && b.periodoHasta ? ` · Periodo medido: ${b.periodoDesde} a ${b.periodoHasta}` : ''}`,
    `# Resumen: ${r.total} líneas · cuadra ${r.cuadra} ($${r.montoCuadra.toFixed(2)}) · sin respaldo ${r.sinRespaldo} ($${r.montoSinRespaldo.toFixed(2)}) · por verificar ${r.porVerificar} ($${r.montoPorVerificar.toFixed(2)})`,
    ...(b.sinEvaluarGps > 0 ? [`# Aviso: ${b.sinEvaluarGps} líneas no tienen evaluación GPS (el cruce es anterior a la hora del cobro): vuelve a conciliar el desglose para evaluarlas.`] : []),
    '#',
  ].map((l) => l.replace(/[\r\n]+/g, ' ')).join('\n');

  if (b.filas.length === 0) return `${cab}\n# (El desglose no tiene líneas.)\n`;
  const filas = b.filas.map((f) => [
    f.indice + 1, f.fecha, f.hora, f.casetaProveedor, f.casetaCatalogo, f.tag, f.unidad, f.monto,
    ETIQUETA_ESTADO[f.estado], f.motivo, f.explicacion, f.viaje, f.diferencia, f.gps, f.gpsDistanciaM, f.gpsNota,
  ].map(celdaCsvSegura).join(','));
  return `${cab}\n${ENCABEZADOS_CSV_CONCILIADA.join(',')}\n${filas.join('\n')}\n`;
}

// ── El reporte de reclamación ───────────────────────────────────────────────

/**
 * El reporte de cruces para pedirle al proveedor la revisión de un cobro: el
 * desglose cruzado con TAG↔unidad, la hora del PASE, las posiciones GPS y las
 * geocercas de la flota (`reclamacion.ts` decide y explica; aquí solo se traen
 * los datos). `null` si el desglose no existe en la flota (o está anulado).
 *
 * Las posiciones solo se piden para las candidatas (el GPS dijo «no coincide» o
 * dijo «no alcanzan las muestras»): las confirmadas y las sin datos no necesitan
 * evidencia ni se reclaman, y traerlas todas multiplicaría las consultas.
 *
 * `perfilRestringido` (perfil `cinco_agentes`, T-A2-24): solo `gps_lejos_de_caseta` y doble cobro. No se leen geocercas ni cursos
 * (stand-by: ni se consultan, ni pueden quedarse con la línea antes que el doble cobro) y las leyendas son las del perfil.
 */
export async function reporteReclamacion(
  tenantId: string, desgloseId: string, opciones: { perfilRestringido?: boolean } = {},
): Promise<ReporteReclamacion | null> {
  const restringido = opciones.perfilRestringido === true;
  const b = await bitacoraConciliada(tenantId, desgloseId);
  if (!b) return null;
  const [casetas, geocercas, cursosVista] = await Promise.all([
    listarCasetas(tenantId),
    restringido ? Promise.resolve([]) : listarGeocercas(tenantId, { zonasParaReclamacion: true }),
    restringido ? Promise.resolve([]) : listarCursos(tenantId),
  ]);
  const cursos: CursoDeFlota[] = cursosVista.filter((c) => c.activo).map((c) => ({
    id: c.id, codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, unidadId: c.unidadId, convenioId: c.convenioId, activo: c.activo,
    casetaIds: c.casetas.map((k) => k.id), casetaNombres: c.casetas.map((k) => k.nombre),
    corredor: c.tipo === 'corredor' && c.corredor && c.bufferM !== null ? { polilinea: c.corredor, bufferM: c.bufferM } : null,
    vigenteDesde: c.vigenteDesde, vigenteHasta: c.vigenteHasta,
  }));
  // El convenio de cada línea sale del viaje contra el que cuadró (solo si hay cursos de convenio que consultar).
  const hayCursosDeConvenio = cursos.some((c) => c.convenioId !== null);
  const convenioDelViaje = hayCursosDeConvenio
    ? await convenioPorViaje(tenantId, [...new Set(b.filas.map((f) => f.viajeId).filter((v): v is string => !!v))])
    : new Map<string, string>();
  const cursosDe = (f: FilaConciliada) => cursosQueAplican(cursos, f.unidadId ?? null, f.viajeId ? (convenioDelViaje.get(f.viajeId) ?? null) : null);
  const geoPorCaseta = new Map(casetas.flatMap((c) => (c.lat !== null && c.lng !== null && Number.isFinite(c.lat) && Number.isFinite(c.lng) ? [[c.id, { lat: c.lat, lng: c.lng, radioM: c.radioM }] as const] : [])));

  // Candidatas a evidencia: las que el cruce marcó «no coincide» o dejó en «muestras insuficientes», y las que tienen un curso de
  // tipo corredor (su evaluación mide la posición a la hora del pase contra la polilínea).
  const candidatas = b.filas.filter((f) =>
    f.cruceEn && f.unidadId && (f.gps === 'no coincide' || (f.gps === 'sin datos' && f.gpsNota === textoMotivoGps('muestras_insuficientes'))
      || cursosDe(f).some((c) => c.tipo === 'corredor')));
  const ventanas: VentanaPosiciones[] = candidatas.map((f) => {
    const t = Date.parse(f.cruceEn as string);
    return { lineaId: String(f.indice), unidadId: f.unidadId as string, desde: new Date(t - VENTANA_GPS_MIN * 60_000).toISOString(), hasta: new Date(t + VENTANA_GPS_MIN * 60_000).toISOString() };
  }).filter((v) => Number.isFinite(Date.parse(v.desde)));
  const muestras = await traerMuestrasPorLinea(tenantId, ventanas);

  const lineas: LineaReclamable[] = b.filas.map((f) => ({
    indice: f.indice, fecha: f.fecha, hora: f.hora, caseta: f.casetaProveedor, casetaCatalogo: f.casetaCatalogo,
    tag: f.tag, unidad: f.unidad, monto: f.monto,
    cruceMs: f.cruceEn ? Date.parse(f.cruceEn) : null,
    gps: f.gps, gpsDistanciaM: f.gpsDistanciaM, gpsNota: f.gpsNota,
    casetaGeo: f.casetaId ? (geoPorCaseta.get(f.casetaId) ?? null) : null,
    muestras: muestras.get(String(f.indice)) ?? [],
    casetaId: f.casetaId ?? null,
    cursos: cursosDe(f),
  }));
  const { cruces, resumen } = construirReclamacion(lineas, geocercas.filter((g) => g.activa));
  return {
    desgloseId, proveedor: b.proveedor, periodoDesde: b.periodoDesde, periodoHasta: b.periodoHasta,
    cruces, resumen, leyendas: restringido ? leyendasDePerfil() : LEYENDAS_RECLAMACION,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// De `vinculos_conciliacion.ts` — T-A2-21, el vínculo cruce → viaje dentro
// de la conciliación.
// ─────────────────────────────────────────────────────────────────────────


// ═══════════════════════════════════════════════════════════════════════════
// T-A2-21 — EL VÍNCULO CRUCE → VIAJE DENTRO DE LA CONCILIACIÓN.
//
// Tras conciliar un desglose, y SOLO si la flota lo activó (depende de tener
// viajes cargados), se liga cada línea con su viaje (Icident si hay posiciones,
// si no unidad+ventana) y se guarda aparte de `desglose_peaje_linea.viaje_id`.
// Recalculable: correrlo de nuevo sobrescribe, nunca duplica. NUNCA lanza: un
// fallo se registra y la ingesta que lo llamó no se entera (queda `fallo`).
// ═══════════════════════════════════════════════════════════════════════════

/** De dónde salen los viajes y las posiciones; por omisión la tabla local `viaje` y ninguna posición (aún sin API). */
export interface FuenteVinculos {
  cargar(tenantId: string, rango: RangoFechas): Promise<{ viajes: ViajeFuente[]; posiciones: PosicionConViaje[] }>;
}

export const fuenteLocal: FuenteVinculos = {
  async cargar(tenantId, rango) {
    const { viajes } = await desdeTablaViajeLocal(tenantId, rango);
    return { viajes, posiciones: [] };
  },
};

export type ResultadoVinculos =
  | { estado: 'apagado' }
  | { estado: 'ok'; lineas: number; ligados: number; ambiguos: number; sinViaje: number; sinUnidad: number; conflictos: number }
  | { estado: 'fallo'; motivo: string };

const MARGEN_DIAS = 1;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const desplazar = (ymd: string, dias: number): string =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);

/** Calcula y guarda los vínculos de un desglose. No lanza. */
export async function vincularDesglose(
  tenantId: string, desgloseId: string, fuente: FuenteVinculos = fuenteLocal,
): Promise<ResultadoVinculos> {
  try {
    if (!(await leerVinculosActivo(tenantId))) return { estado: 'apagado' };

    const lineas = await traerTodo<Record<string, unknown>>(
      (d, h) => acotada(supabaseAdmin().from('desglose_peaje_linea')
        .select('id, indice, fecha, caseta, hora, unidad_archivo', conteo(d))
        .eq('tenant_id', tenantId).eq('desglose_id', desgloseId).order('indice').range(d, h), 'peajes.vinculos.lineas'),
      'peajes.vinculos.lineas',
    );
    const resumen = { lineas: lineas.length, ligados: 0, ambiguos: 0, sinViaje: 0, sinUnidad: 0, conflictos: 0 };
    if (lineas.length === 0) return { estado: 'ok', ...resumen };

    const cruces: CruceIcident[] = lineas.map((l) => ({
      id: String(l.id),
      unidadArchivo: typeof l.unidad_archivo === 'string' ? l.unidad_archivo : null,
      fecha: typeof l.fecha === 'string' ? l.fecha.slice(0, 10) : '',
      caseta: typeof l.caseta === 'string' ? l.caseta : null,
      hora: typeof l.hora === 'string' ? l.hora : null,
    }));
    const fechas = cruces.map((c) => c.fecha).filter((f) => FECHA.test(f)).sort();
    // Sin una sola fecha válida no hay rango que buscar: todas caen en «sin_viaje» con su motivo.
    const { viajes, posiciones } = fechas.length === 0
      ? { viajes: [] as ViajeFuente[], posiciones: [] as PosicionConViaje[] }
      : await fuente.cargar(tenantId, { desde: desplazar(fechas[0], -MARGEN_DIAS), hasta: desplazar(fechas[fechas.length - 1], MARGEN_DIAS) });

    // El catálogo solo importa para equivaler caseta↔punto de interés: sin posiciones no se lee.
    const catalogo = posiciones.length > 0 ? await listarCasetas(tenantId, true) : undefined;
    const vinculos = vincularPorIcident(cruces, viajes, posiciones, { margenDias: MARGEN_DIAS, catalogo });

    const guardar: VinculoGuardado[] = vinculos.map((v) => ({
      lineaId: String(v.id), estado: v.estado, viajeId: v.viajeId, via: v.via,
      candidatos: v.candidatos, icident: v.icident ?? null, motivo: v.motivo,
    }));
    await guardarVinculos(tenantId, desgloseId, guardar);

    for (const v of vinculos) {
      if (v.estado === 'ligado') resumen.ligados++;
      else if (v.estado === 'ambiguo') resumen.ambiguos++;
      else if (v.estado === 'sin_viaje') resumen.sinViaje++;
      else if (v.estado === 'sin_unidad') resumen.sinUnidad++;
      else resumen.conflictos++;
    }
    return { estado: 'ok', ...resumen };
  } catch (e) {
    // Solo un código estable: el mensaje de la base puede traer el valor de una columna (unidad, caseta).
    logger.error('cron.peajes.vinculos_fallo', { tenant: tenantId, desglose: desgloseId, codigo: codigoDeError(e) });
    return { estado: 'fallo', motivo: e instanceof Error ? e.message : String(e) };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// De `vinculos_reporte.ts` — T-A2-22. `leerVinculosParaArchivo` se QUEDÓ en
// `vinculos_reporte.ts` (no se trajo aquí): llama a `revisionDeDesglose`
// (de este mismo archivo) como dependencia cruzada a propósito —
// `costo_viaje_cableado.test.ts` la mockea para probar que un fallo de
// candidatos deja `candidatos: null` sin tumbar el costo. Un mock de módulo
// no intercepta una llamada entre dos funciones DEL MISMO archivo (el enlace
// ESM es directo, no pasa por el namespace exportado), así que mantener la
// llamada como una importación real entre archivos es lo que la hace
// mockeable. Las tres consultas que antes tenía inline SÍ se movieron aquí
// (abajo): `leerDesgloseVigenteParaVinculos`, `leerLineasParaVinculosArchivo`
// y `leerViajesConOrigenDestino`.
// ─────────────────────────────────────────────────────────────────────────

/** El desglose (solo su id) si existe y no está anulado en esa flota, o `null`. Lanza ante error de base. */
export async function leerDesgloseVigenteParaVinculos(tenantId: string, desgloseId: string): Promise<{ id: unknown } | null> {
  const { data, error } = await acotada(supabaseAdmin().from('desglose_peaje')
    .select('id').eq('tenant_id', tenantId).eq('id', desgloseId).is('anulado_en', null).maybeSingle(), 'peajes.vinculos_archivo.desglose');
  if (error) throw new Error(`leerDesgloseVigenteParaVinculos: ${error.message}`);
  return data;
}

/** Las líneas de un desglose con las columnas que necesita el archivo «casetas ligadas a viaje». */
export async function leerLineasParaVinculosArchivo(tenantId: string, desgloseId: string): Promise<Array<Record<string, unknown>>> {
  return traerTodo<Record<string, unknown>>(
    (d, h) => acotada(supabaseAdmin().from('desglose_peaje_linea')
      .select('id, indice, fecha, hora, caseta, monto, clase, unidad_archivo, unidad_id', conteo(d))
      .eq('tenant_id', tenantId).eq('desglose_id', desgloseId).order('indice').order('id').range(d, h), 'peajes.vinculos_archivo.lineas'),
    'peajes.vinculos_archivo.lineas',
  );
}

/** Folio, origen y destino de un lote de viajes (para el costo por viaje y sus folios). */
export async function leerViajesConOrigenDestino(
  tenantId: string, viajeIds: string[],
): Promise<Array<{ id: unknown; folio: unknown; origen: unknown; destino: unknown }>> {
  return traerPorIds<{ id: unknown; folio: unknown; origen: unknown; destino: unknown }>(
    viajeIds,
    (tanda) => acotada(supabaseAdmin().from('viaje').select('id, folio, origen, destino').eq('tenant_id', tenantId).in('id', tanda), 'peajes.vinculos_archivo.viajes'),
    'peajes.vinculos_archivo.viajes',
  );
}
