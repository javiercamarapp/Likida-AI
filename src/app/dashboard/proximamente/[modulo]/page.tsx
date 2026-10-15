import { notFound, redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { perfilDeTenant } from '@/lib/auth/perfil_tenant';
import { puedeVerRuta, rutaProximamenteEnPerfil, type ModuloPerfil } from '@/lib/auth/visibilidad';
import { sufijoTenant } from '../../sufijo';
import { Proximamente } from '../proximamente';
import { CONTENIDO_PROXIMAMENTE } from '../contenido';

export const dynamic = 'force-dynamic';

/**
 * «PRÓXIMAMENTE» (fase 1 del perfil `cinco_agentes`): la página que se sirve en
 * lugar de la pantalla real de un módulo que todavía no se enciende para la
 * cuenta (vigía y conductor). SIN DATOS: lo único que lee es la sesión y el
 * perfil de la flota; el contenido es texto fijo (`contenido.ts`).
 *
 *  · Sin perfil, o con el módulo ya encendido → manda a la pantalla real.
 *  · Un rol que no podría ver la pantalla real tampoco ve este anuncio.
 *  · Se gatea con `/dashboard` (siempre permitido bajo el perfil): no hay bucle.
 */
export default async function PaginaProximamente({
  params, searchParams,
}: {
  params: Promise<{ modulo: string }>;
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const [{ modulo }, sp] = await Promise.all([params, searchParams]);
  const contenido = CONTENIDO_PROXIMAMENTE[modulo as ModuloPerfil];
  if (!contenido) notFound();

  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard', sp);
  const sufijo = sufijoTenant(sp);
  const perfil = await perfilDeTenant(tenantId);
  if (!perfil || !rutaProximamenteEnPerfil(perfil, contenido.rutaReal)) redirect(`${contenido.rutaReal}${sufijo}`);
  if (!puedeVerRuta(rol, contenido.rutaReal)) redirect('/dashboard');

  return <Proximamente contenido={contenido} hrefResumen={`/dashboard${sufijo}`} />;
}
