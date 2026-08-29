// ═══════════════════════════════════════════════════════════════════════════
// EL ESTUDIO DE MARKETING (0266, Fase D) — la CAPA VISUAL de `crecimiento.ts`.
//
// Este módulo NO fabrica una sola pieza: eso ya lo hace `agentes/crecimiento.ts`
// (0230), que este archivo NO toca. Lo que da es:
//
//   1. El banco de hooks — subir un video de referencia + anotar su hook.
//   2. Personajes y lugares — subir fotos con nombre/etiqueta.
//   3. Las piezas del día — LEE `cola_aprobacion` (las que produce
//      crecimiento.ts) y las expone listas para pintar en tarjetas. Publicar
//      sigue siendo `aprobarPieza`/`rechazarPieza` de `agentes/cola.ts` — no
//      se reinventa un mecanismo de publicación aquí.
//
// POR QUÉ EL VIDEO SUBE POR URL FIRMADA Y LA FOTO NO: un video de referencia
// pesa fácilmente decenas de MB; sin `experimental.serverActions.bodySizeLimit`
// propio (no lo hay en next.config.ts) y con el techo duro de payload de una
// función de Vercel (~4.5 MB), un Server Action con FormData —el patrón que
// usa `avatar-uploader.tsx`— se cae en cualquier clip real. Por eso el video
// sube DIRECTO al navegador vía `createSignedUploadUrl` (el servidor solo
// firma, nunca ve los bytes) y la foto —del tamaño de un avatar— sigue el
// camino directo de siempre.
//
// TODO(fase posterior, NO decidir aquí): la generación real de imagen/video
// (Higgsfield: nano_banana_2, gpt_image_2, seedance_2_0; o Canva) es un punto
// de extensión EXPLÍCITO. Hay conectores MCP reales disponibles en este
// entorno, pero activarlos implica costo real por generación — eso lo decide
// Javier, no este módulo. Lo que este archivo entrega es la CAPA de insumo
// (banco de hooks, personajes/lugares) y de aprobación (piezas del día); el
// pipeline de render sigue viviendo en el flujo LOCAL de Javier, exactamente
// como `crecimiento.ts` ya lo declara pieza por pieza (SIN_PIPELINE_DE_RENDER).
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { DatoInvalido } from '../errores';
import { firmarRutas } from '@/lib/admin/qa-storage';

export const BUCKET_HOOKS = 'marketing_hooks_video';
export const BUCKET_REFERENCIAS = 'marketing_referencias';

/** Mismo dominio que el `allowed_mime_types` de la 0266 — repetido aquí para
 *  rechazar ANTES de gastar un viaje a Storage, no porque la base no lo
 *  vaya a rechazar también. */
export const MIME_VIDEO_HOOK = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v']);
export const TOPE_VIDEO_BYTES = 200 * 1024 * 1024;
export const MIME_IMAGEN_REFERENCIA = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const TOPE_IMAGEN_BYTES = 4 * 1024 * 1024;

function extDeVideo(mime: string): string {
  if (mime === 'video/quicktime') return 'mov';
  if (mime === 'video/webm') return 'webm';
  if (mime === 'video/x-m4v') return 'm4v';
  return 'mp4';
}

function extDeImagen(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

// ── 1. El banco de hooks ────────────────────────────────────────────────────

export interface UrlFirmadaSubida {
  bucket: string;
  path: string;
  token: string;
  signedUrl: string;
}

/** Firma la subida de UN video de referencia. El servidor jamás ve los bytes:
 *  solo autoriza la ruta con service_role y el navegador sube directo a
 *  Storage con ese token (ver el porqué al inicio del archivo). */
export async function pedirUrlFirmadaHook(mime: string): Promise<UrlFirmadaSubida> {
  if (!MIME_VIDEO_HOOK.has(mime)) {
    throw new DatoInvalido(`Ese tipo de archivo (${mime || 'desconocido'}) no es un video aceptado — manda mp4, mov o webm.`);
  }
  const path = `${crypto.randomUUID()}.${extDeVideo(mime)}`;
  const { data, error } = await supabaseAdmin().storage.from(BUCKET_HOOKS).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`pedirUrlFirmadaHook: ${error?.message ?? 'Storage no devolvió la URL firmada'}`);
  return { bucket: BUCKET_HOOKS, path: data.path, token: data.token, signedUrl: data.signedUrl };
}

/** Guarda el hook YA subido — `videoRuta` es la ruta que devolvió la subida
 *  directa, nunca algo que este código adivine. */
