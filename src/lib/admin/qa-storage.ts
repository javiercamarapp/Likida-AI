// ═══════════════════════════════════════════════════════════════════════════
// PANEL DE QA — la capa de almacenamiento. SOLO servidor.
//
// EL REPARTO: los BYTES viven en Storage, el ÍNDICE y el estado viven en la
// base (migración 0185: qa_foto / qa_corrida / qa_corrida_paso). Es el mismo
// reparto que `gasto.imagen_url` usa desde la 0039 — un binario en el bucket,
// su significado en una fila.
//
// Dos buckets PRIVADOS, mismo criterio de privacidad que
// supabase/migrations/0039_bucket_comprobantes.sql: un ticket real trae RFC,
// domicilio y a veces nombre del titular (art. 2 fr. VI LFPDPPP) — nada de
// buckets públicos ni <img src> sin firmar. Sin policies: RLS deniega a
// anon/authenticated por defecto y solo el service-role toca.
//
// QUÉ CAMBIÓ RESPECTO DE LA FASE A. El estado era JSON en Storage
// (banco/manifiesto.json y corridas/<id>/corrida.json) porque las migraciones
// estaban congeladas esperando el token de Supabase. Ese motivo caducó, y el
// atajo tenía dos agujeros que ningún cuidado en TypeScript cerraba:
//
//   · El dedup del banco era un read-modify-write sobre un archivo: dos
//     subidas concurrentes leían el mismo manifiesto y la segunda pisaba a la
//     primera. Ahora la carrera la resuelve el `unique` del hash — y cuando
//     salta, esta capa la trata como lo que es (un duplicado), no como error.
//   · El tope diario de $5 se calculaba descargando hasta 200 JSON. Un
//     candado de dinero que depende de 200 descargas falla abierto el día que
//     Storage vaya lento. Ahora es un `select` acotado al día de México.
//
// La superficie exportada NO cambió: el motor, las rutas y las pantallas
// siguen llamando lo mismo.
// ═══════════════════════════════════════════════════════════════════════════

import { hoyMx, inicioDiaMx, finDiaMx } from '@/lib/formato';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CorridaQA, FotoBanco, PasoQA, EstadoCorrida, EscenarioId } from './qa-tipos';

export const BUCKET_QA_FOTOS = 'qa-fotos';
export const BUCKET_QA_EVIDENCIA = 'qa-evidencia';

/** Los formatos que el pipeline real de WhatsApp entrega. Un HEIC se rechaza
 *  con el motivo a la vista (conviértelo con `sips -s format jpeg`) — meterlo
 *  al banco probaría un formato que producción nunca ve. */
export const MIMES_PERMITIDOS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** sha256 hex de los bytes — el MISMO digest que `hashImagen` de producción
 *  (`src/lib/likida/intake/hash.ts` decodifica el base64 y hace SHA-256 de
 *  los bytes); qa-storage.test.ts prueba la equivalencia byte a byte. */
export function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Dedup puro contra una lista ya leída: la foto con ese hash, o null. Sigue
 *  siendo útil (el lote se dedupea contra sí mismo antes de tocar la red),
 *  pero ya NO es la garantía: esa la da el `unique` de qa_foto.hash. */
export function duplicadaPorHash(fotos: FotoBanco[], hash: string): FotoBanco | null {
  return fotos.find((f) => f.hash === hash) ?? null;
}

export function extensionDe(mime: string): string | null {
  return MIMES_PERMITIDOS[mime] ?? null;
}

// ── Buckets ─────────────────────────────────────────────────────────────────

let bucketsListos = false;

/** Solo para las pruebas: el memo de buckets es de proceso y sobreviviría
 *  entre casos. */
export function _olvidarBuckets(): void {
  bucketsListos = false;
}

export async function asegurarBuckets(db: SupabaseClient): Promise<void> {
  if (bucketsListos) return;
  for (const bucket of [BUCKET_QA_FOTOS, BUCKET_QA_EVIDENCIA]) {
    const { data } = await db.storage.getBucket(bucket);
    if (data) continue;
    const { error } = await db.storage.createBucket(bucket, { public: false });
    // Carrera benigna: si otro proceso lo creó entre el get y el create, el
    // "already exists" no es un fallo.
    if (error && !/exists/i.test(error.message)) {
      throw new Error(`no se pudo crear el bucket ${bucket}: ${error.message}`);
    }
  }
  bucketsListos = true;
}

