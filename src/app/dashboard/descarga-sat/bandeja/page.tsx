import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { VistaBandejaSat } from './vista';

export const dynamic = 'force-dynamic';

/**
 * LA BANDEJA DE CONCILIACIÓN DEL SAT (0243). Área `dinero`, como su pantalla
 * hermana: aquí no solo se ven las cifras del buzón fiscal — se DECIDE cuál
 * comprobante ampara cuál gasto, que es afirmar una deducción.
 * `resolverTenantEfectivo` recibe la ruta y gatea con `puedeVerRuta` contra
 * AREA_POR_RUTA; cada server action vuelve a gatear adentro, con `puedeVerArea`
 * además (el molde de `api/export/poliza`, hallazgo SEG-19-1).
 *
 * El contenido vive en `vista.tsx` exportado por las dos razones de siempre:
 * Next rechaza exports extra en una Page, y sin export el preview headless no
 * puede montar el componente REAL sin sesión.
 */
export default async function BandejaSatPage({
  searchParams,
}: {
  searchParams: Promise<{
    vista?: string; tenant?: string; rol?: string;
    estatus?: string; pag?: string;
    buscar?: string; bimporte?: string; bdesde?: string; bhasta?: string; btexto?: string;
  }>;
}) {
  const sp = await searchParams;
  const { tenantExiste } = await resolverTenantEfectivo('/dashboard/descarga-sat/bandeja', sp);
  return <VistaBandejaSat searchParams={sp} tenantExiste={tenantExiste} />;
}
