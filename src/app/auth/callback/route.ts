// src/app/auth/callback/route.ts
// Supabase redirige aquí con ?code= tras el magic link o el consentimiento de
// Google. exchangeCodeForSession intercambia ese code por una sesión real y
// la deja en las cookies (mismo cliente/cookies que supabaseServer() usa en
// el resto del panel).
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { getSessionTenant } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const next = req.nextUrl.searchParams.get('next');
  const destinoExplicito = next && next.startsWith('/dashboard') ? next : null;

  if (code) {
    try {
      const sb = await supabaseServer();
      const { error } = await sb.auth.exchangeCodeForSession(code);
      if (!error) {
        // Sin `next` explícito, superadmin aterriza en SU consola (/admin),
        // no en el panel del tenant demo — antes de esto no tenía a dónde
        // ir que fuera suyo. Un `next` explícito (un link a /dashboard/[id]
        // que alguien mandó) se respeta tal cual, para todos los roles.
        let dest = destinoExplicito ?? '/dashboard';
        if (!destinoExplicito) {
          const s = await getSessionTenant();
          if (s?.rol === 'superadmin') dest = '/admin';
        }
        return NextResponse.redirect(new URL(dest, req.url));
      }
    } catch {
      // Fallo inesperado del SDK o supabaseServer() — cae al mismo fallback
      // para evitar que un error raro se vuelva un 500 genérico en la pantalla
      // de login más importante
    }
  }
  return NextResponse.redirect(new URL('/login?error=1', req.url));
}