// ── Traducción fila ⇄ tipo ──────────────────────────────────────────────────

type Resultado<T> = { ok: true; datos: T } | { ok: false; error: string };

interface FilaFoto {
  id: string; hash: string; path: string; mime: string; etiqueta: string;
  bytes: number; subido_en: string; ocr_esperado: unknown;
}

function fotoDeFila(f: FilaFoto): FotoBanco {
  return {
    id: f.id, hash: f.hash, path: f.path, mime: f.mime, etiqueta: f.etiqueta,
    bytes: Number(f.bytes), subidoEn: f.subido_en,
    // El tipo declara `null` mientras el oráculo humano (Fase B pieza 2) no
    // exista en la pantalla. La columna ya lo admite; leerlo como otra cosa
    // sería adelantarse al contrato.
    ocrEsperado: (f.ocr_esperado ?? null) as null,
  };
}

interface FilaCorrida {
  id: string; escenario: string; carril: string; parametros: unknown; estado: string;
  motivo: string | null; tenant_id: string | null; tenant_nombre: string;
  creada_en: string; inicio: string | null; fin: string | null; latido_en: string;
  costo_usd_total: number | string; veredicto: unknown; turnos: unknown;
  pdfs: string[] | null; limpieza: string | null;
}

interface FilaPaso {
  corrida_id: string; n: number; nombre: string; estado: string;
  costo_usd: number | string; detalle: string | null;
  inicio: string | null; fin: string | null;
}

function pasoDeFila(p: FilaPaso): PasoQA {
  return {
    n: Number(p.n), nombre: p.nombre, estado: p.estado as PasoQA['estado'],
    costoUsd: Number(p.costo_usd),
    ...(p.detalle !== null ? { detalle: p.detalle } : {}),
    ...(p.inicio !== null ? { inicio: p.inicio } : {}),
    ...(p.fin !== null ? { fin: p.fin } : {}),
  };
}

function corridaDeFilas(c: FilaCorrida, pasos: FilaPaso[]): CorridaQA {
  return {
    id: c.id,
    escenario: c.escenario as EscenarioId,
    carril: c.carril as CorridaQA['carril'],
    parametros: c.parametros as CorridaQA['parametros'],
    estado: c.estado as EstadoCorrida,
    motivo: c.motivo,
    tenantId: c.tenant_id,
    tenantNombre: c.tenant_nombre,
    creadaEn: c.creada_en,
    inicio: c.inicio,
    fin: c.fin,
    latidoEn: c.latido_en,
    pasos: pasos.filter((p) => p.corrida_id === c.id).sort((a, b) => a.n - b.n).map(pasoDeFila),
    costoUsdTotal: Number(c.costo_usd_total),
    veredicto: (c.veredicto ?? null) as CorridaQA['veredicto'],
    turnos: (Array.isArray(c.turnos) ? c.turnos : []) as CorridaQA['turnos'],
    pdfs: c.pdfs ?? [],
    limpieza: c.limpieza,
  };
}

/** Postgrest no tipa el código del error; el 23505 sí viaja en `code`. */
function esDuplicado(error: { code?: string; message?: string } | null): boolean {
  return error?.code === '23505' || /duplicate key|already exists/i.test(error?.message ?? '');
}

/** Traduce el error de una tabla que no existe (42P01 / PGRST205) a algo
 *  accionable. Sin esto, un panel abierto antes de aplicar la migración dice
 *  `relation "public.qa_foto" does not exist` y parece que se rompió — cuando
 *  lo único que pasa es que falta un paso conocido. El panel degrada
 *  diciendo la verdad, que es la regla de la casa. */
function tabla(error: { code?: string; message?: string } | null, prefijo: string): string {
  const msg = error?.message ?? 'error sin mensaje';
  const falta = error?.code === '42P01' || error?.code === 'PGRST205'
    || /does not exist|schema cache/i.test(msg);
  return falta
    ? `${prefijo}: falta aplicar la migración 0185 (qa_foto / qa_corrida / qa_corrida_paso). El panel no puede leer nada hasta entonces — el detalle: ${msg}`
    : `${prefijo}: ${msg}`;
}

// ── El banco de fotos ───────────────────────────────────────────────────────

