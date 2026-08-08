import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// REVISIÓN FINAL de la rama de auth — las cookies del refresh NO se pierden en
// el camino a /login.
//
// `getUser()` puede pedir escribir cookies ANTES de contestar que no hay
// sesión: es lo que hace el SDK cuando el refresh token está muerto (manda
// borrarla). Esas escrituras van a `res` vía `setAll`, y el redirect a /login
// es OTRO objeto de respuesta. Sin copiarlas, el navegador nunca recibe el
// borrado y sigue mandando la cookie muerta: cada petición paga un refresh
// fallido para acabar, otra vez, en este mismo redirect.
// ═══════════════════════════════════════════════════════════════════════════

type Cb = { getAll: () => unknown[]; setAll: (l: { name: string; value: string; options?: object }[]) => void };
let cookiesCb: Cb;
let usuario: { id: string } | null = null;

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: Cb }) => {
    cookiesCb = opts.cookies;
    return {
      auth: {
        getUser: async () => {
          // El SDK manda borrar la cookie muerta ANTES de contestar.
          cookiesCb.setAll([{ name: 'sb-proyecto-auth-token', value: '', options: { path: '/', maxAge: 0 } }]);
          return { data: { user: usuario } };
        },
      },
    };
  },
}));

const { NextRequest } = await import('next/server');
const { proxy, RUTAS_CON_SESION } = await import('./proxy');

function pedir(path: string) {
  const req = new NextRequest(`https://likidaai.vercel.app${path}`);
  req.cookies.set('sb-proyecto-auth-token', 'token-muerto');
  return proxy(req);
}

describe('proxy · gate de /dashboard sin sesión', () => {
  beforeEach(() => { usuario = null; });

  it('redirige a /login conservando el destino', async () => {
    const res = await pedir('/dashboard');
    const destino = new URL(res.headers.get('location')!);
    expect(destino.pathname).toBe('/login');
    expect(destino.searchParams.get('next')).toBe('/dashboard');
  });

  it('el redirect ARRASTRA las cookies que Supabase escribió durante getUser', async () => {
    const res = await pedir('/dashboard');
    expect(res.cookies.get('sb-proyecto-auth-token')?.value).toBe('');
  });

  it('el redirect sigue llevando las cabeceras de seguridad', async () => {
    const res = await pedir('/dashboard');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('con sesión no redirige y el panel no se cachea', async () => {
    usuario = { id: 'u-1' };
    const res = await pedir('/dashboard');
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// LA LISTA NO SE PUEDE QUEDAR ATRÁS OTRA VEZ.
// ═══════════════════════════════════════════════════════════════════════════
describe('toda sección con puerta propia está nombrada en el matcher', () => {
  it('las dos secciones del producto exigen sesión en esta capa', () => {
    // /chofer y /mis-viajes salieron el 7-ago-2026 (el chofer ya no tiene
    // cuenta, solo WhatsApp). Si mañana nace /taller o /cliente con su
    // `requireX` en el layout, esta prueba no lo va a atrapar sola — pero la
    // lista es UN string y está a la vista, que es lo que /chofer no tuvo al
    // principio: su ausencia solo constaba en un comentario en su layout.
    expect([...RUTAS_CON_SESION].sort()).toEqual(
      ['/admin', '/dashboard'].sort(),
    );
  });

  it('ninguna ruta pública se coló en la lista', async () => {
    usuario = null;
    for (const publica of ['/', '/login', '/sin-acceso', '/auth/callback']) {
      const res = await pedir(publica);
      expect(res.headers.get('location'), `${publica} no debería exigir sesión`).toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10: CSP reincidente desde al menos la ronda 8 — nunca se había
// escrito. Cada directiva sale de recorrer qué carga esta app de verdad, no
// de una plantilla genérica: ver el comentario junto a `CSP` en `proxy.ts`.
// ═══════════════════════════════════════════════════════════════════════════
describe('proxy · Content-Security-Policy', () => {
  beforeEach(() => { usuario = null; });

  it('toda página pública lleva el header, con las directivas que la app necesita', async () => {
    const res = await pedir('/login');
    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    // Las fotos de comprobante y el avatar son URLs de Storage que el
    // navegador pide directo (admin/mi-perfil/page.tsx:52).
    expect(csp).toContain('https://*.supabase.co');
    // Los dos `fetch(` de componentes cliente son a rutas propias; Sentry,
    // WhatsApp y Stripe son server-only — nada más necesita connect-src.
    expect(csp).toContain("connect-src 'self'");
    // Cero <iframe> en el repo, y refuerzo de X-Frame-Options por CSP.
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it('el redirect a /login (sesión rechazada) también lleva CSP, no solo lo que sí se sirve', async () => {
    const res = await pedir('/dashboard');
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
  });

  it('una respuesta CON sesión también lleva CSP', async () => {
    usuario = { id: 'u-1' };
    const res = await pedir('/dashboard');
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL 8-AGO-2026 SE PROBÓ QUE LA CSP DEJABA "AÚN CARGANDO" PARA SIEMPRE.
//
// `next dev` (Fast Refresh) parchea módulos con `eval()` al arrancar el
// bundle del navegador — sin `unsafe-eval` esa corrida truena ANTES de que
// React hidrate, y el panel se queda pegado en el loading skeleton para
// siempre (se reprodujo igual tras reiniciar el servidor de dev entero, así
// que no era un HMR viejo: era la CSP). El SSR seguía sirviendo el HTML real
// —confirmado con un `fetch()` directo, 1-2s, con los datos reales adentro—
// pero el navegador nunca lo mostraba.
//
// Lo que se prueba aquí: `unsafe-eval` SOLO aparece en desarrollo. Un
// `unsafe-eval` colado en producción sería la auditoría 10 otra vez, al
// revés.
// ═══════════════════════════════════════════════════════════════════════════
describe('proxy · CSP — unsafe-eval solo en desarrollo', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('en development, script-src permite unsafe-eval (si no, Fast Refresh nunca hidrata)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    const { proxy: proxyDev } = await import('./proxy');
    const req = new NextRequest('https://likidaai.vercel.app/login');
    req.cookies.set('sb-proyecto-auth-token', 'token-muerto');
    const res = await proxyDev(req);
    expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
  });

  it('en producción, unsafe-eval NUNCA aparece — relajarlo ahí sería la auditoría 10 otra vez', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { proxy: proxyProd } = await import('./proxy');
    const req = new NextRequest('https://likidaai.vercel.app/login');
    req.cookies.set('sb-proyecto-auth-token', 'token-muerto');
    const res = await proxyProd(req);
    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain('unsafe-eval');
  });
});
