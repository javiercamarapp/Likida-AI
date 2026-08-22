// ═══════════════════════════════════════════════════════════════════════════
// PANEL DE QA — la capa de almacenamiento de Fase A. SOLO servidor.
//
// Dos buckets PRIVADOS, mismo criterio de privacidad que
// supabase/migrations/0039_bucket_comprobantes.sql: un ticket real trae RFC,
// domicilio y a veces nombre del titular (art. 2 fr. VI LFPDPPP) — nada de
// buckets públicos ni <img src> sin firmar. Sin policies: RLS de storage
// deniega a anon/authenticated por defecto y solo el service-role toca.
//
// POR QUÉ SE CREAN AQUÍ Y NO EN UNA MIGRACIÓN: las migraciones están
// congeladas (ver qa-tipos.ts, cabecera). Crear un bucket es operación de
// datos (storage.buckets vía API), no DDL — cuando la migración de Fase B
// llegue, su `insert ... on conflict do nothing` encontrará el bucket ya
// creado y no chocará (mismo patrón idempotente que 0039).
//
// El "ledger en vivo" (corridas/<id>/corrida.json) sustituye a las tablas
// qa_corrida/qa_corrida_paso SOLO en Fase A: un archivo por corrida, un solo
// escritor (la invocación que ejecuta el motor), N lectores (el polling del
// panel) — sin índice compartido a propósito, para no inventar un
// read-modify-write con carrera; el historial se arma LISTANDO la carpeta.
// ═══════════════════════════════════════════════════════════════════════════

import { hoyMx } from '@/lib/formato';
import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CorridaQA, FotoBanco } from './qa-tipos';

export const BUCKET_QA_FOTOS = 'qa-fotos';
export const BUCKET_QA_EVIDENCIA = 'qa-evidencia';
const RUTA_MANIFIESTO = 'banco/manifiesto.json';

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

/** Dedup puro contra el manifiesto: la foto ya existente con ese hash, o null. */
export function duplicadaPorHash(fotos: FotoBanco[], hash: string): FotoBanco | null {
  return fotos.find((f) => f.hash === hash) ?? null;
}

export function extensionDe(mime: string): string | null {
  return MIMES_PERMITIDOS[mime] ?? null;
}

// ── Buckets ─────────────────────────────────────────────────────────────────

let bucketsListos = false;

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

// ── El banco de fotos (manifiesto) ──────────────────────────────────────────

type Resultado<T> = { ok: true; datos: T } | { ok: false; error: string };

function esNoEncontrado(mensaje: string): boolean {
  return /not.?found|does not exist/i.test(mensaje);
}

/** Lee el manifiesto del banco. Banco sin estrenar (objeto inexistente) = 0
 *  fotos DE VERDAD; cualquier otro fallo se dice — nunca "0" sobre una base
 *  que no se pudo leer (regla de la casa: fallar cerrado y decirlo). */
