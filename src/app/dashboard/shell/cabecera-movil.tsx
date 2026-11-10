'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import LogoV2 from './logo-v2';
import { ALTO_LOGO_PX } from '../../marco-v2';
import { hrefsDelMenu } from './menu-por-perfil';
import { useMenuV2 } from './navegacion-v2';
import MenuGuia from './menu-guia';
import FechaHoy from './fecha-hoy';
import { TRAZO_ICONO } from '../../ui-v2/componentes/icono';

/**
 * La cabecera móvil (<768 px): sticky, 56 px más el área segura de arriba (notch). Logo de 22 px de alto (`ALTO_LOGO_PX.movil`), «Guía» (icono, 44 px) y la
 * campana de Notificaciones. El menú completo y la barra inferior viven en `NavegacionMovil`. En escritorio no existe (`display: none`
 * en `shell.css`).
 */
export default function CabeceraMovil({ rol, perfil }: { rol: string; perfil?: PerfilTenant | null }) {
  const { sufijo, menu } = useMenuV2(rol, perfil);
  const campana = hrefsDelMenu(menu).includes('/dashboard/notificaciones');
  // El logo lleva a la «casa» del rol (su primer ítem), no a un `/dashboard` que el rol podría no abrir (el contador, bajo el perfil).
  const casa = menu.resumen[0]?.href ?? menu.grupos[0]?.items[0]?.href ?? '/dashboard';
  return (
    <CabeceraMovilVista hrefCasa={`${casa}${sufijo}`} hrefAvisos={campana ? `/dashboard/notificaciones${sufijo}` : null}>
      <MenuGuia rol={rol} perfil={perfil} compacto />
    </CabeceraMovilVista>
  );
}

/** El dibujo de la cabecera móvil, sin saber de qué panel es: lo comparten /dashboard y /admin. `children` van entre la fecha y la campana. */
export function CabeceraMovilVista({ hrefCasa, hrefAvisos, etiquetaAvisos = 'Notificaciones', punto = false, children }: {
  hrefCasa: string; hrefAvisos: string | null; etiquetaAvisos?: string; punto?: boolean; children?: React.ReactNode;
}) {
  return (
    <header className="rv-cab-movil">
      <Link href={hrefCasa} className="rv-cab-movil__logo" aria-label="Likida, ir al inicio">
        <LogoV2 alto={ALTO_LOGO_PX.movil} />
      </Link>
      <div className="rv-cab-movil__acciones">
        <FechaHoy className="rv-cab-movil__fecha" />
        {children}
        {hrefAvisos && (
          <Link href={hrefAvisos} className="rv-icono-boton" aria-label={etiquetaAvisos} title={etiquetaAvisos}>
            <Bell width={18} height={18} strokeWidth={TRAZO_ICONO} aria-hidden />
            {punto && <span className="rv-campana__punto" aria-hidden />}
          </Link>
        )}
      </div>
    </header>
  );
}
