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
function withSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (process.env.NODE_ENV === 'production') {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000');
  }
  return res;
}

export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const path = req.nextUrl.pathname;

  // /mis-viajes es el panel del chofer (0045 + requireOperador, guard.ts):
  // mismo gate de sesión que /dashboard, la distinción de ROL vive en la
  // página, no aquí — esta capa solo pregunta "¿hay sesión?".
  if (path.startsWith('/dashboard') || path.startsWith('/mis-viajes')) {
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
