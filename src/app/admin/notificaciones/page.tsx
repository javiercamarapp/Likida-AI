import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { leerAvisosAdmin } from '@/app/ui-v2/avisos/fuente-admin';
import { BotonEnlace, MarcoPagina } from '@/app/ui-v2/componentes';
import { BloqueCifras } from '@/app/ui-v2/esqueletos/comunes';
import { observadas } from '../sello-observado';
import { clienteAvisos } from '@/lib/avisos/cliente';
import { resolverBandeja } from '@/lib/avisos/bandeja';
import { uniformes } from '../cifras-uniformes';
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
  const seccion = sp.seccion === 'configuracion' ? 'configuracion' : 'avisos';
  // Tira de 2 (Rovaq «Avisos»): SIN LEER con el chip «Al día» en cero, y CARGADOS. Salen de la MISMA bandeja que la lista; si el estado de
  // lectura no se pudo leer, SIN LEER dice «No disponible», nunca 0.
  const bandeja = seccion === 'avisos' ? await resolverBandeja(clienteAvisos(), { tipo: 'admin' }, s.userId, fuente).catch(() => null) : null;
  const cifras = seccion === 'avisos' && bandeja
    ? observadas(uniformes([
      bandeja.errorLeidas !== null
        ? { etiqueta: t('notif.sin_leer'), valor: null, estado: 'error' as const }
        : { etiqueta: t('notif.sin_leer'), valor: bandeja.noLeidos, formato: 'entero' as const, tono: bandeja.noLeidos === 0 ? 'ok' as const : bandeja.hayCritico ? 'bad' as const : 'warn' as const },
      { etiqueta: t('notif.cargados'), valor: bandeja.avisos.length, formato: 'entero' as const },
    ]), t('a1r4.observado'))
    : undefined;
  // BA de Rovaq: cabecera con «Configurar avisos» → cifras → bandeja. Sin la segunda fila de pestañas (la configuración es una acción de la cabecera).
  const href = seccion === 'configuracion' ? '/admin/notificaciones' : '/admin/notificaciones?seccion=configuracion';
  return (
    <MarcoPagina
      className="rv-esq rv-esq--tabla adm-notif" area="Sistema" titulo={t('notif.titulo')} apoyo={t('notif.apoyo')}
      acciones={<BotonEnlace href={href} variante="secondary">{seccion === 'configuracion' ? t('notif.seccion.avisos') : t('notif.seccion.config')}</BotonEnlace>}
    >
      <BloqueCifras cifras={cifras} etiqueta={t('notif.resumen')} />
      <PaginaAvisos
        destino={{ panel: 'admin' }} ambito={{ tipo: 'admin' }} userId={s.userId} fuente={fuente}
        base="/admin/notificaciones" params={{}} sufijo="" seccion={seccion} conPestanas={false}
      />
    </MarcoPagina>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('avisos');
  return { title: t('notif.titulo') };
}
