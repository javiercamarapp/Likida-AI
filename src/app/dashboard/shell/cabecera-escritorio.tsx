'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Bell, ChevronsLeft } from 'lucide-react';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import { TZ_MX } from '@/lib/formato';
import { HREF_NOTIFICACIONES, hrefActivo, hrefsDelMenu } from './menu-por-perfil';
import { useMenuV2 } from './navegacion-v2';
import { useRiel } from './colapso';
import MenuGuia from './menu-guia';

/** «31 oct 2026», es-MX, zona de México. Vacío en el servidor: se pinta al hidratar (sin desajuste de hidratación). */
function fechaDeHoy(): string {
  const partes = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ_MX }).formatToParts(new Date());
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return `${v('day')} ${v('month').replace('.', '')} ${v('year')}`;
}
const sinSuscripcion = () => () => {};

/**
 * La topbar de escritorio (44 px, ESTILO §4): botón de plegar/expandir el sidebar a la izquierda y, a la derecha, «Guía» (menú),
 * Notificaciones y la fecha de hoy. Sin miga de pan: la etiqueta del área vive sobre el título de cada página (`EncabezadoPagina`).
 * Sin buscador ni avatar. Es contexto y atajos, no navegación (por eso no es un landmark <nav>: el contrato e2e exige UNA sola
 * navegación). Bajo 768 px no existe (la reemplaza `CabeceraMovil`).
 */
export default function CabeceraEscritorio({ rol, perfil, insignias }: { rol: string; perfil?: PerfilTenant | null; insignias?: Record<string, string> }) {
  const { pathname, sufijo, menu } = useMenuV2(rol, perfil);
  const { riel, alternar } = useRiel();
  const fecha = useSyncExternalStore(sinSuscripcion, fechaDeHoy, () => '');
  const campana = hrefsDelMenu(menu).includes(HREF_NOTIFICACIONES);
  const pendientes = /^\d+$/.test(insignias?.[HREF_NOTIFICACIONES] ?? '') && Number(insignias?.[HREF_NOTIFICACIONES]) > 0;
  const enNotificaciones = hrefActivo(pathname, menu) === HREF_NOTIFICACIONES;
  return (
    <header className="rv-cab-esc">
      <button type="button" className="rv-icono-boton rv-cab-esc__plegar" onClick={alternar} aria-label={riel ? 'Expandir el menú' : 'Plegar el menú'}
        title={riel ? 'Expandir el menú' : 'Plegar el menú'} aria-expanded={!riel}>
        <ChevronsLeft className="rv-chev-plegar" width={16} height={16} strokeWidth={1.75} aria-hidden />
      </button>
      <div className="rv-cab-esc__der">
        <MenuGuia rol={rol} perfil={perfil} />
        {campana && (
          <Link href={`${HREF_NOTIFICACIONES}${sufijo}`} className="rv-icono-boton rv-campana" aria-current={enNotificaciones ? 'page' : undefined}
            aria-label={pendientes ? 'Notificaciones, hay pendientes' : 'Notificaciones'} title="Notificaciones" data-tour="nav-notificaciones">
            <Bell width={16} height={16} strokeWidth={1.75} aria-hidden />
            {pendientes && <span className="rv-campana__punto" aria-hidden />}
          </Link>
        )}
        <time className="rv-cab-esc__fecha" suppressHydrationWarning>{fecha}</time>
      </div>
    </header>
  );
}
