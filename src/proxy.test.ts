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
const { proxy } = await import('./proxy');

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
