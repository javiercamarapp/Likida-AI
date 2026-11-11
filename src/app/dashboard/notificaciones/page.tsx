import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { leerAvisosFlota } from '@/lib/avisos/fuente-flota';
import { MarcoPagina } from '@/app/ui-v2/componentes';
import PaginaAvisos from '@/app/ui-v2/avisos/pagina-avisos';
import { sufijoTenant } from '../sufijo';
import { getT } from '@/lib/i18n/servidor';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('operacion');
  return { title: t('meta.notificaciones') };
}

export const dynamic = 'force-dynamic';

/**
 * AVISOS DE LA FLOTA — «lo que requiere a un humano HOY», con la misma pantalla que /admin/notificaciones (clon del panel de Rovaq):
 * pestañas No leídas / Leídas / Todas, origen, hora, enlace a la pantalla que lo resuelve, marcar leído, filtros y configuración
 * (`?seccion=configuracion`). Las señales se leen en `lib/avisos/fuente-flota.ts` (cada una falla por su lado: `catch → null`, jamás 0),
 * la MISMA función que usa el pie del panel para su número, así que no pueden discrepar.
 */
export default async function PaginaNotificaciones({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; seccion?: string }>;
}) {
  const sp = await searchParams;
  const t = await resolverTenantEfectivo('/dashboard/notificaciones', sp);
  if (!puedeVerRuta(t.rol, '/dashboard/notificaciones')) redirect('/dashboard');

  const fuente = await leerAvisosFlota(t.tenantId, t.rol);
  const params: Record<string, string> = {};
  if (sp.tenant) params.tenant = sp.tenant; else if (sp.vista) params.vista = sp.vista;
  if (sp.rol) params.rol = sp.rol;
  const { t: tr } = await getT('avisos');
  return (
    <MarcoPagina titulo={tr('notif.titulo')} apoyo={tr('notif.apoyo')}>
      <PaginaAvisos
        destino={{ panel: 'flota', tenant: sp.tenant ?? null }} ambito={{ tipo: 'flota', tenantId: t.tenantId }} userId={t.userId} fuente={fuente}
        base="/dashboard/notificaciones" params={params} sufijo={sufijoTenant(sp)} seccion={sp.seccion === 'configuracion' ? 'configuracion' : 'avisos'}
      />
    </MarcoPagina>
  );
}
