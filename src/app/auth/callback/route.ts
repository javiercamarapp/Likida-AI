// src/app/auth/callback/route.ts
// Supabase redirige aquí con ?code= tras el magic link o el consentimiento de
// Google. exchangeCodeForSession intercambia ese code por una sesión real y
// la deja en las cookies (mismo cliente/cookies que supabaseServer() usa en
// el resto del panel).
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { getSessionTenant } from '@/lib/auth/session';
import { puertaDeEntrada } from '@/lib/auth/visibilidad';
import { aParametro, motivoDeIntercambio, motivoSinCode } from '@/lib/auth/motivo_login';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const next = req.nextUrl.searchParams.get('next');
  const destinoExplicito = next && next.startsWith('/dashboard') ? next : null;

  // Con qué se vuelve a /login si esto no acaba en sesión. Empieza en el
  // motivo que Supabase pegó al redirect cuando rechazó el token ANTES de
  // emitir un code (enlace ya usado o caducado → `error_code=otp_expired`);
  // si el code sí llegó, el canje de abajo lo puede refinar.
  let motivo = motivoSinCode(req.nextUrl.searchParams.get('error_code'));

  if (code) {
    try {
      const sb = await supabaseServer();
      const { error } = await sb.auth.exchangeCodeForSession(code);
      if (error) motivo = motivoDeIntercambio(error);
      if (!error) {
        // Sin `next` explícito, superadmin aterriza en SU consola (/admin),
        // no en el panel del tenant demo — antes de esto no tenía a dónde
        // ir que fuera suyo. Un `next` explícito (un link a /dashboard/[id]
        // que alguien mandó) se respeta tal cual, para todos los roles.
        //
        // La regla vive en `puertaDeEntrada` (visibilidad.ts) desde el
        // 17-ago-2026 porque la raíz `/` la necesita idéntica: dejó de ser
        // landing y ahora también reparte. Dos copias del mismo ternario en
        // dos archivos es cómo el magic link y el dominio a secas acaban
        // aterrizando en paneles distintos.
        let dest = destinoExplicito ?? '/dashboard';
        if (!destinoExplicito) {
          const s = await getSessionTenant();
          if (s) dest = puertaDeEntrada(s.rol);
        }
        return NextResponse.redirect(new URL(dest, req.url));
      }
    } catch {
      // Fallo inesperado del SDK o supabaseServer() — cae al mismo fallback
      // para evitar que un error raro se vuelva un 500 genérico en la pantalla
      // de login más importante
    }
  }
  return NextResponse.redirect(new URL(`/login?error=${aParametro(motivo)}`, req.url));
}
