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
 */
export function sufijoTenant(sp: { tenant?: string; vista?: string } | undefined): string {
  if (sp?.tenant) return `?tenant=${encodeURIComponent(sp.tenant)}`;
  if (sp?.vista) return `?vista=${encodeURIComponent(sp.vista)}`;
  return '';
}
