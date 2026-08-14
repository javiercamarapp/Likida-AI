import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getRentabilidad, getCobranza } from '@/lib/likida/comercial';
import { VistaRentabilidad } from './vista';

export const dynamic = 'force-dynamic';

/**
 * Rentabilidad y cobranza a clientes (F7 del plan) — la pantalla existe
 * DESDE HOY pero solo afirma lo que sus tablas sostienen: `ingreso_flete`
 * por viaje y `factura_emitida`/`pago_recibido` (migs. 0047-0050). Mientras
 * estén vacías, la pantalla dice exactamente qué se enciende al llenarlas —
 * nunca un cero que parezca medición de un negocio en ceros.
 *
 * `getRentabilidad` deliberadamente NO usa el anticipo como ingreso (ver
 * comercial.ts): un margen contra el anticipo se ve bien y está mal.
 */
export default async function PaginaRentabilidad({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/rentabilidad', sp);
  if (!puedeVerRuta(rol, '/dashboard/rentabilidad')) redirect('/dashboard');

  // Cada bloque cae a su propio error honesto: una tabla ilegible no debe
  // tirar la página entera ni, peor, leerse como "no hay facturas".
  const [rentabilidad, cobranza] = await Promise.all([
    getRentabilidad(tenantId).catch(() => null),
    getCobranza(tenantId).catch(() => null),
  ]);

  return <VistaRentabilidad rentabilidad={rentabilidad} cobranza={cobranza} />;
}
