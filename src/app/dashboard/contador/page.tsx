import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { sufijoTenant } from '../sufijo';
import { InicioContador } from './inicio-contador';

export const dynamic = 'force-dynamic';

/**
 * LA CASA DEL CONTADOR — la raíz reconstruida el 14-ago-2026 (la primera
 * versión, con sus 5 subrutas, se borró el 10-ago para rehacerse desde cero).
 *
 * La puerta es la MISMA que la de cualquier página de dinero
 * (combustible-casetas, facturación): `resolverTenantEfectivo` recibe la ruta
 * y adentro gatea con `puedeVerRuta` — `/dashboard/contador` está declarada
 * como `dinero` en AREA_POR_RUTA, así que el encargado rebota a su propio
 * inicio y el contador, el dueño y el superadmin pasan. No hay una segunda
 * comprobación aquí porque esta página no tiene server actions: es solo
 * lectura, y la única puerta que necesita es la que ya cruzó.
 *
 * El contenido vive en `inicio-contador.tsx` exportado — mismas dos razones
 * que documenta `InicioContenido`: Next valida los exports de una Page (un
 * export extra rompe el build), y sin export el preview headless no puede
 * montar el componente REAL sin sesión.
 */
export default async function PanelContadorPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, tenantNombre, nombre, tenantExiste } = await resolverTenantEfectivo('/dashboard/contador', sp);
  // El MISMO contrato de sufijo que el sidebar y que `/dashboard/page.tsx`:
  // los links que esta página emite cargan el `?tenant=`/`?vista=`/`?rol=`
  // del superadmin; para roles reales queda vacío. `sufijoTenant` es la
  // versión canónica de esa lógica para páginas server.
  const sufijo = sufijoTenant(sp);

  return (
    <InicioContador
      tenantId={tenantId}
      tenantNombre={tenantNombre}
      nombre={nombre}
      tenantExiste={tenantExiste}
      sufijo={sufijo}
    />
  );
}
