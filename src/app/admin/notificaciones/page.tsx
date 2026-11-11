import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { leerAvisosAdmin } from '@/lib/avisos/fuente-admin';
import { MarcoPagina } from '@/app/ui-v2/componentes';
import PaginaAvisos from '@/app/ui-v2/avisos/pagina-avisos';
import { getT } from '@/lib/i18n/servidor';

export const dynamic = 'force-dynamic';

/**
 * /admin/notificaciones — los avisos de la consola, clonados del panel de Rovaq: pestañas No leídas / Leídas / Todas, origen, hora,
 * enlace a la pantalla que lo resuelve, marcar leído, filtros y su configuración (`?seccion=configuracion`).
 *
 * Una sola fuente de verdad: la lista sale de `leerAvisosAdmin` y el número de «Avisos» del pie sale de la MISMA bandeja
 * (`resolverBandeja`, ver `admin/layout.tsx`). El estado «leído» es por persona y vive en la base (mig. 1002), ya no en localStorage.
 */
export default async function NotificacionesPage({ searchParams }: { searchParams?: Promise<{ seccion?: string }> }) {
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  const s = await requireSuperadmin();
  const sp = (await searchParams) ?? {};
  const fuente = await leerAvisosAdmin();
  const { t } = await getT('avisos');
  return (
    <MarcoPagina titulo={t('notif.titulo')} apoyo={t('notif.apoyo')}>
      <PaginaAvisos
        destino={{ panel: 'admin' }} ambito={{ tipo: 'admin' }} userId={s.userId} fuente={fuente}
        base="/admin/notificaciones" params={{}} sufijo="" seccion={sp.seccion === 'configuracion' ? 'configuracion' : 'avisos'}
      />
    </MarcoPagina>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('avisos');
  return { title: t('notif.titulo') };
}
