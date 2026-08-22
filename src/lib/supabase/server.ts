// Cliente SSR por cookies (RSC / route handlers). Respeta RLS con la sesión
// del usuario autenticado. Patrón @supabase/ssr.

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { COOKIES_DE_SESION } from './cookies';

export async function supabaseServer(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createServerClient(url, key, {
    // Ver `./cookies.ts`: el token de sesión deja de ser legible por
    // JavaScript del navegador (SEG-3).
    cookieOptions: COOKIES_DE_SESION,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) =>
            // El `httpOnly` se vuelve a poner AQUÍ y no solo en
            // `cookieOptions`: `options` viene del SDK y, si algún día
            // dejara de propagar la opción global, el token volvería a ser
            // legible sin que nada fallara. Lo que se pierde en silencio no
            // se puede dejar en manos de un `...spread` ajeno.
            cookieStore.set(name, value, { ...options, ...COOKIES_DE_SESION }));
        } catch {
          // set() falla en Server Components de solo-lectura; el proxy refresca.
        }
      },
    },
  });
}
