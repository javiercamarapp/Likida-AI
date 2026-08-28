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
import { conReintentoDeSaturacion, esSaturacionStorage, type OpcionesReintento } from '@/lib/supabase/reintento';
import { logger } from '@/lib/logger';
import {
  resumirAvance, PASADA_MUERTA_MS, validarVerdadTerreno,
  type CorridaQA, type FotoBanco, type PasoQA, type EstadoCorrida, type EscenarioId,
  type FotoDeCorrida, type EstadoFotoCorrida, type MemoriaCorrida, type Carril,
  type FaseCorrida, type CorteCorrida, type VerdadTerreno,
} from './qa-tipos';
import type { Medicion, OcrLeido } from './qa-verdad';

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
  confirmado_en?: string | null;
}

/** Las columnas del banco. Una sola constante para que la lectura del panel,
 *  la del dedup y la de la confirmación no se desincronicen — que fue justo lo
 *  que pasó cuando `confirmado_en` entró al tipo y tres `select` distintos
 *  seguían sin pedirlo. */
const COLS_FOTO = 'id, hash, path, mime, etiqueta, bytes, subido_en, ocr_esperado, confirmado_en';

function fotoDeFila(f: FilaFoto): FotoBanco {
  // LA VERDAD-DE-TERRENO SE RE-VALIDA AL LEERLA, no solo al escribirla.
  //
  // La columna es `jsonb` y la 0239 le puso el CHECK, pero el panel puede
  // correr contra una base donde esa migración todavía no se aplicó, y las
  // primeras etiquetas se escribieron a mano. Una etiqueta mal formada que
  // pase de largo aquí no da un error: da una medición con un campo contado en
  // el bando equivocado. Se degrada a `null` —"esta foto no se puede medir",
  // que la pantalla dice— en vez de medir contra algo que no cumple el
  // contrato.
  const crudo = f.ocr_esperado ?? null;
  let ocrEsperado: VerdadTerreno | null = null;
  if (crudo !== null) {
    const v = validarVerdadTerreno(crudo);
    ocrEsperado = v.ok ? v.datos : null;
  }
  return {
    id: f.id, hash: f.hash, path: f.path, mime: f.mime, etiqueta: f.etiqueta,
    bytes: Number(f.bytes), subidoEn: f.subido_en,
    ocrEsperado,
    confirmadoEn: f.confirmado_en ?? null,
  };
}

interface FilaCorrida {
  id: string; escenario: string; carril: string; parametros: unknown; estado: string;
  motivo: string | null; tenant_id: string | null; tenant_nombre: string;
  creada_en: string; inicio: string | null; fin: string | null; latido_en: string;
  costo_usd_total: number | string; veredicto: unknown; turnos: unknown;
  pdfs: string[] | null; limpieza: string | null;
  // Carril completo (mig. 0240). Se leen con `??` porque una base que todavía
  // no tiene la 0240 aplicada devuelve la fila sin estas llaves, y el panel
  // tiene que seguir pintando el historial viejo en vez de reventar.
  fase?: string | null; corte?: string | null; pasadas?: number | string | null;
  pasada_en_vuelo?: string | null; memoria?: unknown;
}

interface FilaFotoCorrida {
  corrida_id: string; foto_id: string; n: number; estado: string; pasada: number;
  detalle: string | null; costo_usd: number | string | null;
  inicio: string; fin: string | null;
}