export async function guardarHook(input: { videoRuta: string; hookTexto: string; actorId: string | null }): Promise<string> {
  const ruta = input.videoRuta.trim();
  const texto = input.hookTexto.trim();
  if (!ruta) throw new DatoInvalido('Falta la ruta del video — sube el video antes de guardar el hook.');
  if (!texto) throw new DatoInvalido('Anota qué hook usa el video: sin esa anotación, el banco es solo una carpeta de videos.');
  const { data, error } = await acotada(supabaseAdmin().from('marketing_hook').insert({
    video_ruta: ruta, hook_texto: texto.slice(0, 4000), creado_por: input.actorId,
  }).select('id').single(), 'estudio.guardar_hook');
  if (error) throw new Error(`guardarHook: ${error.message}`);
  const id = (data as { id?: unknown } | null)?.id;
  if (!id) throw new Error('guardarHook: el insert no devolvió id');
  return id as string;
}

export interface HookGuardado {
  id: string;
  hookTexto: string;
  /** `null` = no se pudo firmar la lectura (el objeto no existe o Storage no
   *  contestó) — NO significa que el hook no exista. */
  videoUrl: string | null;
  creadoEn: string;
}

/** El banco de hooks, más reciente primero. LANZA si la TABLA no se pudo
 *  leer (fail closed sobre el índice); si lo que falla es SOLO la firma de
 *  un video, esa fila queda con `videoUrl: null` y las demás se pintan —
 *  un video sin preview no es motivo para esconder el banco entero. */
export async function listarHooks(limite = 50): Promise<HookGuardado[]> {
  const { data, error } = await acotada(supabaseAdmin().from('marketing_hook')
    .select('id, video_ruta, hook_texto, creado_en')
    .order('creado_en', { ascending: false })
    .order('id')
    .limit(limite), 'estudio.listar_hooks');
  if (error) throw new Error(`listarHooks: ${error.message}`);
  const filas = (data ?? []) as Array<Record<string, unknown>>;
  if (filas.length === 0) return [];
  const firmas = await firmarRutas(supabaseAdmin(), BUCKET_HOOKS, filas.map((f) => String(f.video_ruta)));
  return filas.map((f) => ({
    id: String(f.id),
    hookTexto: String(f.hook_texto),
    videoUrl: firmas.get(String(f.video_ruta)) ?? null,
    creadoEn: String(f.creado_en),
  }));
}

// ── 2. Personajes y lugares ─────────────────────────────────────────────────

export type TipoReferencia = 'personaje' | 'lugar';

export function esTipoReferencia(v: string): v is TipoReferencia {
  return v === 'personaje' || v === 'lugar';
}

/** Firma la subida de UNA foto de personaje/lugar — a diferencia del hook,
 *  esta va por el camino directo (FormData a través de un Server Action,
 *  como `avatares`): el tamaño cabe cómodo bajo el límite de payload. Esta
 *  función solo VALIDA tipo/peso antes de tocar Storage; quien la llama
 *  (el Server Action de la página) ya tiene el `File` en la mano. */
export function validarFotoReferencia(mime: string, bytes: number): void {
  if (!MIME_IMAGEN_REFERENCIA.has(mime)) {
    throw new DatoInvalido(`Ese tipo de imagen (${mime || 'desconocido'}) no se acepta — manda jpg, png o webp.`);
  }
  if (bytes > TOPE_IMAGEN_BYTES) {
    throw new DatoInvalido(`La foto pesa más de ${Math.round(TOPE_IMAGEN_BYTES / (1024 * 1024))} MB — comprímela e intenta de nuevo.`);
  }
}

/** Sube la foto YA validada y devuelve la ruta dentro del bucket privado. */
export async function subirFotoReferencia(archivo: File, mime: string): Promise<string> {
  const path = `${crypto.randomUUID()}.${extDeImagen(mime)}`;
  const { error } = await supabaseAdmin().storage.from(BUCKET_REFERENCIAS)
    .upload(path, archivo, { contentType: mime, upsert: false });
  if (error) throw new Error(`subirFotoReferencia: ${error.message}`);
  return path;
}

export async function guardarReferencia(input: {
  tipo: TipoReferencia; nombre: string; etiqueta: string | null; fotoRuta: string; actorId: string | null;
}): Promise<string> {
  const nombre = input.nombre.trim();
  if (!nombre) throw new DatoInvalido('El nombre es obligatorio — sin él, la referencia no se puede pedir por nombre en un guion.');
  const { data, error } = await acotada(supabaseAdmin().from('marketing_referencia').insert({
    tipo: input.tipo, nombre: nombre.slice(0, 200),
    etiqueta: input.etiqueta?.trim() ? input.etiqueta.trim().slice(0, 500) : null,
    foto_ruta: input.fotoRuta, creado_por: input.actorId,
  }).select('id').single(), 'estudio.guardar_referencia');
  if (error) throw new Error(`guardarReferencia: ${error.message}`);
  const id = (data as { id?: unknown } | null)?.id;
  if (!id) throw new Error('guardarReferencia: el insert no devolvió id');
  return id as string;
}