export async function leerManifiesto(db: SupabaseClient): Promise<Resultado<FotoBanco[]>> {
  try {
    await asegurarBuckets(db);
    const { data, error } = await db.storage.from(BUCKET_QA_FOTOS).download(RUTA_MANIFIESTO);
    if (error) {
      if (esNoEncontrado(error.message)) return { ok: true, datos: [] };
      return { ok: false, error: `no se pudo leer el manifiesto: ${error.message}` };
    }
    const crudo = JSON.parse(await data.text()) as { fotos?: FotoBanco[] };
    return { ok: true, datos: Array.isArray(crudo.fotos) ? crudo.fotos : [] };
  } catch (e) {
    return { ok: false, error: `no se pudo leer el manifiesto: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function guardarManifiesto(db: SupabaseClient, fotos: FotoBanco[]): Promise<void> {
  const cuerpo = Buffer.from(JSON.stringify({ version: 1, fotos }, null, 2));
  const { error } = await db.storage.from(BUCKET_QA_FOTOS)
    .upload(RUTA_MANIFIESTO, cuerpo, { contentType: 'application/json', upsert: true });
  if (error) throw new Error(`no se pudo guardar el manifiesto: ${error.message}`);
}

export interface ArchivoNuevo { nombre: string; mime: string; bytes: Buffer }
export interface ResultadoSubida {
  nombre: string;
  /** id en el banco (nuevo o el del duplicado reusado). */
  id: string | null;
  duplicadoDe: string | null;   // etiqueta de la foto ya existente, si dedup
  error: string | null;
}

/** Sube N archivos de golpe ("cantidad obscena" bienvenida): dedup por hash
 *  contra el manifiesto, un solo write del manifiesto al final. Cada archivo
 *  reporta su suerte por separado — un HEIC rechazado no tira el lote. */
export async function subirFotos(
  db: SupabaseClient, archivos: ArchivoNuevo[],
): Promise<Resultado<{ resultados: ResultadoSubida[]; fotos: FotoBanco[] }>> {
  const manifiesto = await leerManifiesto(db);
  if (!manifiesto.ok) return manifiesto;
  const fotos = [...manifiesto.datos];
  const resultados: ResultadoSubida[] = [];
  let hayNuevas = false;

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
    const dup = duplicadaPorHash(fotos, hash);
    if (dup) {
      resultados.push({ nombre: a.nombre, id: dup.id, duplicadoDe: dup.etiqueta, error: null });
      continue;
    }
    const id = randomUUID();
    const path = `banco/${id}.${ext}`;
    const { error } = await db.storage.from(BUCKET_QA_FOTOS)
      .upload(path, a.bytes, { contentType: a.mime, upsert: false });
    if (error) {
      resultados.push({ nombre: a.nombre, id: null, duplicadoDe: null, error: `no se pudo subir: ${error.message}` });
      continue;
    }
    fotos.push({
      id, hash, path, mime: a.mime,
      etiqueta: a.nombre.slice(0, 120),
      bytes: a.bytes.length,
      subidoEn: new Date().toISOString(),
      ocrEsperado: null,
    });
    hayNuevas = true;
    resultados.push({ nombre: a.nombre, id, duplicadoDe: null, error: null });
  }

  if (hayNuevas) {
    try {
      await guardarManifiesto(db, fotos);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { ok: true, datos: { resultados, fotos } };
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

const rutaCorrida = (id: string) => `corridas/${id}/corrida.json`;

export async function guardarCorrida(db: SupabaseClient, corrida: CorridaQA): Promise<void> {
  await asegurarBuckets(db);
  corrida.latidoEn = new Date().toISOString();
  const cuerpo = Buffer.from(JSON.stringify(corrida, null, 2));
  const { error } = await db.storage.from(BUCKET_QA_EVIDENCIA)
    .upload(rutaCorrida(corrida.id), cuerpo, { contentType: 'application/json', upsert: true });
  if (error) throw new Error(`no se pudo guardar la corrida ${corrida.id}: ${error.message}`);
}

export async function leerCorrida(db: SupabaseClient, id: string): Promise<Resultado<CorridaQA | null>> {
  try {
    await asegurarBuckets(db);
    const { data, error } = await db.storage.from(BUCKET_QA_EVIDENCIA).download(rutaCorrida(id));
    if (error) {
      if (esNoEncontrado(error.message)) return { ok: true, datos: null };
      return { ok: false, error: `no se pudo leer la corrida: ${error.message}` };
    }
    return { ok: true, datos: JSON.parse(await data.text()) as CorridaQA };
  } catch (e) {
    return { ok: false, error: `no se pudo leer la corrida: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** El historial: lista las carpetas de corridas y abre cada corrida.json.
 *  Más nuevas primero. `limite` acota las descargas, no la lista. */
export async function listarCorridas(db: SupabaseClient, limite = 60): Promise<Resultado<CorridaQA[]>> {
  try {
    await asegurarBuckets(db);
    const { data, error } = await db.storage.from(BUCKET_QA_EVIDENCIA).list('corridas', { limit: 500 });
    if (error) return { ok: false, error: `no se pudo listar corridas: ${error.message}` };
    const carpetas = (data ?? []).filter((e) => !e.id).map((e) => e.name); // sin id = carpeta
    const corridas: CorridaQA[] = [];
    for (const nombre of carpetas) {
      const r = await leerCorrida(db, nombre);
      if (!r.ok) return { ok: false, error: r.error };
      if (r.datos) corridas.push(r.datos);
      if (corridas.length >= limite * 2) break; // techo de descargas
    }
    corridas.sort((a, b) => b.creadaEn.localeCompare(a.creadaEn));
    return { ok: true, datos: corridas.slice(0, limite) };
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
 *  cada una a su vez leída de llm_costo — nunca una estimación). */
export async function gastoHoyUsd(db: SupabaseClient): Promise<Resultado<number>> {
  const r = await listarCorridas(db, 200);
  if (!r.ok) return r;
  const ahora = new Date().toISOString();
  const total = r.datos
    .filter((c) => mismoDiaMx(c.creadaEn, ahora))
    .reduce((s, c) => s + (Number.isFinite(c.costoUsdTotal) ? c.costoUsdTotal : 0), 0);
  return { ok: true, datos: Math.round(total * 10_000) / 10_000 };
}
