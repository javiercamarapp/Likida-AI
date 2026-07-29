import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_COOKIE, hayPasscode, tokenMatches } from '@/lib/auth/passcode';

// Cabeceras de seguridad + gate de passcode del dashboard (demo). Sin Supabase
// Auth: el dashboard es read-only y va detrás de un passcode simple.
// El matcher EXCLUYE /api (webhook, demo, export manejan lo suyo y no deben pasar
// por el gate ni cargar cabeceras de página).

export async function proxy(req: NextRequest) {
  const res = NextResponse.next({ request: req });
  const path = req.nextUrl.pathname;

  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Solo en producción: en http:// el navegador ignora la cabecera, pero
  // ponerla en local tampoco aporta nada y sí confunde al depurar. Sin
  // `includeSubDomains` a propósito — hoy no se sabe qué subdominios del
  // dominio final existirán, y forzarlos a TLS a ciegas los deja inalcanzables
  // durante un año en los navegadores que ya la vieron.
  if (process.env.NODE_ENV === 'production') {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000');
  }

  if (path.startsWith('/dashboard')) {
    // El panel pinta nombres de operadores, montos y RFC. Sin esto, la respuesta
    // se queda en el caché del navegador y en el back/forward: la sesión caduca
    // a las 8 h en el servidor y la pantalla sigue ahí para el siguiente que
    // agarre la laptop del demo.
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');

    const cookie = req.cookies.get(ACCESS_COOKIE)?.value;
    // Si no hay passcode configurado (dev), no bloquear. Con passcode, exigir
    // que la cookie sea una sesión VIVA: `tokenMatches` comprueba la firma y la
    // hora de emisión, no solo que el valor coincida (passcode.ts).
    if (hayPasscode() && !(await tokenMatches(cookie))) {
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
