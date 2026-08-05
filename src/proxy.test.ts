import { describe, it, expect, vi, beforeEach } from 'vitest';

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

  it('/mis-viajes (panel del chofer) pasa por el mismo gate que /dashboard', async () => {
    const res = await pedir('/mis-viajes');
    const destino = new URL(res.headers.get('location')!);
    expect(destino.pathname).toBe('/login');
    expect(destino.searchParams.get('next')).toBe('/mis-viajes');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /chofer NO ESTABA EN ESTE ARCHIVO.
//
// El panel móvil del chofer se construyó con su puerta en el layout
// (`requireOperador`) y nada más: la promesa de este archivo —dos capas que
// tienen que fallar a la vez— no se cumplía para toda una sección. Y es la
// capa que ve la URL COMPLETA, así que era también la única que podía
// devolver al chofer a la pantalla exacta del enlace de WhatsApp que abrió.
// ═══════════════════════════════════════════════════════════════════════════
describe('proxy · gate de /chofer sin sesión', () => {
  beforeEach(() => { usuario = null; });

  const RUTAS = [
    '/chofer',
    '/chofer/liquidacion',
    '/chofer/comprobantes',
    '/chofer/viajes',
  ];

  it.each(RUTAS)('%s sin sesión NO se sirve: rebota a /login', async (ruta) => {
    const res = await pedir(ruta);
    expect(res.status, `${ruta} se sirvió sin sesión`).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
  });

  it.each(RUTAS)('%s conserva su ruta de vuelta EXACTA en el next', async (ruta) => {
    const res = await pedir(ruta);
    expect(new URL(res.headers.get('location')!).searchParams.get('next')).toBe(ruta);
  });

  it('una liga profunda con query string tampoco pierde el destino', async () => {
    // Es el caso real: el enlace llega por WhatsApp y apunta a una pantalla
    // concreta. La página solo conoce su propia ruta; esta capa ve la URL.
    const req = new NextRequest('https://likidaai.vercel.app/chofer/viajes?ver=todos');
    const res = await proxy(req);
    expect(new URL(res.headers.get('location')!).searchParams.get('next')).toBe('/chofer/viajes');
  });

  it('con sesión pasa, y el panel del chofer no se cachea', async () => {
    // Un panel con montos y nombres servido desde caché compartida sería el
    // saldo de un chofer en la pantalla de otro.
    usuario = { id: 'u-1' };
    const res = await pedir('/chofer/liquidacion');
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });

  it('el redirect de /chofer también lleva cabeceras de seguridad', async () => {
    const res = await pedir('/chofer');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LA LISTA NO SE PUEDE QUEDAR ATRÁS OTRA VEZ.
// ═══════════════════════════════════════════════════════════════════════════
describe('toda sección con puerta propia está nombrada en el matcher', () => {
  it('las cuatro secciones del producto exigen sesión en esta capa', () => {
    // Si mañana nace /taller o /cliente con su `requireX` en el layout, esta
    // prueba no lo va a atrapar sola — pero la lista es UN string y está a la
    // vista, que es lo que /chofer no tuvo: su ausencia solo constaba en un
    // comentario dentro de su propio layout.
    expect([...RUTAS_CON_SESION].sort()).toEqual(
      ['/admin', '/chofer', '/dashboard', '/mis-viajes'].sort(),
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
    // navegador pide directo (chofer.ts:424, admin/mi-perfil/page.tsx:52).
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
