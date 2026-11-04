import { createHash } from 'node:crypto';
import { SCRIPT_TEMA } from './script_tema';

// ═══════════════════════════════════════════════════════════════════════════
// CSP CON NONCE (Ola 9, seguridad; auditoría ola 1 #5).
//
// Hasta aquí `script-src` llevaba `'unsafe-inline'` porque "no hay infraestructura
// de nonce en este repo". Con `'unsafe-inline'` la CSP no frena un XSS: cualquier
// `<script>` inyectado corre. Ahora las rutas con sesión (/dashboard, /admin,
// /vendedor: las que tocan dinero y datos de la flota) llevan una política con
// nonce por petición + `'strict-dynamic'`:
//
//   · Next lee el nonce del header CSP de la PETICIÓN y lo pone en sus propios
//     `<script>` (bootstrap, streaming `self.__next_f.push`, chunks).
//   · El único `<script>` inline propio del repo —el tema, en el layout raíz— va
//     por HASH SHA-256 de su contenido (no necesita nonce, así el layout raíz no
//     tiene que leer headers y no vuelve dinámicas las páginas públicas).
//   · Esas rutas ya son dinámicas (leen la cookie de sesión y los tres layouts
//     exportan `force-dynamic`), requisito de Next para poder poner un nonce.
//
// OLA 9b (decisión de Javier, 2-oct-2026): el nonce se aplica TAMBIÉN a las rutas públicas.
//   El layout raíz llama `connection()`, así que todo el sitio es dinámico (sin caché de CDN).
//   `'unsafe-inline'` en scripts solo sobrevive con `LIKIDA_CSP_NONCE=0` (palanca de reversa).
//
// LO QUE NO CAMBIA, A PROPÓSITO:
//   · `style-src 'unsafe-inline'`: ~1,200 `style={{…}}` (atributo, no `<style>`);
//     ni nonce ni hash los cubren.
//
// Palanca de reversa sin tocar código: `LIKIDA_CSP_NONCE=0` devuelve TODAS las
// rutas a la política anterior (requiere redeploy: es una variable de entorno).
// ═══════════════════════════════════════════════════════════════════════════

/** Hash CSP (`sha256-<base64>`) del script inline del tema. Sale del MISMO string que el layout inyecta. */
export const HASH_SCRIPT_TEMA = `'sha256-${createHash('sha256').update(SCRIPT_TEMA, 'utf8').digest('base64')}'`;

/** 16 bytes aleatorios en base64: un nonce nuevo por petición, jamás reutilizado. */
export function nuevoNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** ¿Está activo el nonce? Todo menos `LIKIDA_CSP_NONCE=0` (la palanca de reversa). */
export function nonceActivo(env: Record<string, string | undefined> = process.env): boolean {
  return env.LIKIDA_CSP_NONCE !== '0';
}

/**
 * CT-SEG-18 · El origen del proyecto de Supabase (`NEXT_PUBLIC_SUPABASE_URL`) para acotar img-src/media-src/connect-src.
 *
 * QUÉ NECESITA EL NAVEGADOR DE SUPABASE (recorrido del código, no plantilla):
 *   · img-src / media-src: avatares, fotos de comprobante, video de marketing y notas de voz = URLs de Storage
 *     (`https://<ref>.supabase.co/storage/v1/object/...`).
 *   · connect-src: la SUBIDA DIRECTA a Storage (`lib/supabase/browser-storage.ts`, `uploadToSignedUrl`): un fetch del navegador
 *     a `https://<ref>.supabase.co/storage/v1/object/upload/sign/...`. Con `connect-src 'self'` esa subida muere.
 *   · NO se necesita Realtime (`wss://<ref>.supabase.co`): no hay `.channel(` ni suscripciones en el navegador, y las tablas
 *     y Auth solo se tocan desde el servidor. Si algún día se usa Realtime hay que agregar `wss://` del MISMO host aquí.
 *
 * Si la variable falta o no es un origen válido se cae al comodín `https://*.supabase.co` (la política de antes): perder la
 * restricción es mejor que romper imágenes y subidas en producción. `http:` solo se acepta para localhost (Supabase local).
 */
export function origenSupabase(env: Record<string, string | undefined> = process.env): string | null {
  const crudo = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!crudo) return null;
  try {
    const u = new URL(crudo);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) return u.origin;
  } catch { /* URL inválida: cae al comodín */ }
  return null;
}

/**
 * La política completa. `nonce` null = política de reversa (`LIKIDA_CSP_NONCE=0`, con `'unsafe-inline'`).
 * Cada directiva sale de recorrer qué carga la app de verdad (ver el historial en proxy.ts).
 */
export function construirCsp(
  nonce: string | null,
  dev: boolean = process.env.NODE_ENV === 'development',
  env: Record<string, string | undefined> = process.env,
): string {
  const supabase = origenSupabase(env) ?? 'https://*.supabase.co';
  // `next dev` (Fast Refresh) parchea módulos con `eval()`: sin `unsafe-eval` la app nunca hidrata.
  // Es exclusivo del bundle de DESARROLLO; en producción nunca aparece.
  const evalDev = dev ? " 'unsafe-eval'" : '';
  // S-03: Cloudflare Turnstile. Solo con TURNSTILE_ACTIVO='1' (apagado = la politica de siempre, caracter por caracter).
  // El widget carga api.js (script-src; con nonce + 'strict-dynamic' el host se ignora pero va para navegadores sin
  // strict-dynamic), se dibuja en un iframe de challenges.cloudflare.com (frame-src) y habla con el mismo origen (connect-src).
  const ts = env.TURNSTILE_ACTIVO === '1' ? ' https://challenges.cloudflare.com' : '';
  const scriptSrc = nonce === null
    ? `script-src 'self' 'unsafe-inline'${ts}${evalDev}`
    : `script-src 'self' 'nonce-${nonce}' ${HASH_SCRIPT_TEMA} 'strict-dynamic'${ts}${evalDev}`;
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    // Solo los orígenes que el código usa de verdad: Storage (avatares y fotos), los tiles de OpenStreetMap del mapa de prospectos
    // (`admin/mapa-prospectos/calles.tsx`) y `blob:` para la vista previa local del avatar (`URL.createObjectURL`, ronda 15).
    `img-src 'self' data: blob: ${supabase} https://tile.openstreetmap.org`,
    // SEG-5 (auditoría 24): el video de marketing y las notas de voz salen de Storage.
    `media-src 'self' ${supabase}`,
    "font-src 'self' data:",
    // Storage directo: la subida firmada va del navegador al proyecto (ver `origenSupabase`).
    `connect-src 'self' ${supabase}${ts}`,
    ts ? `frame-src${ts}` : "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