/** Lee el banco. Banco sin estrenar = 0 fotos DE VERDAD; cualquier otro fallo
 *  se dice — nunca "0" sobre una base que no se pudo leer (regla de la casa:
 *  fallar cerrado y decirlo). */
export async function leerManifiesto(db: SupabaseClient): Promise<Resultado<FotoBanco[]>> {
  try {
    const { data, error } = await db.from('qa_foto')
      .select('id, hash, path, mime, etiqueta, bytes, subido_en, ocr_esperado')
      .order('subido_en', { ascending: true });
    if (error) return { ok: false, error: tabla(error, 'no se pudo leer el banco de fotos') };
    return { ok: true, datos: ((data ?? []) as FilaFoto[]).map(fotoDeFila) };
  } catch (e) {
    return { ok: false, error: `no se pudo leer el banco de fotos: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function fotoPorHash(db: SupabaseClient, hash: string): Promise<FotoBanco | null> {
  const { data, error } = await db.from('qa_foto')
    .select('id, hash, path, mime, etiqueta, bytes, subido_en, ocr_esperado')
    .eq('hash', hash).limit(1);
  if (error || !data || data.length === 0) return null;
  return fotoDeFila(data[0] as FilaFoto);
}

export interface ArchivoNuevo { nombre: string; mime: string; bytes: Buffer }
export interface ResultadoSubida {
  nombre: string;
  /** id en el banco (nuevo o el del duplicado reusado). */
  id: string | null;
  duplicadoDe: string | null;   // etiqueta de la foto ya existente, si dedup
  error: string | null;
}

/** Sube N archivos de golpe ("cantidad obscena" bienvenida): dedup por hash,
 *  una fila por foto. Cada archivo reporta su suerte por separado — un HEIC
 *  rechazado no tira el lote.
 *
 *  EL DEDUP TIENE DOS CINTURONES y hacen falta los dos: la lectura previa
 *  evita subir bytes que ya están (ahorra red), y el `unique` de la base
 *  resuelve la carrera que la lectura no puede ver. Cuando el segundo salta,
 *  los bytes recién subidos se retiran del bucket con la Storage API — que es
 *  el único camino que Supabase permite (lo aprendió a golpes la 0165). */
export async function subirFotos(
  db: SupabaseClient, archivos: ArchivoNuevo[],
): Promise<Resultado<{ resultados: ResultadoSubida[]; fotos: FotoBanco[] }>> {
  try {
    await asegurarBuckets(db);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const previo = await leerManifiesto(db);
  if (!previo.ok) return previo;
  const yaVistas = [...previo.datos];
  const resultados: ResultadoSubida[] = [];

  for (const a of archivos) {
    const ext = extensionDe(a.mime);
    if (!ext) {
      resultados.push({ nombre: a.nombre, id: null, duplicadoDe: null, error: `formato ${a.mime || 'desconocido'} no permitido — el flujo real entrega JPEG/PNG/WebP (un HEIC: conviértelo con sips)` });
      continue;
    }
    if (a.bytes.length === 0 || a.bytes.length > 15 * 1024 * 1024) {
      resultados.push({ nombre: a.nombre, id: null, duplicadoDe: null, error: 'archivo vacío o mayor a 15 MB' });
      continue;
    }
    const hash = hashBytes(a.bytes);
    const dup = duplicadaPorHash(yaVistas, hash);
    if (dup) {
      resultados.push({ nombre: a.nombre, id: dup.id, duplicadoDe: dup.etiqueta, error: null });
      continue;
    }

    // La ruta es el HASH, no un uuid: el objeto queda direccionado por su
    // contenido, así que re-subir los mismos bytes cae en el mismo sitio y el
    // `upsert` no puede dejar dos copias del mismo ticket ocupando el bucket.
    // Las fotos importadas de la Fase A conservan su ruta vieja (`banco/<id>`)
    // — la fila guarda el path, nadie lo recalcula.
    const path = `banco/${hash}.${ext}`;
    const { error: errSubida } = await db.storage.from(BUCKET_QA_FOTOS)
      .upload(path, a.bytes, { contentType: a.mime, upsert: true });
    if (errSubida) {
      resultados.push({ nombre: a.nombre, id: null, duplicadoDe: null, error: `no se pudo subir: ${errSubida.message}` });
      continue;
    }

    const fila = {
      hash, path, mime: a.mime,
      etiqueta: a.nombre.slice(0, 120),
      bytes: a.bytes.length,
    };
    const { data, error } = await db.from('qa_foto').insert(fila)
      .select('id, hash, path, mime, etiqueta, bytes, subido_en, ocr_esperado').limit(1);

    if (error) {
      if (esDuplicado(error)) {
        // Otro proceso ganó la carrera entre la lectura y el insert. No es un
        // fallo: es el dedup funcionando donde el manifiesto en JSON perdía
        // una foto en silencio.
        const existente = await fotoPorHash(db, hash);
        if (existente) {
          yaVistas.push(existente);
          resultados.push({ nombre: a.nombre, id: existente.id, duplicadoDe: existente.etiqueta, error: null });
          continue;
        }
      }
      // El insert no entró: los bytes que acabamos de subir no son de nadie.
      await db.storage.from(BUCKET_QA_FOTOS).remove([path]).catch(() => undefined);
      resultados.push({ nombre: a.nombre, id: null, duplicadoDe: null, error: `no se pudo registrar en el banco: ${error.message}` });
      continue;
    }

    const nueva = fotoDeFila((data as FilaFoto[])[0]);
    yaVistas.push(nueva);
    resultados.push({ nombre: a.nombre, id: nueva.id, duplicadoDe: null, error: null });
  }

  return { ok: true, datos: { resultados, fotos: yaVistas } };
}

/** Los bytes de una foto del banco como data-URL — SIEMPRE resuelto del lado
 *  del servidor a partir del id (nunca se confía en un data-URL del cliente:
 *  00-PANEL-DE-QA.md §3, "el resolver de la foto"). */
export async function dataUrlDeFoto(db: SupabaseClient, foto: FotoBanco): Promise<string> {
  const { data, error } = await db.storage.from(BUCKET_QA_FOTOS).download(foto.path);
  if (error) throw new Error(`no se pudo descargar la foto ${foto.id}: ${error.message}`);
  const buf = Buffer.from(await data.arrayBuffer());
  return `data:${foto.mime};base64,${buf.toString('base64')}`;
}

/** URL firmada de 60 s — el mismo plazo que usa producción para el PDF
 *  (processor.ts, createSignedUrl(path, 60)). */
export async function firmarRuta(db: SupabaseClient, bucket: string, path: string): Promise<string | null> {
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// ── Corridas ────────────────────────────────────────────────────────────────

/** Escribe la corrida y TODOS sus pasos. El upsert de pasos cae siempre en la
 *  misma fila por la PK (corrida_id, n): el motor reescribe cada paso en cada
 *  transición y no puede duplicarlo. */
export async function guardarCorrida(db: SupabaseClient, corrida: CorridaQA): Promise<void> {
  corrida.latidoEn = new Date().toISOString();
  const fila = {
    id: corrida.id,
    escenario: corrida.escenario,
    carril: corrida.carril,
    parametros: corrida.parametros,
    estado: corrida.estado,
    motivo: corrida.motivo,
    tenant_id: corrida.tenantId,
    tenant_nombre: corrida.tenantNombre,
    creada_en: corrida.creadaEn,
    inicio: corrida.inicio,
    fin: corrida.fin,
    latido_en: corrida.latidoEn,
    costo_usd_total: corrida.costoUsdTotal,
    veredicto: corrida.veredicto,
    turnos: corrida.turnos,
    pdfs: corrida.pdfs,
    limpieza: corrida.limpieza,
  };
  const { error } = await db.from('qa_corrida').upsert(fila, { onConflict: 'id' });
  if (error) throw new Error(`no se pudo guardar la corrida ${corrida.id}: ${error.message}`);

  if (corrida.pasos.length > 0) {
    const filas = corrida.pasos.map((p) => ({
      corrida_id: corrida.id,
      n: p.n,
      nombre: p.nombre,
      estado: p.estado,
      costo_usd: p.costoUsd,
      detalle: p.detalle ?? null,
      inicio: p.inicio ?? null,
      fin: p.fin ?? null,
    }));
    const { error: errPasos } = await db.from('qa_corrida_paso').upsert(filas, { onConflict: 'corrida_id,n' });
    if (errPasos) throw new Error(`no se pudieron guardar los pasos de ${corrida.id}: ${errPasos.message}`);
  }
}

const COLS_CORRIDA =
  'id, escenario, carril, parametros, estado, motivo, tenant_id, tenant_nombre, creada_en, inicio, fin, latido_en, costo_usd_total, veredicto, turnos, pdfs, limpieza';
const COLS_PASO = 'corrida_id, n, nombre, estado, costo_usd, detalle, inicio, fin';

async function pasosDe(db: SupabaseClient, ids: string[]): Promise<Resultado<FilaPaso[]>> {
  if (ids.length === 0) return { ok: true, datos: [] };
  const { data, error } = await db.from('qa_corrida_paso').select(COLS_PASO).in('corrida_id', ids);
  if (error) return { ok: false, error: tabla(error, 'no se pudieron leer los pasos') };
  return { ok: true, datos: (data ?? []) as FilaPaso[] };
}

export async function leerCorrida(db: SupabaseClient, id: string): Promise<Resultado<CorridaQA | null>> {
  try {
    const { data, error } = await db.from('qa_corrida').select(COLS_CORRIDA).eq('id', id).limit(1);
    if (error) return { ok: false, error: tabla(error, 'no se pudo leer la corrida') };
    const filas = (data ?? []) as FilaCorrida[];
    // Corrida inexistente = null DE VERDAD (el id de la URL puede ser viejo);
    // un fallo de lectura es otra cosa y ya se dijo arriba.
    if (filas.length === 0) return { ok: true, datos: null };
    const pasos = await pasosDe(db, [id]);
    if (!pasos.ok) return pasos;
    return { ok: true, datos: corridaDeFilas(filas[0], pasos.datos) };
  } catch (e) {
    return { ok: false, error: `no se pudo leer la corrida: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** El historial: más nuevas primero, con sus pasos en UNA segunda consulta
 *  (la Fase A abría un archivo por corrida). */
export async function listarCorridas(db: SupabaseClient, limite = 60): Promise<Resultado<CorridaQA[]>> {
  try {
    const { data, error } = await db.from('qa_corrida').select(COLS_CORRIDA)
      .order('creada_en', { ascending: false }).limit(limite);
    if (error) return { ok: false, error: tabla(error, 'no se pudo listar corridas') };
    const filas = (data ?? []) as FilaCorrida[];
    const pasos = await pasosDe(db, filas.map((c) => c.id));
    if (!pasos.ok) return pasos;
    return { ok: true, datos: filas.map((c) => corridaDeFilas(c, pasos.datos)) };
  } catch (e) {
    return { ok: false, error: `no se pudo listar corridas: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** ¿Dos instantes caen el mismo día calendario de México? — el tope diario se
 *  mide con el día de la operación (America/Mexico_City), no UTC. Puro. */
export function mismoDiaMx(aIso: string, bIso: string): boolean {
  try {
    return hoyMx(new Date(aIso)) === hoyMx(new Date(bIso));
  } catch {
    return false;
  }
}

/** Gasto REAL acumulado hoy (suma de costo_usd_total de las corridas de hoy,
 *  cada una a su vez leída de llm_costo — nunca una estimación).
 *
 *  Es el CANDADO del tope diario, así que se lee acotado al día de México en
 *  la propia consulta: la Fase A descargaba hasta 200 archivos para sumar
 *  esto, y un candado de dinero que depende de 200 descargas falla abierto el
 *  día que Storage vaya lento. */
export async function gastoHoyUsd(db: SupabaseClient): Promise<Resultado<number>> {
  try {
    const dia = hoyMx();
    const { data, error } = await db.from('qa_corrida').select('costo_usd_total')
      .gte('creada_en', inicioDiaMx(dia)).lte('creada_en', finDiaMx(dia));
    if (error) return { ok: false, error: tabla(error, 'no se pudo leer el gasto del día') };
    const total = ((data ?? []) as Array<{ costo_usd_total: number | string }>)
      .reduce((s, c) => {
        const v = Number(c.costo_usd_total);
        return s + (Number.isFinite(v) ? v : 0);
      }, 0);
    return { ok: true, datos: Math.round(total * 10_000) / 10_000 };
  } catch (e) {
    return { ok: false, error: `no se pudo leer el gasto del día: ${e instanceof Error ? e.message : String(e)}` };
  }
}
