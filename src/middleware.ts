import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Refresca la sesión de Supabase en cada request + endurece cabeceras.
// Los webhooks/cron/api-públicas se saltan el refresh (no tienen sesión).

const PUBLIC = ['/', '/demo', '/login', '/register'];
const SKIP_AUTH = ['/api/webhook', '/api/demo'];

export async function middleware(req: NextRequest) {
  const res = NextResponse.next({ request: req });
  const path = req.nextUrl.pathname;

  // Cabeceras de seguridad (defensa en profundidad).
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  if (SKIP_AUTH.some((p) => path.startsWith(p))) return res;

  const isPublic = PUBLIC.includes(path) || path.startsWith('/api/') || path.startsWith('/_next');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    // AL-4: sin config de Supabase, fail-CLOSED en producción (una env mal puesta
    // NO debe dejar rutas protegidas abiertas). En dev se permite para no bloquear.
    if (process.env.NODE_ENV === 'production' && !isPublic) {
      return NextResponse.redirect(new URL('/', req.url));
    }
    return res;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
    },
  });
  const { data: { user } } = await supabase.auth.getUser();

  // Rutas protegidas (dashboard/admin/portal) exigen sesión. Se redirige al
  // landing (existe) en vez de /login (aún no implementado → evita 404). AL-4.
  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/', req.url));
  }
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
