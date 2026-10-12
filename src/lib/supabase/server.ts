// Cliente SSR por cookies (RSC / route handlers). Respeta RLS con la sesión
// del usuario autenticado. Patrón @supabase/ssr.

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { combineAbortSignals, timeoutSignal } from '@/lib/llm/runtime-signal-shared';
import { COOKIES_DE_SESION } from './cookies';

// AUDITORÍA 32 c15, REN-32C15-C1 (CRÍTICO): este era el ÚNICO cliente de
// Supabase sin techo de fetch, y es el primero que corre en toda ruta
// autenticada y en las ~80 páginas de /dashboard y /admin. `admin.ts` lleva el
// backstop desde la auditoría 1 por el mismo motivo —un socket que Supabase
// acepta y no contesta cuelga hasta el default de undici, 300 s, y Vercel mata
// la función a medio camino SIN log— y `acotada()` lo bajó a ~9.5 s donde se
// usa; el cliente de la SESIÓN quedó fuera de las dos capas. Peor caso medido:
// `getSessionTenant()` reintenta la pareja `auth.getUser()` + `app_user`, así
// que son hasta 4 fetch sin señal, y `sesionSuperadmin()` llega a 6 — contra
// `maxDuration` de 60. Mientras este eslabón no tenga techo, ningún presupuesto
// del repo puede demostrar su peor caso.
//
// Mismo nombre de variable de entorno que `admin.ts`: es la misma política, y
// dos perillas para un solo criterio es cómo se desincronizan.
const BACKSTOP_MS = Number(process.env.LIKIDA_SUPABASE_FETCH_MS) || 25_000;

export async function supabaseServer(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createServerClient(url, key, {
    global: {
      // La señal del llamador sigue mandando; el backstop solo añade un techo.
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, {
          ...init,
          signal: combineAbortSignals(init?.signal ?? undefined, timeoutSignal(BACKSTOP_MS)),
        }),
    },
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
