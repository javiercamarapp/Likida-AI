import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getPorFacturar } from '@/lib/likida/facturacion/pendientes';
import { VistaAgenteFacturas } from './vista';

export const dynamic = 'force-dynamic';

/**
 * Agente de Facturas — la SEGUNDA página de AGENTES (13-ago-2026). Reúne
 * los gastos que aún no tienen CFDI con todo lo que el portal de cada
 * comercio va a pedir, ordenados por lo que vence primero. Esta puerta trae
 * sesión y datos; el dibujo vive en `vista.tsx` (patrón page/vista).
 *
 * LO QUE ESTA PÁGINA NO AFIRMA: que el agente facture solo. Hoy la emisión
 * automática cubre CAPUFE; el resto se factura en el portal del comercio
 * con estos datos a la mano — y eso se dice, textual, en la vista.
 */
export default async function PaginaAgenteFacturas({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/agentes/facturas', sp);
  if (!puedeVerRuta(rol, '/dashboard/agentes/facturas')) redirect('/dashboard');

  // Sin catch: base caída = página caída, no una lista vacía que afirma
  // "todo facturado" estando ciega.
  const tickets = await getPorFacturar(tenantId);

  return <VistaAgenteFacturas tickets={tickets} />;
}
