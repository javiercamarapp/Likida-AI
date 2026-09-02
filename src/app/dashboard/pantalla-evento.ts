import { TODAS_LAS_RUTAS } from './rutas';

// ═══════════════════════════════════════════════════════════════════════════
// LA RUTA → LA PANTALLA DEL CATÁLOGO (producto_evento, 0251).
//
// El pulso del panel manda el pathname crudo; aquí se convierte en un nombre
// de pantalla de LISTA CERRADA — o en null, que significa «se descarta». La
// lista cerrada no es manía: `producto_evento` alimenta cohortes y adopción,
// y una ruta arbitraria escrita por un cliente autenticado (un POST a mano,
// no una navegación) sería una fila de basura directa al tablero — el mismo
// criterio que `paginaValida` en /api/marketing/evento (0223).
//
// El catálogo ES `TODAS_LAS_RUTAS` (rutas.ts): si mañana el sidebar gana una
// página, el pulso la mide sin tocar este archivo. Los dos casos que el
// catálogo no nombra:
//   · la raíz '/dashboard' → 'resumen' (así la nombra el propio catálogo);
//   · '/dashboard/<uuid>' → 'liquidacion' (el detalle de liquidación vive en
//     [id]/page.tsx, sin entrada de sidebar). El uuid NO se guarda: la
//     pantalla es el detalle, no cuál liquidación — minimización.
//
// Subrutas: '/dashboard/viajes/abc' cuenta como 'viajes' — gana el href MÁS
// LARGO que sea prefijo ('/dashboard/descarga-sat/bandeja' le gana a
// '/dashboard/descarga-sat'), porque el catálogo tiene entradas anidadas.
// ═══════════════════════════════════════════════════════════════════════════

/** Páginas reales SIN entrada de sidebar (el catálogo no las nombra pero el
 *  usuario sí las pisa): el panel del contador (`inicioDe` manda ahí a ese
 *  rol). Se listan aquí para no perderlas del tablero. */
const EXTRAS: readonly string[] = ['/dashboard/contador'];

/** Los hrefs del catálogo, del más largo al más corto, para que el prefijo
 *  anidado gane. Sin la raíz: ese caso se resuelve aparte. */
const HREFS: readonly string[] = [...new Set(
  [...TODAS_LAS_RUTAS.map((r) => r.href), ...EXTRAS].filter((h) => h !== '/dashboard'),
)].sort((a, b) => b.length - a.length);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** El nombre de pantalla del catálogo para un pathname del panel, o `null`
 *  si la ruta no es de ninguna pantalla conocida (se descarta sin error). */
export function pantallaDesdeRuta(ruta: unknown): string | null {
  if (typeof ruta !== 'string' || ruta.length === 0 || ruta.length > 200) return null;
  // El pulso manda `usePathname()` (sin query ni hash), pero un POST a mano
  // puede traer lo que sea — se recorta defensivamente.
  const limpia = ruta.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  if (limpia === '/dashboard') return 'resumen';
  if (!limpia.startsWith('/dashboard/')) return null;
  for (const href of HREFS) {
    if (limpia === href || limpia.startsWith(`${href}/`)) {
      return href.slice('/dashboard/'.length);
    }
  }
  // El detalle de liquidación ([id]/page.tsx): un uuid directo bajo la raíz.
  const resto = limpia.slice('/dashboard/'.length);
  if (UUID.test(resto)) return 'liquidacion';
  return null;
}
