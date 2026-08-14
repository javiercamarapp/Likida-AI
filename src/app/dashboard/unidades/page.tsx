import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getUnidades } from '@/lib/likida/operacion';
import { VistaUnidades } from './vista';

export const dynamic = 'force-dynamic';

/**
 * El Registro de Unidades — el activo que produce el dinero, con las vigencias
 * que la ley le exige para poder producirlo.
 *
 * El motor (`getUnidades`) ya estaba terminado desde la 0047: elige el papel
 * más próximo a vencer de los tres y cuenta las órdenes de mantenimiento
 * abiertas. Lo único que faltaba era la pantalla.
 *
 * SIN CATCH: una pantalla que existe para avisar de papeles vencidos no puede
 * pintar "todo en regla" porque la consulta falló. Si no se puede leer, se cae
 * y `error.tsx` lo dice.
 *
 * Es área `operacion` y no `dinero` a propósito: el jefe de tráfico es
 * exactamente quien tiene que enterarse de que una unidad no puede salir, y la
 * pantalla no enseña un peso.
 */
export default async function PaginaUnidades({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/unidades', sp);
  if (!puedeVerRuta(rol, '/dashboard/unidades')) redirect('/dashboard');

  const unidades = await getUnidades(tenantId);

  return <VistaUnidades unidades={unidades} />;
}
