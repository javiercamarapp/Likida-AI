import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { getT } from '@/lib/i18n/servidor';
import { VistaDescargaSat } from './vista';
import type { Metadata } from 'next';
export async function generateMetadata(): Promise<Metadata> {
  const { t: tr } = await getT('dinero');
  return { title: tr('meta.descargaSat') };
}

export const dynamic = 'force-dynamic';

/**
 * DESCARGA DEL SAT (0231). Área `dinero`: se declara un RFC y se consume el
 * tope diario que ese contribuyente tiene ante el SAT — no es una pantalla de
 * despacho. `resolverTenantEfectivo` recibe la ruta y gatea con `puedeVerRuta`
 * contra AREA_POR_RUTA, igual que /dashboard/contador y /dashboard/timbrado.
 *
 * El contenido vive en `vista.tsx` exportado por las dos razones de siempre:
 * Next rechaza exports extra en una Page, y sin export el preview headless no
 * puede montar el componente REAL sin sesión.
 */
export default async function DescargaSatPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantExiste } = await resolverTenantEfectivo('/dashboard/descarga-sat', sp);
  return <VistaDescargaSat searchParams={sp} tenantExiste={tenantExiste} />;
}
