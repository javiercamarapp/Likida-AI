import { redirect } from 'next/navigation';
import { getT } from '@/lib/i18n/servidor';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getRentabilidad, getCobranza } from '@/lib/likida/comercial';
import { VistaRentabilidad } from './vista';
import { desdeDelPeriodo, periodoDe } from './periodo';
import { sufijoTenant } from '../sufijo';
import type { Metadata } from 'next';
export async function generateMetadata(): Promise<Metadata> {
  const { t: tr } = await getT('dinero');
  return { title: tr('meta.rentabilidad') };
}

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
  searchParams: Promise<{ tenant?: string; rol?: string; vista?: string; p?: string; periodo?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/rentabilidad', sp);
  if (!puedeVerRuta(rol, '/dashboard/rentabilidad')) redirect('/dashboard');

  // LA CARTERA SE PAGINA (mig. 0152). Antes esta página recibía TODAS las
  // facturas emitidas del tenant y las pintaba en una sola tabla: con 50k
  // viajes/mes son cientos de miles de renglones que ni caben en la respuesta
  // ni los lee nadie. `getCobranza` devuelve ≤100 con orden estable y el
  // total; las tres cifras de arriba siguen siendo del PERIODO COMPLETO.
  const pagina = Math.max(1, Math.min(1000, Number.parseInt(sp.p ?? '1', 10) || 1));

  // Cada bloque cae a su propio error honesto: una tabla ilegible no debe
  // tirar la página entera ni, peor, leerse como "no hay facturas".
  // El periodo (30 d / 90 d / 12 m / todo) mueve la RENTABILIDAD (viajes del periodo, `p_desde` de la RPC). La cartera por cobrar es el saldo
  // vigente de todas las facturas, no un flujo del periodo: la vista lo dice en su nota de método.
  const periodo = periodoDe(sp.periodo);
  const [rentabilidad, cobranza] = await Promise.all([
    getRentabilidad(tenantId, desdeDelPeriodo(periodo)).catch(() => null),
    getCobranza(tenantId, { pagina }).catch(() => null),
  ]);

  const { t: tr } = await getT('dinero');
  return <VistaRentabilidad tr={tr} rentabilidad={rentabilidad} cobranza={cobranza} sufijo={sufijoTenant(sp)} periodo={periodo} />;
}
