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
// LO QUE NO CAMBIA, A PROPÓSITO:
//   · Las rutas PÚBLICAS (landing, blog, login, aviso, demo) siguen con
//     `'unsafe-inline'`: son estáticas/prerenderizadas, sus scripts inline no
//     pueden llevar un nonce por petición, y volverlas dinámicas (nonce en el
//     layout raíz) es una decisión de costo y de caché de Javier, no de este
//     paquete. Quedan documentadas como deuda residual en docs/operacion/csp.md.
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
 * La política completa. `nonce` null = política de las rutas públicas (con `'unsafe-inline'`).
 * Cada directiva sale de recorrer qué carga la app de verdad (ver el historial en proxy.ts).
 */
export function construirCsp(nonce: string | null, dev: boolean = process.env.NODE_ENV === 'development'): string {
  // `next dev` (Fast Refresh) parchea módulos con `eval()`: sin `unsafe-eval` la app nunca hidrata.
  // Es exclusivo del bundle de DESARROLLO; en producción nunca aparece.
  const evalDev = dev ? " 'unsafe-eval'" : '';
  const scriptSrc = nonce === null
    ? `script-src 'self' 'unsafe-inline'${evalDev}`
    : `script-src 'self' 'nonce-${nonce}' ${HASH_SCRIPT_TEMA} 'strict-dynamic'${evalDev}`;
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://*.supabase.co",
    // SEG-5 (auditoría 24): el video de marketing y las notas de voz salen de Storage.
    "media-src 'self' https://*.supabase.co",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