export interface ReferenciaGuardada {
  id: string;
  tipo: TipoReferencia;
  nombre: string;
  etiqueta: string | null;
  /** `null` = no se pudo firmar la lectura — no significa que no exista. */
  fotoUrl: string | null;
  creadoEn: string;
}

export async function listarReferencias(limite = 100): Promise<ReferenciaGuardada[]> {
  const { data, error } = await acotada(supabaseAdmin().from('marketing_referencia')
    .select('id, tipo, nombre, etiqueta, foto_ruta, creado_en')
    .order('creado_en', { ascending: false })
    .order('id')
    .limit(limite), 'estudio.listar_referencias');
  if (error) throw new Error(`listarReferencias: ${error.message}`);
  const filas = (data ?? []) as Array<Record<string, unknown>>;
  if (filas.length === 0) return [];
  const firmas = await firmarRutas(supabaseAdmin(), BUCKET_REFERENCIAS, filas.map((f) => String(f.foto_ruta)));
  return filas.map((f) => ({
    id: String(f.id),
    tipo: (f.tipo as TipoReferencia),
    nombre: String(f.nombre),
    etiqueta: (f.etiqueta as string | null) ?? null,
    fotoUrl: firmas.get(String(f.foto_ruta)) ?? null,
    creadoEn: String(f.creado_en),
  }));
}

// ── 3. Las piezas del día — LECTURA de lo que crecimiento.ts YA produce ─────
//
// `AGENTES_ESTUDIO`, `PiezaEstudio`, `desdeFilaEstudio` y `partirCopyPorCanal`
// viven en `./piezas` (SIN imports de servidor) y se re-exportan aquí: la
// tarjeta de pieza ('use client') los importa DIRECTO de `./piezas` para no
// arrastrar `supabaseAdmin` (y con él Node builtins como `node:crypto`) al
// bundle del navegador — ver la cabecera de ese archivo.

export { AGENTES_ESTUDIO, partirCopyPorCanal, type PiezaEstudio, type BloqueCanal } from './piezas';
import { AGENTES_ESTUDIO, desdeFilaEstudio, type PiezaEstudio } from './piezas';

/** Las piezas de contenido PENDIENTES de aprobación — las que de verdad
 *  esperan el tap de Javier. LANZA ante error de lectura: una lista vacía
 *  por base caída diría "no hay nada que publicar hoy", que es la mentira
 *  tranquilizadora que esta casa no se permite. */
export async function piezasEstudioPendientes(limite = 30): Promise<PiezaEstudio[]> {
  // `.is('tenant_id', null)`: las diez de crecimiento.ts SIEMPRE encolan con
  // tenant NULL (un guion o un encargo no son de ninguna flota — el mismo
  // hecho que exenta a crecimiento.ts en consultas_admin_filtran_tenant.
  // test.ts). Se filtra explícito de todas formas: es el cinturón que impide
  // que una pieza de flota se cuele algún día en este estudio, que es de
  // Likida. `.order('id')` al final desempata `creado_en` — sin él, un
  // `.limit()` con empates no devuelve "las N más viejas", devuelve N
  // cualesquiera.
  const { data, error } = await acotada(supabaseAdmin().from('cola_aprobacion')
    .select('id, tipo, agente, titulo, cuerpo, fuentes, creado_en')
    .in('agente', AGENTES_ESTUDIO)
    .eq('estado', 'pendiente')
    .is('tenant_id', null)
    .order('creado_en', { ascending: true })
    .order('id')
    .limit(limite), 'estudio.piezas_pendientes');
  if (error) throw new Error(`piezasEstudioPendientes: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map(desdeFilaEstudio);
}

/** Las últimas piezas de contenido YA aprobadas — el "ya salió" de la
 *  pantalla, para que Javier vea qué tap ya dio sin ir a Aprobaciones. */
export async function piezasEstudioAprobadasRecientes(limite = 10): Promise<PiezaEstudio[]> {
  const { data, error } = await acotada(supabaseAdmin().from('cola_aprobacion')
    .select('id, tipo, agente, titulo, cuerpo, fuentes, creado_en')
    .in('agente', AGENTES_ESTUDIO)
    .eq('estado', 'aprobado')
    .is('tenant_id', null)
    .order('resuelto_en', { ascending: false })
    .order('id')
    .limit(limite), 'estudio.piezas_aprobadas');
  if (error) throw new Error(`piezasEstudioAprobadasRecientes: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map(desdeFilaEstudio);
}
