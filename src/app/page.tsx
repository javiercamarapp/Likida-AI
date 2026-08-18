// ═══════════════════════════════════════════════════════════════════════════
// LA RAÍZ DE app.likida.ai NO ES UNA LANDING — ES UNA PUERTA.
//
// Hasta el 17-ago-2026 aquí vivía la página de marketing ("El cierre diario de
// tu flota, resuelto por WhatsApp", botones a /demo y /login). El marketing se
// mudó a https://likida.ai, que es OTRO proyecto (HTML estático), así que dos
// páginas afirmando lo mismo en dos dominios es exactamente la forma en la que
// una cifra o una promesa se quedan desfasadas sin que nadie se entere.
//
// `app.likida.ai` es el software. Quien escribe el dominio a secas quiere
// entrar, no que le vendan: con sesión se le reparte a su panel, sin sesión al
// login. Esta página no renderiza nada — todos sus caminos terminan en
// `redirect()`.
//
// LA SESIÓN SE LEE CON `getSessionTenant()`, la misma de guard.ts: no hay una
// segunda forma de saber quién eres, y el reparte-por-rol es `puertaDeEntrada`
// (visibilidad.ts), compartido con `/auth/callback` para que el aterrizaje del
// magic link y el de la raíz no puedan divergir.
//
// EL QUERY STRING SÍ VIAJA. `?tenant=`/`?vista=demo`/`?rol=` es el "ver como"
// auditado de un superadmin (guard.ts, tenant-efectivo.ts): si llega con esa
// intención explícita, va a /dashboard con su sufijo — no a /admin, que la
// tiraría. Se arma con `sufijoTenant`, el mismo helper que arrastra esos
// parámetros en el resto del panel, porque `requireSessionTenant` pierde el
// query string al redirigir (ver dashboard/sufijo.ts).
// ═══════════════════════════════════════════════════════════════════════════
import { redirect } from 'next/navigation';
import { getSessionTenant } from '@/lib/auth/session';
import { puertaDeEntrada } from '@/lib/auth/visibilidad';
import { sufijoTenant } from './dashboard/sufijo';

// Lee cookies de sesión: nunca se prerenderiza.
export const dynamic = 'force-dynamic';

export default async function Raiz({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; vista?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const sufijo = sufijoTenant(sp);
  const s = await getSessionTenant();

  if (!s) {
    // `next` solo se pone si hay algo que preservar. El callback lo honra
    // únicamente cuando empieza con /dashboard, así que un `next` vacío o
    // trivial sería ruido: sin él, ese mismo callback reparte por rol.
    redirect(sufijo ? `/login?next=${encodeURIComponent(`/dashboard${sufijo}`)}` : '/login');
  }

  // Intención explícita de "ver como" — la resuelve y la firma /dashboard.
  if (sufijo) redirect(`/dashboard${sufijo}`);

  redirect(puertaDeEntrada(s.rol));
}
