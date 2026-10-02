import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { COOKIES_DE_SESION } from '@/lib/supabase/cookies';
import { construirCsp, nonceActivo, nuevoNonce } from '@/lib/seguridad/csp';

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
 * - `script-src`: el App Router de Next inyecta scripts inline para revelar
 *   streaming/Suspense (`self.__next_f.push(...)`). OLA 9: las rutas con sesión
 *   llevan nonce por petición + `'strict-dynamic'` (y el hash del único script
 *   inline propio, el del tema); las públicas, que son estáticas, conservan
 *   `'unsafe-inline'`. La política vive en `lib/seguridad/csp.ts`; el porqué y
 *   la deuda residual, en `docs/operacion/csp.md`.
 * - `style-src 'unsafe-inline'`: **1,178** `style={{...}}` en 125 archivos
 *   (`command grep -rc "style={{" src --include="*.tsx"`), el mecanismo con
 *   el que este repo aplica `var(--muted)` y el resto del sistema de
 *   diseño. Es un atributo `style=""`, no un `<style>` — ni nonce ni hash
 *   lo cubren (son dinámicos, calculados en cada render), así que sin
 *   `unsafe-inline` la mitad del panel se pinta sin color.
 * - `img-src https://*.supabase.co`: los avatares y las fotos de
 *   comprobante son URLs firmadas/públicas de Storage
 *   (`admin/mi-perfil/page.tsx:52`) — el navegador las pide directo, sin
 *   pasar por `/api`.
 * - `connect-src 'self'` y nada más: los `fetch(` que existen en código de
 *   cliente (`dashboard/rail.tsx`, `demo/page.tsx`, y `logger.ts` reportando
 *   un fallo de cliente a `/api/client-error` — auditoría 25) son TODOS a
 *   rutas propias. Sentry vive SOLO en `SENTRY_DSN` (server, sin
 *   `NEXT_PUBLIC_SENTRY_DSN` ni `instrumentation-client.ts`) — el navegador
 *   nunca le habla directo; lo que sale de un fallo de cliente pasa primero
 *   por `/api/client-error`, que sí corre en servidor. WhatsApp (Graph API)
 *   es server-only. Stripe se navega por `redirect()` de un server action
 *   (top-level, no XHR) — no hay Stripe.js ni Elements embebidos.
 * - `frame-src 'none'`: cero `<iframe>` en el repo.
 * - `frame-ancestors 'none'`: mismo candado que `X-Frame-Options: DENY`,
 *   pero por CSP — cinturón y tirantes, como el resto de este archivo.
 *
 * Verificado, no supuesto: `docs/auditoria-10/seguridad.md`.
 */


/** Un año, subdominios incluidos, apta para precarga. Exportada para la prueba y para `next.config.ts`. */
export const HSTS = 'max-age=31536000; includeSubDomains; preload';

function withSecurityHeaders(res: NextResponse, csp: string): NextResponse {
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.headers.set('Content-Security-Policy', csp);
  if (process.env.NODE_ENV === 'production') {
    // SEG-5 (auditoría 24): `includeSubDomains` cierra el primer `http://` a
    // cualquier subdominio bajo el de la app; `preload` declara la intención
    // de entrar a la lista de precarga de los navegadores (un año + subdominios
    // son sus requisitos). Mismo valor en `next.config.ts` para `/api/*`.
    res.headers.set('Strict-Transport-Security', HSTS);
  }
  return res;
}

/**
 * Los prefijos que exigen sesión. Se compara con `startsWith` y no por
 * segmento exacto a propósito: sobrar en este gate solo cuesta un login de
 * más, faltar sirve una pantalla del panel a quien no inició sesión.
 *
 * Se exporta para que `proxy.test.ts` pueda comprobar que TODA sección con
 * `requireSessionTenant`/`requireSuperadmin` está nombrada aquí.
 *
 * `/chofer` y `/mis-viajes` salieron el 7-ago-2026: el chofer ya no tiene
 * cuenta ni panel propio, solo WhatsApp — ver `visibilidad.ts` y `guard.ts`
 * (`requireOperador` retirada). `/vendedor` entró el 14-ago-2026 (0105): el
 * panel del rol `vendedor`, gateado en su layout por `requireVendedor`.
 */
export const RUTAS_CON_SESION = ['/dashboard', '/admin', '/vendedor'] as const;

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // CSP con nonce (Ola 9) SOLO en las rutas con sesión: son dinámicas (leen la cookie) y por eso Next
  // puede poner un nonce por petición en sus scripts. El nonce y la política viajan en la PETICIÓN
  // (Next lee el nonce de ahí) y en la respuesta (la que obedece el navegador). Las públicas, estáticas,
  // conservan `'unsafe-inline'`: ver lib/seguridad/csp.ts y docs/operacion/csp.md.
  const conSesion = RUTAS_CON_SESION.some((p) => path.startsWith(p));
  const nonce = conSesion && nonceActivo() ? nuevoNonce() : null;
  const csp = construirCsp(nonce);
  // Patrón documentado de Next: los headers de la petición se copian a un `Headers` nuevo (no se muta la
  // petición) y se pasan en `request.headers`. Se vuelve a llamar tras cada `req.cookies.set` del refresco
  // de sesión, para que la copia lleve la cookie nueva Y la política (si no, el refresh tiraba el nonce).
  const siguiente = () => {
    const h = new Headers(req.headers);
    if (nonce !== null) {
      h.set('content-security-policy', csp);
      h.set('x-nonce', nonce);
    }
    return NextResponse.next({ request: { headers: h } });
  };
  let res = siguiente();

  // /admin es la consola de negocio de Javier (requireSuperadmin, guard.ts):
  // mismo gate de sesión que /dashboard, la distinción de ROL vive en la
  // página, no aquí — esta capa solo pregunta "¿hay sesión?".
  if (conSesion) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        // El token de sesión no lo lee ningún JavaScript de esta app —no hay
        // `createBrowserClient` ni un solo `document.cookie`—, así que no
        // tiene por qué ser legible desde el navegador (SEG-3). Ver
        // `lib/supabase/cookies.ts`.
        cookieOptions: COOKIES_DE_SESION,
        cookies: {
          getAll: () => req.cookies.getAll(),
          setAll: (list) => {
            list.forEach(({ name, value }) => req.cookies.set(name, value));
            res = siguiente();
            // El `httpOnly` se repite sobre `options` a propósito: es la
            // cookie que sale de verdad hacia el navegador, y no puede
            // depender de que el SDK propague la opción global.
            list.forEach(({ name, value, options }) => res.cookies.set(name, value, { ...options, ...COOKIES_DE_SESION }));
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
      return withSecurityHeaders(redirectRes, csp);
    }
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  }

  return withSecurityHeaders(res, csp);
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
