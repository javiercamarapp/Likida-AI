import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Cabeceras de seguridad + gate de sesión del dashboard. El matcher EXCLUYE
// /api (webhook, demo, export manejan lo suyo y no deben pasar por el gate ni
// cargar cabeceras de página).
//
// El gate ya NO es un passcode compartido: usa la sesión real de Supabase
// Auth. `createServerClient` aquí, con las cookies de request/response, es el
// patrón oficial para refrescar el token de sesión en middleware — sin esto,
// una sesión cuyo access token expiró a mitad de vida se vería como "sin
// sesión" hasta el siguiente refresh del lado del navegador.
//
// Esta es la PRIMERA capa (barata, por matcher de ruta). La segunda vive en
// cada página vía `requireSessionTenant` (src/lib/auth/guard.ts): las dos
// tienen que fallar a la vez para que el panel se sirva sin autorización.
//
// LAS CABECERAS SE APLICAN AL FINAL, EN UN SOLO LUGAR. `setAll` reasigna
// `res` a una respuesta NUEVA cada vez que Supabase refresca el token de
// sesión (pasa a media vida, no solo al expirar) — si las cabeceras se
// hubieran puesto antes de ese punto, un refresh de sesión las tiraba en
// silencio en cualquier respuesta autenticada. Y el redirect a /login es
// OTRO objeto de respuesta aparte de `res`: sin este helper aplicado también
// ahí, la página de login nunca llevaba cabeceras de seguridad tampoco.
/**
 * CSP — reincidente desde al menos la auditoría 8 (nunca se había escrito).
 * No es una plantilla genérica: cada directiva sale de recorrer qué carga
 * esta app de verdad (`command grep` de `fetch(`, `<img`, `<script`,
 * `<iframe>`, `createBrowserClient`, `next/font` — auditoría 10):
 *
 * - `script-src 'unsafe-inline'`: el App Router de Next inyecta scripts
 *   inline para revelar streaming/Suspense (`self.__next_f.push(...)`).
 *   No hay infraestructura de nonce en este repo (ni un solo `next/script`
 *   ni un `<script>` propio en `src/app`), así que exigir nonce hoy
 *   rompería CADA página — se documenta como deuda, no como descuido.
 * - `style-src 'unsafe-inline'`: **1,178** `style={{...}}` en 125 archivos
 *   (`command grep -rc "style={{" src --include="*.tsx"`), el mecanismo con
 *   el que este repo aplica `var(--muted)` y el resto del sistema de
 *   diseño. Es un atributo `style=""`, no un `<style>` — ni nonce ni hash
 *   lo cubren (son dinámicos, calculados en cada render), así que sin
 *   `unsafe-inline` la mitad del panel se pinta sin color.
 * - `img-src https://*.supabase.co`: los avatares y las fotos de
 *   comprobante son URLs firmadas/públicas de Storage
 *   (`chofer.ts:424`, `admin/mi-perfil/page.tsx:52`) — el navegador las
 *   pide directo, sin pasar por `/api`.
 * - `connect-src 'self'` y nada más: los dos `fetch(` que existen en
 *   componentes cliente (`dashboard/rail.tsx`, `demo/page.tsx`) son a rutas
 *   propias. Sentry vive SOLO en `SENTRY_DSN` (server, sin
 *   `NEXT_PUBLIC_SENTRY_DSN` ni `instrumentation-client.ts`) — el navegador
 *   nunca le habla. WhatsApp (Graph API) es server-only. Stripe se navega
 *   por `redirect()` de un server action (top-level, no XHR) — no hay
 *   Stripe.js ni Elements embebidos.
 * - `frame-src 'none'`: cero `<iframe>` en el repo.
 * - `frame-ancestors 'none'`: mismo candado que `X-Frame-Options: DENY`,
 *   pero por CSP — cinturón y tirantes, como el resto de este archivo.
 *
 * Verificado, no supuesto: `docs/auditoria-10/seguridad.md`.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.supabase.co",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function withSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.headers.set('Content-Security-Policy', CSP);
  if (process.env.NODE_ENV === 'production') {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000');
  }
  return res;
}

/**
 * Los prefijos que exigen sesión. Se compara con `startsWith` y no por
 * segmento exacto a propósito: sobrar en este gate solo cuesta un login de
 * más, faltar sirve una pantalla del panel a quien no inició sesión.
 *
 * Se exporta para que `proxy.test.ts` pueda comprobar que TODA sección con
 * `requireOperador`/`requireSessionTenant` está nombrada aquí — /chofer nació
 * sin estar en esta lista y el único aviso fue un comentario en su layout.
 */
export const RUTAS_CON_SESION = ['/dashboard', '/mis-viajes', '/chofer', '/admin'] as const;

export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const path = req.nextUrl.pathname;

  // /chofer es el panel móvil del chofer, /mis-viajes su antecesor de solo
  // lectura, y /admin la consola de negocio de Javier (requireOperador /
  // requireSuperadmin, guard.ts): mismo gate de sesión que /dashboard, la
  // distinción de ROL vive en la página, no aquí — esta capa solo pregunta
  // "¿hay sesión?".
  //
  // /chofer FALTABA. Su layout ya llama a `requireOperador()`, pero eso lo
  // dejaba con UNA sola capa: la promesa de este archivo es que las dos
  // tengan que fallar a la vez. Y es la capa que ve la URL COMPLETA, así que
  // es la única que puede devolver al chofer exactamente a la pantalla del
  // enlace de WhatsApp que abrió, query string incluido.
  if (RUTAS_CON_SESION.some((p) => path.startsWith(p))) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => req.cookies.getAll(),
          setAll: (list) => {
            list.forEach(({ name, value }) => req.cookies.set(name, value));
            res = NextResponse.next({ request: req });
            list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
          },
        },
      },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('next', path);
      // Las cookies que `setAll` escribió en `res` viajan TAMBIÉN en el
      // redirect. Cuando `getUser()` encuentra un refresh token muerto, el SDK
      // pide borrar la cookie por esa vía — y este camino devolvía otra
      // respuesta, así que la instrucción de borrado se perdía: el navegador
      // seguía mandando la cookie muerta y cada petición pagaba un refresh
      // fallido antes de acabar, otra vez, en este mismo redirect.
      const redirectRes = NextResponse.redirect(url);
      res.cookies.getAll().forEach((c) => redirectRes.cookies.set(c));
      return withSecurityHeaders(redirectRes);
    }
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  }

  return withSecurityHeaders(res);
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
