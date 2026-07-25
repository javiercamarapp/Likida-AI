import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_COOKIE, expectedAccessToken } from '@/lib/auth/passcode';

// Cabeceras de seguridad + gate de passcode del dashboard (demo). Sin Supabase
// Auth: el dashboard es read-only y va detrás de un passcode simple.

export function middleware(req: NextRequest) {
  const res = NextResponse.next({ request: req });
  const path = req.nextUrl.pathname;

  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Gate: /dashboard exige la cookie del passcode. Si falta o no coincide → /acceso.
  if (path.startsWith('/dashboard')) {
    const expected = expectedAccessToken();
    const cookie = req.cookies.get(ACCESS_COOKIE)?.value;
    // Si no hay passcode configurado (dev), no bloquear. Con passcode, exigir match.
    if (expected && cookie !== expected) {
      const url = req.nextUrl.clone();
      url.pathname = '/acceso';
      url.searchParams.set('next', path);
      return NextResponse.redirect(url);
    }
  }
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
