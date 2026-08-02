// src/app/auth/callback/route.ts
// Supabase redirige aquí con ?code= tras el magic link o el consentimiento de
// Google. exchangeCodeForSession intercambia ese code por una sesión real y
// la deja en las cookies (mismo cliente/cookies que supabaseServer() usa en
// el resto del panel).
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const next = req.nextUrl.searchParams.get('next');
  const dest = next && next.startsWith('/dashboard') ? next : '/dashboard';

  if (code) {
    try {
      const sb = await supabaseServer();
      const { error } = await sb.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(dest, req.url));
    } catch {
      // Fallo inesperado del SDK o supabaseServer() — cae al mismo fallback
      // para evitar que un error raro se vuelva un 500 genérico en la pantalla
      // de login más importante
    }
  }
  return NextResponse.redirect(new URL('/login?error=1', req.url));
}
