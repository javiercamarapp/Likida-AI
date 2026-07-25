import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_COOKIE, expectedAccessToken, tokenMatches } from '@/lib/auth/passcode';

// Cabeceras de seguridad + gate de passcode del dashboard (demo). Sin Supabase
// Auth: el dashboard es read-only y va detrás de un passcode simple.
// El matcher EXCLUYE /api (webhook, demo, export manejan lo suyo y no deben pasar
// por el gate ni cargar cabeceras de página).

export async function middleware(req: NextRequest) {
  const res = NextResponse.next({ request: req });
  const path = req.nextUrl.pathname;

  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  if (path.startsWith('/dashboard')) {
    const cookie = req.cookies.get(ACCESS_COOKIE)?.value;
    // Si no hay passcode configurado (dev), no bloquear. Con passcode, exigir match.
    if ((await expectedAccessToken()) && !(await tokenMatches(cookie))) {
      const url = req.nextUrl.clone();
      url.pathname = '/acceso';
      url.searchParams.set('next', path);
      return NextResponse.redirect(url);
    }
  }
  return res;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
