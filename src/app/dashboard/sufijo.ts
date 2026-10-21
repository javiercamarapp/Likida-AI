/**
 * El `?tenant=`/`?vista=demo` que hay que arrastrar en CADA link interno de
 * /dashboard cuando un superadmin está viendo la flota de un cliente — si un
 * link lo pierde, el siguiente clic te devuelve al tenant demo sin avisar,
 * viendo cifras de otra empresa bajo el mismo encabezado.
 *
 * El sidebar tiene su propia copia de esta lógica (`sidebar-nav.tsx`) porque
 * ahí es un Client Component que lee `useSearchParams()`; aquí es para las
 * páginas server, que reciben `searchParams` como prop. Misma regla, dos
 * fuentes de entrada.
 *
 * `?rol=` viaja con ellos por la misma razón, y es la mitad que faltaba: el
 * sidebar ya lo arrastraba (`sidebar-nav.tsx`) pero los links DENTRO de la
 * página no, así que "Ver detalle →" o "Ir a despacho" apagaban la
 * previsualización a media navegación — volvías a ver el panel con tus propios
 * ojos de superadmin, sin cinta, creyendo que seguías viendo el del contador.
 * Para un rol real `sp.rol` no existe (entra por /login sin query string) y
 * esto sigue devolviendo exactamente lo de antes.
 */
export function sufijoTenant(sp: { tenant?: string; vista?: string; rol?: string } | undefined): string {
  const base = sp?.tenant
    ? `?tenant=${encodeURIComponent(sp.tenant)}`
    : sp?.vista ? `?vista=${encodeURIComponent(sp.vista)}` : '';
  if (!sp?.rol) return base;
  return `${base}${base ? '&' : '?'}rol=${encodeURIComponent(sp.rol)}`;
}

/**
 * HALLAZGO MEDIO (auditoría de este repo, 21-oct-2026): `sufijoTenant` de
 * arriba resuelve la mitad del problema — arrastra `?tenant=`/`?vista=`/
 * `?rol=` entre links INTERNOS de /dashboard. La otra mitad es el REDIRECT
 * a /login cuando la sesión expira a media navegación: `requireSessionTenant`
 * (guard.ts) armaba ese redirect con el `destino` LITERAL que cada página le
 * pasa (p.ej. `/dashboard/viajes`), nunca con la querystring real que el
 * usuario tenía abierta (`?f=abiertos&q=...&c=...&p=3`) — tras volver a
 * entrar, aterrizaba en la página pelona, sin sus filtros ni su página.
 *
 * Esta función serializa TODO lo que `searchParams` traiga (filtros,
 * paginación, y también `tenant`/`vista`/`rol` — la previsualización de
 * superadmin se pierde igual si la sesión expira a media navegación) para
 * pasarlo como tercer argumento a `requireSessionTenant`/
 * `resolverTenantEfectivo`, que lo cuelgan del `next=` del redirect.
 */
export function querystringCompleto(sp: Record<string, string | undefined> | undefined): string {
  if (!sp) return '';
  const qs = new URLSearchParams();
  for (const [clave, valor] of Object.entries(sp)) {
    if (valor !== undefined && valor !== '') qs.set(clave, valor);
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}
