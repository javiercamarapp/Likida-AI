import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { catalogoIntegraciones } from '@/lib/likida/integraciones';
import { sufijoTenant } from '../sufijo';
import { VistaIntegraciones } from './vista';

export const dynamic = 'force-dynamic';

/**
 * Integraciones (chasis de agentes) — con qué sistemas de la flota conecta Likida.
 *
 * Solo UN estado se mide por tenant (las credenciales de rastreo); el resto son
 * verdades del producto, iguales para todas las flotas. Fingir una medición por
 * tenant en algo que no varía sería tan deshonesto como el semáforo decorativo
 * que esta pantalla evita.
 *
 * El conteo se lee con `catch → null`, y `catalogoIntegraciones` sabe que un
 * null NO es "conectada": un error de consulta que se leyera como conectado
 * haría creer al dueño que tiene rastreo en vivo mientras el mapa dibuja líneas.
 */
export default async function PaginaIntegraciones({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/integraciones', sp);
  if (!puedeVerRuta(rol, '/dashboard/integraciones')) redirect('/dashboard');

  // `try/catch` y no `.catch()`: el builder de supabase-js devuelve un
  // `PromiseLike`, que no trae `.catch`. Y el error hay que atraparlo por los
  // DOS caminos —el valor `error` que reporta PostgREST y la excepción de red—
  // porque cualquiera de los dos aplastado a 0 diría "sin conectar" cuando la
  // verdad es "no sé".
  let credencialesRastreo: number | null;
  try {
    const { count, error } = await supabaseAdmin()
      .from('rastreo_credencial').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);
    credencialesRastreo = error ? null : count ?? 0;
  } catch {
    credencialesRastreo = null;
  }

  return (
    <VistaIntegraciones
      integraciones={catalogoIntegraciones({ credencialesRastreo })}
      sufijo={sufijoTenant(sp)}
    />
  );
}
