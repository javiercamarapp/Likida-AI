import { cache } from 'react';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { CLAVE_PREFERENCIA, COOKIE_IDIOMA, idiomaServible, resolverIdioma, type Idioma } from './idioma';
import { cargarDiccionarios, type ClaveDe, type DiccionarioDe, type Namespace } from './catalogo';
import { crearTraductor, type Traductor } from './traducir';

// ═══════════════════════════════════════════════════════════════════════════
// IDIOMA EN EL SERVIDOR (Server Components, layouts, route handlers).
//
// ⚠ NO se llama desde el layout RAÍZ (`src/app/layout.tsx`): leer cookies ahí volvería dinámico lo que no lo es. Los layouts de
// /dashboard y /admin (ya dinámicos: leen sesión y cookies) la llaman y pasan el resultado al `IdiomaProvider`; las públicas
// se quedan en es hasta su paquete (P10, subruta `/en`).
//
// Orden: cookie `likida_lang` > `user_metadata.idioma` > es. La preferencia del usuario SOLO se consulta si no hay cookie válida
// (una ida a GoTrue); en cuanto la persona elige idioma queda la cookie y esa ida desaparece.
// ═══════════════════════════════════════════════════════════════════════════

async function leerIdiomaActual(): Promise<Idioma> {
  let cookie: string | undefined;
  try {
    cookie = (await cookies()).get(COOKIE_IDIOMA)?.value;
  } catch { /* fuera de una petición (pruebas, scripts): cae a es */ }
  const delaCookie = resolverIdioma({ cookie });
  if (cookie !== undefined && delaCookie === cookie) return delaCookie;
  try {
    const sb = await supabaseServer();
    const { data } = await sb.auth.getUser();
    return resolverIdioma({ preferencia: data.user?.user_metadata?.[CLAVE_PREFERENCIA] });
  } catch {
    return resolverIdioma();
  }
}

/** El idioma de ESTA petición (memorizado por petición con `cache()`). Nunca lanza: ante cualquier fallo, es. */
export const idiomaActual = cache(async (): Promise<Idioma> => idiomaServible(await leerIdiomaActual()));

/** El traductor de un namespace para un Server Component: `const { t } = await getT('shell')`. No manda nada al navegador. */
export async function getT<N extends Namespace>(ns: N): Promise<Traductor<DiccionarioDe<N>>> {
  const idioma = await idiomaActual();
  const dic = (await cargarDiccionarios(idioma, [ns]))[ns] as DiccionarioDe<N>;
  // Respaldo es: solo se carga si el idioma activo no es es.
  const base = (idioma === 'es' ? dic : (await cargarDiccionarios('es', [ns]))[ns]) as DiccionarioDe<N>;
  return crearTraductor<DiccionarioDe<N>>(idioma, dic, base);
}

/**
 * Lo que el layout le pasa al `IdiomaProvider`: el idioma y los diccionarios de la ruta. En español NO se manda nada (cada
 * componente trae su diccionario es como respaldo), así el navegador solo recibe texto cuando el idioma activo no es es.
 */
export async function datosParaProveedor<N extends Namespace>(namespaces: readonly N[]) {
  const idioma = await idiomaActual();
  const diccionarios = idioma === 'es' ? {} : await cargarDiccionarios(idioma, namespaces);
  return { idioma, diccionarios } as { idioma: Idioma; diccionarios: Partial<Awaited<ReturnType<typeof cargarDiccionarios<N>>>> };
}

export type { ClaveDe };