function fotoDeCorridaDeFila(f: FilaFotoCorrida): FotoDeCorrida {
  // `costo_usd` NULL = NO SE MIDIÓ. `Number(null)` es 0 y `Number(undefined)`
  // es NaN: las dos conversiones automáticas convertirían "no se sabe" en una
  // afirmación. Se comprueba a mano, a propósito.
  const crudo = f.costo_usd;
  const costoUsd = crudo === null || crudo === undefined ? null : Number(crudo);
  return {
    fotoId: f.foto_id,
    n: Number(f.n),
    estado: f.estado as EstadoFotoCorrida,
    pasada: Number(f.pasada),
    detalle: f.detalle,
    costoUsd: costoUsd !== null && Number.isFinite(costoUsd) ? costoUsd : null,
    inicio: f.inicio,
    fin: f.fin,
  };
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

function corridaDeFilas(c: FilaCorrida, pasos: FilaPaso[], fotos: FilaFotoCorrida[] = []): CorridaQA {
  const carril = (c.carril ?? 'rapido') as Carril;
  const parametros = c.parametros as CorridaQA['parametros'];
  const mias = fotos.filter((f) => f.corrida_id === c.id).sort((a, b) => Number(a.n) - Number(b.n));
  return {
    id: c.id,
    escenario: c.escenario as EscenarioId,
    carril,
    parametros,
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
    fase: (c.fase ?? 'siembra') as FaseCorrida,
    corte: (c.corte ?? null) as CorteCorrida | null,
    pasadas: Number(c.pasadas ?? 0),
    pasadaEnVuelo: c.pasada_en_vuelo ?? null,
    memoria: (c.memoria ?? null) as MemoriaCorrida | null,
    // `null` en el carril rápido A PROPÓSITO: ahí no se escriben filas de
    // `qa_corrida_foto`, así que un avance de 0/N sobre una corrida rápida que
    // sí procesó sus diez fotos sería una cifra inventada. La pantalla enseña
    // el bloque de avance sólo cuando hay avance que enseñar.
    avance: carril === 'completo'
      ? resumirAvance(parametros?.fotoIds ?? [], mias.map(fotoDeCorridaDeFila))
      : null,
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
      .select(COLS_FOTO)
      .order('subido_en', { ascending: true });
    if (error) return { ok: false, error: tabla(error, 'no se pudo leer el banco de fotos') };
    return { ok: true, datos: ((data ?? []) as FilaFoto[]).map(fotoDeFila) };
  } catch (e) {
    return { ok: false, error: `no se pudo leer el banco de fotos: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function fotoPorHash(db: SupabaseClient, hash: string): Promise<FotoBanco | null> {
  const { data, error } = await db.from('qa_foto')
    .select(COLS_FOTO)
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
      .select(COLS_FOTO).limit(1);

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

export interface DescargaFoto {
  dataUrl: string;
  /** Cuántas veces hubo que REPETIR la descarga por saturación de Storage.
   *  0 = a la primera. El motor lo escribe en el detalle de la foto: un
   *  reintento que nadie ve es una saturación que nadie arregla. */
  reintentos: number;
}

/** Los bytes de una foto del banco como data-URL — SIEMPRE resuelto del lado
 *  del servidor a partir del id (nunca se confía en un data-URL del cliente:
 *  00-PANEL-DE-QA.md §3, "el resolver de la foto").
 *
 *  CON REINTENTO DECLARADO (incidente 28-ago-2026, corrida 46ad99ca): 10 de 90
 *  fotos quedaron 'bad' con «Too many connections issued to the database» —
 *  el pool de Storage API saturado por las ráfagas de firmas del panel (ver
 *  `firmarRutas` y la cabecera de supabase/reintento.ts). La causa raíz se
 *  arregló firmando en lote; este reintento es el segundo cinturón: un blip
 *  transitorio de saturación no debe costar una foto 'bad'. SOLO reintenta esa
 *  firma —un 404 falla igual a la segunda—, espera exponencial, y lo declara
 *  en el resultado y en el log. */
export async function dataUrlDeFoto(
  db: SupabaseClient, foto: FotoBanco, reintento: OpcionesReintento = {},
): Promise<DescargaFoto> {
  const { resultado, reintentos } = await conReintentoDeSaturacion(
    () => db.storage.from(BUCKET_QA_FOTOS).download(foto.path),
    (r) => r.error !== null && esSaturacionStorage(r.error.message),
    {
      ...reintento,
      alReintentar: (intento, esperaMs) => {
        logger.warn('qa.foto.descarga_reintentada', { foto: foto.id, intento, esperaMs, motivo: 'saturación de Storage' });
        reintento.alReintentar?.(intento, esperaMs);
      },
    },
  );
  const { data, error } = resultado;
  if (error) {
    const intentos = reintentos > 0 ? ` (tras ${reintentos + 1} intentos con espera exponencial)` : '';
    throw new Error(`no se pudo descargar la foto ${foto.id}${intentos}: ${error.message}`);
  }
  const buf = Buffer.from(await data.arrayBuffer());
  return { dataUrl: `data:${foto.mime};base64,${buf.toString('base64')}`, reintentos };
}

/** URL firmada de 60 s — el mismo plazo que usa producción para el PDF
 *  (processor.ts, createSignedUrl(path, 60)). Para UNA ruta suelta; una lista
 *  se firma con `firmarRutas`, que cuesta UN request y no N. */
export async function firmarRuta(db: SupabaseClient, bucket: string, path: string): Promise<string | null> {
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/**
 * Firma N rutas del mismo bucket en UN solo request (`createSignedUrls`).
 *
 * POR QUÉ EXISTE — el incidente del 28-ago-2026 (corrida 46ad99ca): el panel
 * firmaba las ~90 fotos de la corrida UNA POR UNA en cada poll de ~2.5 s del
 * ledger (/api/admin/qa/<id>/estado). Como 90 firmas tardan más que el
 * intervalo, los polls se traslapaban, y storage_logs registró ráfagas de ~90
 * POST /object/sign en ~4 s. Cada /object/sign le cuesta a Storage API una
 * conexión de su pool contra Postgres; el pool se llenó a ratos y las
 * descargas del carril —seriales e inocentes— rebotaron 10 veces con «Too
 * many connections issued to the database», cada una tras ~2.4 s de espera de
 * pool. Firmar en lote convierte esas ~90 conexiones por poll en UNA.
 *
 * El contrato por ruta es el MISMO que `firmarRuta`: url firmada, o `null` si
 * el objeto no existe o no se pudo firmar (el panel degrada a "sin preview",
 * no revienta). Si el lote ENTERO falla se dice en el log y todas quedan
 * `null` — fallar cerrado y decirlo, nunca inventar una URL.
 */
export async function firmarRutas(
  db: SupabaseClient, bucket: string, paths: readonly string[],
): Promise<Map<string, string | null>> {
  const urls = new Map<string, string | null>();
  const unicos = [...new Set(paths)];
  if (unicos.length === 0) return urls;
  for (const p of unicos) urls.set(p, null);
  try {
    const { data, error } = await db.storage.from(bucket).createSignedUrls(unicos, 60);
    if (error) {
      logger.warn('qa.firmas.lote_fallo', { bucket, rutas: unicos.length, err: error.message });
      return urls;
    }
    for (const fila of data ?? []) {
      if (fila.path && fila.signedUrl && !fila.error) urls.set(fila.path, fila.signedUrl);
    }
  } catch (e) {
    logger.warn('qa.firmas.lote_fallo', { bucket, rutas: unicos.length, err: e instanceof Error ? e.message : String(e) });
  }
  return urls;
}

// ── El oráculo humano: escribir la verdad-de-terreno ────────────────────────

/**
 * Firma la verdad-de-terreno de UNA foto: qué dice el comprobante de verdad,
 * según una persona que lo miró.
 *
 * Las tres cosas que van juntas o no va ninguna, y por qué:
 *
 *  · `ocr_esperado` — la etiqueta. Se RE-VALIDA aquí aunque quien llama ya la
 *    haya validado: es la última frontera antes de la base, y una etiqueta mal
 *    formada no rompe nada visiblemente, solo desvía una medición.
 *  · `confirmado_por` — quién la firmó. Puede ser `null` (una ingesta por
 *    script no tiene sesión de usuario), y eso es un dato honesto: no se
 *    inventa un autor.
 *  · `confirmado_en` — cuándo. NO es opcional: el CHECK
 *    `qa_foto_confirmacion_completa` de la 0185 exige que un `ocr_esperado`
 *    no nulo venga con su `confirmado_en` no nulo. Escribirlos por separado
 *    hace rebotar la fila entera, así que van en el mismo UPDATE.
 *
 * El error de supabase se reporta POR VALOR, incluidos los dos rebotes que
 * esta función puede provocar de verdad (el CHECK de la 0185 y el de la 0239),
 * traducidos a algo que se pueda leer sin abrir el SQL.
 */
export async function confirmarVerdadTerreno(
  db: SupabaseClient,
  fotoId: string,
  verdad: VerdadTerreno,
  confirmadoPor: string | null,
): Promise<Resultado<FotoBanco>> {
  const v = validarVerdadTerreno(verdad);
  if (!v.ok) return { ok: false, error: `la verdad-de-terreno no cumple el contrato — ${v.error}` };

  try {
    const { data, error } = await db.from('qa_foto')
      .update({
        ocr_esperado: v.datos,
        confirmado_por: confirmadoPor,
        // El instante lo pone ESTA capa, no un default de columna: la columna
        // no tiene default y el CHECK la exige, así que un update que solo
        // tocara `ocr_esperado` rebotaría.
        confirmado_en: new Date().toISOString(),
      })
      .eq('id', fotoId)
      .select(COLS_FOTO);

    if (error) {
      if (/qa_foto_verdad_terreno_completa/.test(error.message)) {
        return { ok: false, error: `la base rechazó la etiqueta (CHECK qa_foto_verdad_terreno_completa, mig. 0239): algún campo en null no está clasificado en "ilegibles" ni en "noAplica", o está en los dos. Detalle: ${error.message}` };
      }
      if (/qa_foto_confirmacion_completa/.test(error.message)) {
        return { ok: false, error: `la base rechazó la confirmación (CHECK qa_foto_confirmacion_completa, mig. 0185): un "esperado" sin firma no existe. Detalle: ${error.message}` };
      }
      return { ok: false, error: tabla(error, `no se pudo confirmar la foto ${fotoId}`) };
    }

    const filas = (data ?? []) as FilaFoto[];
    // Cero filas actualizadas NO es éxito: el id no existe en el banco. Sin
    // este chequeo la pantalla diría "confirmada" sobre una foto que nadie
    // tocó, que es la peor mentira posible en la superficie que produce la
    // vara de medir.
    if (filas.length === 0) return { ok: false, error: `la foto ${fotoId} no está en el banco — nada se confirmó` };
    return { ok: true, datos: fotoDeFila(filas[0]) };
  } catch (e) {
    return { ok: false, error: `no se pudo confirmar la foto ${fotoId}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ── Las lecturas del OCR (mig. 0239) ────────────────────────────────────────

export interface LecturaFoto {
  id: string;
  fotoId: string;
  corridaEn: string;
  modelo: string;
  ocrLeido: OcrLeido;
  medicion: Medicion;
  camposOk: number;
  camposMal: number;
  camposNoMedidos: number;
  costoUsd: number;
  motivo: string | null;
}

interface FilaLectura {
  id: string; foto_id: string; corrida_en: string; modelo: string;
  ocr_leido: unknown; medicion: unknown;
  campos_ok: number; campos_mal: number; campos_no_medidos: number;
  costo_usd: number | string; motivo: string | null;
}

const COLS_LECTURA =
  'id, foto_id, corrida_en, modelo, ocr_leido, medicion, campos_ok, campos_mal, campos_no_medidos, costo_usd, motivo';

function lecturaDeFila(l: FilaLectura): LecturaFoto {
  return {
    id: l.id,
    fotoId: l.foto_id,
    corridaEn: l.corrida_en,
    modelo: l.modelo,
    ocrLeido: (l.ocr_leido ?? {}) as OcrLeido,
    medicion: (l.medicion ?? { campos: [], camposOk: 0, camposMal: 0, camposNoMedidos: 0 }) as Medicion,
    camposOk: Number(l.campos_ok),
    camposMal: Number(l.campos_mal),
    camposNoMedidos: Number(l.campos_no_medidos),
    costoUsd: Number(l.costo_usd),
    motivo: l.motivo,
  };
}

export interface LecturaNueva {
  fotoId: string;
  modelo: string;
  ocrLeido: OcrLeido;
  medicion: Medicion;
  costoUsd: number;
  motivo: string | null;
}

/** Escribe UNA lectura del OCR contra una foto. Es un apéndice puro: nada se
 *  actualiza, cada corrida es una fila nueva — la pregunta que la tabla
 *  contesta ("¿mejoró el modelo?") se responde comparando dos instantes, y un
 *  upsert borraría justo la mitad de esa comparación. */
export async function guardarLectura(db: SupabaseClient, l: LecturaNueva): Promise<Resultado<LecturaFoto>> {
  try {
    const { data, error } = await db.from('qa_foto_lectura').insert({
      foto_id: l.fotoId,
      modelo: l.modelo,
      ocr_leido: l.ocrLeido,
      medicion: l.medicion,
      campos_ok: l.medicion.camposOk,
      campos_mal: l.medicion.camposMal,
      campos_no_medidos: l.medicion.camposNoMedidos,
      costo_usd: l.costoUsd,
      motivo: l.motivo,
    }).select(COLS_LECTURA).limit(1);
    if (error) return { ok: false, error: tablaLectura(error, `no se pudo guardar la lectura de la foto ${l.fotoId}`) };
    const filas = (data ?? []) as FilaLectura[];
    if (filas.length === 0) return { ok: false, error: `la lectura de la foto ${l.fotoId} no devolvió fila` };
    return { ok: true, datos: lecturaDeFila(filas[0]) };
  } catch (e) {
    return { ok: false, error: `no se pudo guardar la lectura de la foto ${l.fotoId}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Igual que `tabla`, pero apuntando a la migración que de verdad falta. Decir
 *  "aplica la 0185" cuando lo que falta es la 0239 manda a arreglar lo que ya
 *  está bien. */
function tablaLectura(error: { code?: string; message?: string } | null, prefijo: string): string {
  const msg = error?.message ?? 'error sin mensaje';
  const falta = error?.code === '42P01' || error?.code === 'PGRST205'
    || /does not exist|schema cache/i.test(msg);
  return falta
    ? `${prefijo}: falta aplicar la migración 0239 (qa_foto_lectura). Sin ella el OCR se puede correr pero su medición no se guarda — el detalle: ${msg}`
    : `${prefijo}: ${msg}`;
}

/**
 * La ÚLTIMA lectura de cada foto — lo que la pantalla enseña sin pedir una
 * corrida nueva.
 *
 * Se traen las N más recientes de todo el banco y se queda la primera por foto:
 * el índice `(foto_id, corrida_en desc)` de la 0239 hace barata la consulta, y
 * el orden descendente garantiza que la primera que se ve de cada foto es la
 * suya más nueva. `limite` acota lo que viaja; que se quede corto no inventa
 * nada — simplemente algunas fotos salen sin lectura, que es lo mismo que
 * "todavía sin medir".
 */
export async function leerUltimasLecturas(db: SupabaseClient, limite = 600): Promise<Resultado<Map<string, LecturaFoto>>> {
  try {
    const { data, error } = await db.from('qa_foto_lectura').select(COLS_LECTURA)
      .order('corrida_en', { ascending: false }).limit(limite);
    if (error) return { ok: false, error: tablaLectura(error, 'no se pudieron leer las lecturas del OCR') };
    const ultimas = new Map<string, LecturaFoto>();
    for (const f of (data ?? []) as FilaLectura[]) {
      if (!ultimas.has(f.foto_id)) ultimas.set(f.foto_id, lecturaDeFila(f));
    }
    return { ok: true, datos: ultimas };
  } catch (e) {
    return { ok: false, error: `no se pudieron leer las lecturas del OCR: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Lo que las lecturas del OCR llevan gastado HOY (día de México).
 *
 * Existe porque el tope diario del panel (`TOPE_DIA_USD`) se calculaba solo
 * sobre `qa_corrida`, y correr el OCR contra el banco gasta dinero de modelo
 * que ninguna corrida registra: sin esto, apretar el botón 91 veces se salta
 * el candado entero sin tocarlo. Falla POR VALOR — un tope que no se puede
 * leer no autoriza a gastar (fallar cerrado).
 */
export async function gastoLecturasHoyUsd(db: SupabaseClient): Promise<Resultado<number>> {
  try {
    const dia = hoyMx();
    const { data, error } = await db.from('qa_foto_lectura').select('costo_usd')
      .gte('corrida_en', inicioDiaMx(dia)).lte('corrida_en', finDiaMx(dia));
    if (error) return { ok: false, error: tablaLectura(error, 'no se pudo leer el gasto de lecturas del día') };
    const total = ((data ?? []) as Array<{ costo_usd: number | string }>).reduce((s, l) => {
      const v = Number(l.costo_usd);
      return s + (Number.isFinite(v) ? v : 0);
    }, 0);
    return { ok: true, datos: Math.round(total * 10_000) / 10_000 };
  } catch (e) {
    return { ok: false, error: `no se pudo leer el gasto de lecturas del día: ${e instanceof Error ? e.message : String(e)}` };
  }
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
    fase: corrida.fase,
    corte: corrida.corte,
    pasadas: corrida.pasadas,
    // `pasada_en_vuelo` NO se escribe aquí: su dueño es el UPDATE condicional
    // de `tomarPasada`/`soltarPasada`, que es lo que arbitra la carrera. Si
    // este upsert la pisara, dos pasadas simultáneas podrían quedarse las dos
    // con la llave — o sea, exactamente el candado convertido en adorno.
    memoria: corrida.memoria,
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
  'id, escenario, carril, parametros, estado, motivo, tenant_id, tenant_nombre, creada_en, inicio, fin, latido_en, costo_usd_total, veredicto, turnos, pdfs, limpieza, fase, corte, pasadas, pasada_en_vuelo, memoria';
const COLS_PASO = 'corrida_id, n, nombre, estado, costo_usd, detalle, inicio, fin';
const COLS_FOTO_CORRIDA = 'corrida_id, foto_id, n, estado, pasada, detalle, costo_usd, inicio, fin';

async function pasosDe(db: SupabaseClient, ids: string[]): Promise<Resultado<FilaPaso[]>> {
  if (ids.length === 0) return { ok: true, datos: [] };
  const { data, error } = await db.from('qa_corrida_paso').select(COLS_PASO).in('corrida_id', ids);
  if (error) return { ok: false, error: tabla(error, 'no se pudieron leer los pasos') };
  return { ok: true, datos: (data ?? []) as FilaPaso[] };
}

/** Las filas de avance (`qa_corrida_foto`) de las corridas dadas. Un fallo se
 *  DICE, nunca se lee como "esta corrida no ha procesado nada": esa confusión
 *  es la que haría que la pantalla enseñara 0 de 91 sobre una corrida que va
 *  en la 47. */
async function fotosDe(db: SupabaseClient, ids: string[]): Promise<Resultado<FilaFotoCorrida[]>> {
  if (ids.length === 0) return { ok: true, datos: [] };
  const { data, error } = await db.from('qa_corrida_foto').select(COLS_FOTO_CORRIDA).in('corrida_id', ids);
  if (error) return { ok: false, error: tabla(error, 'no se pudo leer el avance foto por foto') };
  return { ok: true, datos: (data ?? []) as FilaFotoCorrida[] };
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
    const fotos = filas[0].carril === 'completo' ? await fotosDe(db, [id]) : { ok: true as const, datos: [] };
    if (!fotos.ok) return fotos;
    return { ok: true, datos: corridaDeFilas(filas[0], pasos.datos, fotos.datos) };
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
    // Sólo las del carril completo: pedir el avance de 60 corridas rápidas
    // sería traer filas que no existen para pintar un bloque que no se pinta.
    const fotos = await fotosDe(db, filas.filter((c) => c.carril === 'completo').map((c) => c.id));
    if (!fotos.ok) return fotos;
    return { ok: true, datos: filas.map((c) => corridaDeFilas(c, pasos.datos, fotos.datos)) };
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

// ═══════════════════════════════════════════════════════════════════════════
// EL CARRIL COMPLETO — la llave de la pasada y el avance foto por foto
// (mig. 0240).
//
// Todo lo de aquí abajo existe para que una corrida de 91 fotos pueda avanzar
// en varias invocaciones sin repetir trabajo y sin gastar dos veces. Las dos
// garantías que lo sostienen son de la BASE, no de este archivo:
//
//   · `tomarPasada` es un UPDATE condicional. Dos invocaciones simultáneas
//     piden la llave; Postgres serializa los UPDATE y sólo uno ve una fila
//     devuelta. El otro lee cero filas y se va SIN gastar un peso. Un
//     `if (corrida.pasadaEnVuelo === null)` leído antes sería una carrera.
//   · `tomarFoto` es un INSERT contra la PK (corrida_id, foto_id). El segundo
//     intento rebota con 23505 y esta capa lo traduce a "esa foto ya tiene
//     dueño" — que es la verdad, no un error.
// ═══════════════════════════════════════════════════════════════════════════

/** Resultado de pedir la llave de la corrida para correr una pasada. */
export type TomaDePasada =
  | { ok: true; tomada: true; pasada: number }
  /** No se pudo tomar y se DICE por qué: otra pasada la tiene, o la corrida ya
   *  terminó. Nunca un `false` mudo. */
  | { ok: true; tomada: false; motivo: string }
  | { ok: false; error: string };

/**
 * Toma la corrida para una pasada nueva. Devuelve el número de pasada (1-based)
 * que le tocó.
 *
 * Se reclama una pasada ajena SÓLO cuando lleva `PASADA_MUERTA_MS` sin dar
 * señales (`latido_en`), o sea el `maxDuration` completo de la ruta: antes de
 * eso la otra pasada todavía puede estar viva y quitarle la llave sería
 * ponerse a mandar las mismas fotos en paralelo. Aun reclamando de más, la PK
 * de `qa_corrida_foto` impide que eso cueste dinero — pero el candado barato
 * va primero.
 */
export async function tomarPasada(
  db: SupabaseClient, corridaId: string, pasadaId: string, ahora: Date = new Date(),
): Promise<TomaDePasada> {
  try {
    const limite = new Date(ahora.getTime() - PASADA_MUERTA_MS).toISOString();
    const { data, error } = await db.from('qa_corrida')
      .update({ pasada_en_vuelo: pasadaId, latido_en: ahora.toISOString() })
      .eq('id', corridaId)
      .in('estado', ['pendiente', 'corriendo'])
      .or(`pasada_en_vuelo.is.null,latido_en.lt.${limite}`)
      .select('pasadas, estado');
    if (error) return { ok: false, error: tabla(error, 'no se pudo tomar la pasada') };
    const filas = (data ?? []) as Array<{ pasadas: number | string | null }>;
    if (filas.length === 0) {
      // Cero filas tiene DOS causas y no se pueden distinguir desde aquí sin
      // una segunda lectura; se dicen las dos en vez de elegir una al azar.
      return {
        ok: true, tomada: false,
        motivo: 'la corrida no está libre: o ya terminó, o otra pasada la tiene tomada y todavía da señales',
      };
    }
    return { ok: true, tomada: true, pasada: Number(filas[0].pasadas ?? 0) + 1 };
  } catch (e) {
    return { ok: false, error: `no se pudo tomar la pasada: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** EL LATIDO DE UNA PASADA VIVA no tiene función propia a propósito: lo da
 *  `guardarCorrida`, que refresca `latido_en` en cada apertura y cierre de
 *  paso — o sea, al menos dos veces por foto. Un latido aparte sería un
 *  segundo escritor del mismo campo que podría quedarse atrás del real.
 *
 *  Suelta la llave — SÓLO si sigue siendo nuestra. El `eq('pasada_en_vuelo')`
 *  evita que una pasada que ya fue dada por muerta le quite la llave a la que
 *  la relevó (el fencing de siempre: quien llega tarde no manda). */
export async function soltarPasada(db: SupabaseClient, corridaId: string, pasadaId: string): Promise<void> {
  const { error } = await db.from('qa_corrida')
    .update({ pasada_en_vuelo: null, latido_en: new Date().toISOString() })
    .eq('id', corridaId).eq('pasada_en_vuelo', pasadaId);
  if (error) throw new Error(`no se pudo soltar la pasada ${pasadaId}: ${error.message}`);
}

export type TomaDeFoto =
  | { ok: true; tomada: true }
  /** Ya tiene dueño (23505). No es un error: es la PK haciendo su trabajo. */
  | { ok: true; tomada: false }
  | { ok: false; error: string };

/** Toma UNA foto para esta pasada, dejando la marca 'corriendo' ANTES de
 *  mandarla. El orden importa: si se marcara después, una invocación que
 *  muriera a media foto no dejaría rastro y la siguiente pasada la mandaría de
 *  nuevo — el mismo ticket, pagado dos veces. */
export async function tomarFoto(
  db: SupabaseClient, corridaId: string, fotoId: string, n: number, pasada: number,
): Promise<TomaDeFoto> {
  try {
    const { error } = await db.from('qa_corrida_foto').insert({
      corrida_id: corridaId, foto_id: fotoId, n, pasada,
      estado: 'corriendo', inicio: new Date().toISOString(),
      // `costo_usd` se deja fuera: la columna es NULL-able y NULL significa
      // "no medido". Escribir 0 aquí diría que la foto ya costó cero.
    });
    if (!error) return { ok: true, tomada: true };
    if (esDuplicado(error)) return { ok: true, tomada: false };
    return { ok: false, error: tabla(error, `no se pudo tomar la foto ${fotoId}`) };
  } catch (e) {
    return { ok: false, error: `no se pudo tomar la foto ${fotoId}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Cierra la fila de una foto con lo que de verdad pasó. `costoUsd` puede ser
 *  `null` y entonces se guarda NULL: no se pudo medir ≠ costó cero. */
export async function cerrarFoto(
  db: SupabaseClient, corridaId: string, fotoId: string,
  estado: Exclude<EstadoFotoCorrida, 'corriendo'>, costoUsd: number | null, detalle?: string | null,
): Promise<void> {
  const { error } = await db.from('qa_corrida_foto')
    .update({ estado, costo_usd: costoUsd, detalle: detalle ?? null, fin: new Date().toISOString() })
    .eq('corrida_id', corridaId).eq('foto_id', fotoId);
  if (error) throw new Error(`no se pudo cerrar la foto ${fotoId}: ${error.message}`);
}

/** El avance de UNA corrida, en orden. */
export async function leerFotosDeCorrida(db: SupabaseClient, corridaId: string): Promise<Resultado<FotoDeCorrida[]>> {
  const r = await fotosDe(db, [corridaId]);
  if (!r.ok) return r;
  return {
    ok: true,
    datos: r.datos.sort((a, b) => Number(a.n) - Number(b.n)).map(fotoDeCorridaDeFila),
  };
}

/**
 * Las fotos que una pasada ANTERIOR dejó en vuelo pasan a 'interrumpida'.
 *
 * Ni acierto ni fallo: no se sabe si el `processInbound` llegó a correr, y
 * afirmar cualquiera de las dos cosas sería inventar. Tampoco se reintentan —
 * eso costaría otra llamada al modelo por una foto que puede estar ya
 * procesada, y el dedup de producción (`uq_gasto_img_hash`) la rebotaría
 * gastando de todos modos. Se dice, se cuenta aparte, y Javier decide.
 *
 * Devuelve cuántas encontró.
 */
export async function marcarInterrumpidas(
  db: SupabaseClient, corridaId: string, pasadaActual: number,
): Promise<Resultado<number>> {
  try {
    const { data, error } = await db.from('qa_corrida_foto')
      .update({
        estado: 'interrumpida',
        detalle: `una pasada anterior murió con esta foto en vuelo — no se sabe si llegó a procesarse. No se reintenta (costaría otra llamada al modelo por algo que puede estar hecho) y NO se cuenta ni como acierto ni como fallo.`,
        fin: new Date().toISOString(),
      })
      .eq('corrida_id', corridaId).eq('estado', 'corriendo').lt('pasada', pasadaActual)
      .select('foto_id');
    if (error) return { ok: false, error: tabla(error, 'no se pudieron marcar las fotos interrumpidas') };
    return { ok: true, datos: (data ?? []).length };
  } catch (e) {
    return { ok: false, error: `no se pudieron marcar las fotos interrumpidas: ${e instanceof Error ? e.message : String(e)}` };
  }
}
