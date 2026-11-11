import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { leerAvisosFlota } from '@/app/ui-v2/avisos/fuente-flota';
import { BotonEnlace, MarcoPagina } from '@/app/ui-v2/componentes';
import { BloqueCifras } from '@/app/ui-v2/esqueletos';
import { clienteAvisos } from '@/lib/avisos/cliente';
import { resolverBandeja } from '@/lib/avisos/bandeja';
import './notificaciones.css';
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
 * (`?seccion=configuracion`). Las señales se leen en `ui-v2/avisos/fuente-flota.ts` (cada una falla por su lado: `catch → null`, jamás 0),
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
  const enConfiguracion = sp.seccion === 'configuracion';
  // La tira de dos cifras (SIN LEER · CARGADOS) sale de la MISMA bandeja que pinta la lista y el número del pie. Una lectura caída es
  // «No disponible ahora. No es cero.», nunca un 0. (Pedido compartido: llevar esta lectura dentro de `PaginaAvisos` para no leer dos veces.)
  const bandeja = enConfiguracion ? null : await resolverBandeja(clienteAvisos(), { tipo: 'flota', tenantId: t.tenantId }, t.userId, fuente);
  const qs = new URLSearchParams(params);
  if (!enConfiguracion) qs.set('seccion', 'configuracion');
  const href = `/dashboard/notificaciones${qs.toString() ? `?${qs}` : ''}`;
  return (
    <MarcoPagina titulo={tr('notif.titulo')} apoyo={tr('notif.apoyo')}
      acciones={<BotonEnlace href={href} variante="secondary" tamano="sm">{enConfiguracion ? tr('notif.seccion.avisos') : tr('e26b.avisos_configurar')}</BotonEnlace>}>
      <div className="rv-notif">
      {bandeja ? (
        <BloqueCifras etiqueta={tr('notif.titulo')} cifras={[
          bandeja.noLeidos === null
            ? { etiqueta: tr('e26b.avisos_sin_leer'), valor: null, estado: 'error', reintentar: true }
            : { etiqueta: tr('e26b.avisos_sin_leer'), valor: bandeja.noLeidos, nota: tr('e26b.avisos_sin_leer_nota'), tono: bandeja.hayCritico ? 'bad' : undefined },
          { etiqueta: tr('e26b.avisos_cargados'), valor: bandeja.avisos.length, nota: tr('e26b.avisos_cargados_nota') },
        ]} />
      ) : null}
      <PaginaAvisos
        destino={{ panel: 'flota', tenant: sp.tenant ?? null }} ambito={{ tipo: 'flota', tenantId: t.tenantId }} userId={t.userId} fuente={fuente}
        base="/dashboard/notificaciones" params={params} sufijo={sufijoTenant(sp)} seccion={sp.seccion === 'configuracion' ? 'configuracion' : 'avisos'} conPestanas={false}
      />
      </div>
    </MarcoPagina>
  );
}
