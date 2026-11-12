import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { perfilDeTenant } from '@/lib/auth/perfil_tenant';
import { puedeVerRuta, rutaProximamenteEnPerfil, type ModuloPerfil } from '@/lib/auth/visibilidad';
import { getT } from '@/lib/i18n/servidor';
import { sufijoTenant } from '../../sufijo';
import { ModuloSinPantalla, Proximamente } from '../proximamente';
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
  // Un módulo sin anuncio NO manda al 404 público (la sesión perdía el sidebar): vacío de página DENTRO del marco, con una salida al Resumen.
  if (!contenido) {
    const { t } = await getT('resto');
    return <ModuloSinPantalla hrefResumen={`/dashboard${sufijoTenant(sp)}`}
      textos={{ area: t('r7.prox_area'), titulo: t('r7.prox_titulo'), apoyo: t('r7.prox_apoyo'), vacio: t('r7.prox_vacio'), nota: t('r7.prox_nota'), volver: t('r7.prox_volver') }} />;
  }

  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard', sp);
  const sufijo = sufijoTenant(sp);
  const perfil = await perfilDeTenant(tenantId);
  if (!perfil || !rutaProximamenteEnPerfil(perfil, contenido.rutaReal)) redirect(`${contenido.rutaReal}${sufijo}`);
  if (!puedeVerRuta(rol, contenido.rutaReal)) redirect('/dashboard');

  return <Proximamente contenido={contenido} hrefResumen={`/dashboard${sufijo}`} />;
}

export const metadata: Metadata = { title: 'Próximamente' };
