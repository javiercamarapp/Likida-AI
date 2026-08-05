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
