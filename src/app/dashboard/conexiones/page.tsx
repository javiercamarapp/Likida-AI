import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getConexiones } from '@/lib/likida/conexiones';
import { VistaConexiones } from './vista';

export const dynamic = 'force-dynamic';

/**
 * Conexiones (F7 del plan — el chasis de Handle): qué tiene conectado la
 * flota y qué le falta, con estado MEDIDO. Área `administracion`: es
 * configuración de la cuenta, del dueño.
 */
export default async function PaginaConexiones({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/conexiones', sp);
  if (!puedeVerRuta(rol, '/dashboard/conexiones')) redirect('/dashboard');

  // Primario sin catch: una pantalla de salud que no puede leer la salud
  // debe caerse, no pintar verdes de adorno.
  const conectores = await getConexiones(tenantId);

  return <VistaConexiones conectores={conectores} />;
}
