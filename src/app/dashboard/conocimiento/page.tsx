import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { NORMAS } from '@/lib/likida/normas/corpus';
import { VistaConocimiento } from './vista';

export const dynamic = 'force-dynamic';

/**
 * Conocimiento normativo — el corpus de `normas/` por fin visible para quien
 * tiene que firmar la declaración.
 *
 * No lee la base ni la carpeta: `NORMAS` es un módulo generado
 * (scripts/generar-normas.mjs) que viaja en el bundle. Cero IO en runtime, y
 * `corpus.test.ts` falla si se separó de los YAML.
 *
 * Es la misma para todas las flotas a propósito: la ley no es por tenant. Por
 * eso tampoco recibe `tenantId` — solo se gatea el ACCESO.
 */
export default async function PaginaConocimiento({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { rol } = await resolverTenantEfectivo('/dashboard/conocimiento', sp);
  if (!puedeVerRuta(rol, '/dashboard/conocimiento')) redirect('/dashboard');

  return <VistaConocimiento normas={NORMAS} />;
}
