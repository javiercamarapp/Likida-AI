import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { traerTodo, conteo } from '../pg';
import { logger } from '@/lib/logger';
import { normalizarNombre, normalizarTag } from './formatos';
import { matrizDeCsv } from './csv';
import { coordenadaDeCelda, validarCoordenadasMexico } from './casetas';
import {
  revisarCobros, ETIQUETA_CATEGORIA_COBRO, ROTULO_CANDIDATO, TIPOS_UNIDAD_PEAJE,
  type CategoriaCobro, type LineaCobro, type ReglasCobro, type ResultadoRevision, type TipoUnidadPeaje,
} from './reglas_cobro';
import { detectarAtipicos, type ResultadoAtipicos, type UmbralesAtipicos } from './cruces_atipicos';
import { cierreMensual, type ArchivoCierre, type CierreMensual } from './cierre_mensual';
import { limitesDelMes, mesAnterior } from './periodo';
import { validarExcepcionUnidad, validarJustificacion } from './reglas_cobro_config';
import {
  estadoTrasAcreditar, evaluarReclamo, resumirSeguimiento, ESTADOS_RECLAMO,
  type EstadoReclamo, type EvaluacionReclamo, type ResumenSeguimiento,
} from './reclamos_seguimiento';

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
  return { periodoDesde, excepcionesClase, casetasNoCruzar, tagsBaja: new Map(bajas.map((b) => [b.tag, b.bajaEn])), excepcionesPorUnidad, justificados, clasesUtilitario };
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
  tenantId: string, desgloseId: string, umbrales: Partial<UmbralesAtipicos> = {},
): Promise<ReporteRevision | null> {
  const { data: d, error } = await acotada(supabaseAdmin().from('desglose_peaje')
    .select('id, proveedor, archivo_nombre, periodo_desde, periodo_hasta, periodo_oficial_desde, periodo_oficial_hasta, periodo_origen, no_periodo, calidad')
    .eq('tenant_id', tenantId).eq('id', desgloseId).is('anulado_en', null).maybeSingle(), 'revision_cobros.desglose');
  if (error) throw new Error(`revisionDeDesglose: ${error.message}`);
  if (!d) return null;

  const [filas, casetas, bajas, excepciones, justificados, tipos] = await Promise.all([
    lineasDeDesglose(tenantId, desgloseId), listarReglasCasetas(tenantId), listarTagsBaja(tenantId),
    listarExcepcionesUnidad(tenantId), listarJustificaciones(tenantId, desgloseId), listarTiposUnidadPorTag(tenantId),
  ]);
  const periodoOficialDesde = (d.periodo_oficial_desde as string | null) ?? null;
  // El tipo de unidad sale del maestro TAG→unidad (no del archivo): un TAG sin alta o sin tipo queda `null`.
  const lineas = filas.map(lineaCobroDeFila).map((l) => {
    const tag = normalizarTag(l.tag);
    return { ...l, tipoUnidad: (tag ? tipos.get(tag) : undefined) ?? null };
  });
  const revision = revisarCobros(lineas, reglasDesdeConfig(casetas, bajas, periodoOficialDesde, excepciones, justificados));
  const conCoords = casetas.filter((c) => c.lat !== null && c.lng !== null).map((c) => ({ nombre: c.nombre, lat: c.lat as number, lng: c.lng as number }));
  const atipicos = detectarAtipicos(lineas, conCoords, umbrales);
  return {
    desgloseId, proveedor: (d.proveedor as string | null) ?? null, archivoNombre: (d.archivo_nombre as string | null) ?? null,
    periodoMedidoDesde: (d.periodo_desde as string | null) ?? null, periodoMedidoHasta: (d.periodo_hasta as string | null) ?? null,
    periodoOficialDesde, periodoOficialHasta: (d.periodo_oficial_hasta as string | null) ?? null,
    periodoOrigen: (d.periodo_origen as ReporteRevision['periodoOrigen']) ?? null,
    noPeriodo: (d.no_periodo as string | null) ?? null,
    calidad: (d.calidad as Record<string, unknown> | null) ?? null,
    revision, atipicos, rotulo: ROTULO_CANDIDATO,
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
 */
export async function crearReclamoDeCategoria(
  tenantId: string,
  entrada: { desgloseId: string; categoria: CategoriaCobro; enviadoEn?: string | null; referenciaPortal?: string | null; notas?: string | null },
): Promise<{ ok: true; id: string } | { ok: false; motivo: string }> {
  const reporte = await revisionDeDesglose(tenantId, entrada.desgloseId);
  if (!reporte) return { ok: false, motivo: 'Ese desglose no existe en tu flota (o fue anulado).' };
  const cands = reporte.revision.candidatos.filter((c) => c.categoria === entrada.categoria);
  if (cands.length === 0) return { ok: false, motivo: `No hay candidatos de «${ETIQUETA_CATEGORIA_COBRO[entrada.categoria]}» en ese desglose.` };
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

/**
 * Registra una nota de crédito recibida y actualiza lo acreditado y el estado del reclamo. Las notas del
 * proveedor llegan sin detalle: aquí solo se suma lo que SÍ se acreditó.
 */
export async function registrarNotaDeCredito(
  tenantId: string, entrada: { reclamoId: string; monto: number; fecha: string; referencia?: string | null },
): Promise<Resultado> {
  if (!Number.isFinite(entrada.monto) || entrada.monto <= 0 || entrada.monto > 1e9) return { ok: false, motivo: 'El monto de la nota de crédito debe ser mayor a cero.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entrada.fecha)) return { ok: false, motivo: 'La fecha de la nota debe ser AAAA-MM-DD.' };
  const { data: r, error: errR } = await acotada(supabaseAdmin().from('peaje_reclamo')
    .select('id, estado, monto_reclamado, monto_acreditado').eq('tenant_id', tenantId).eq('id', entrada.reclamoId).maybeSingle(), 'revision_cobros.reclamo');
  if (errR) { logger.error('revision_cobros.reclamo', { tenant: tenantId, err: errR.message }); return { ok: false, motivo: 'No se pudo leer el reclamo.' }; }
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
