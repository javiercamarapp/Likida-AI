'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import LogoV2 from './logo-v2';
import { hrefsDelMenu } from './menu-por-perfil';
import { useMenuV2 } from './navegacion-v2';
import MenuGuia from './menu-guia';
import FechaHoy from './fecha-hoy';

/**
 * La cabecera móvil (<768 px): sticky, 56 px más el área segura de arriba (notch). Logo de 28 px de alto, «Guía» (icono, 44 px) y la
 * campana de Notificaciones. El menú completo y la barra inferior viven en `NavegacionMovil`. En escritorio no existe (`display: none`
 * en `shell.css`).
 */
export default function CabeceraMovil({ rol, perfil }: { rol: string; perfil?: PerfilTenant | null }) {
  const { sufijo, menu } = useMenuV2(rol, perfil);
  const campana = hrefsDelMenu(menu).includes('/dashboard/notificaciones');
  // El logo lleva a la «casa» del rol (su primer ítem), no a un `/dashboard` que el rol podría no abrir (el contador, bajo el perfil).
  const casa = menu.resumen[0]?.href ?? menu.grupos[0]?.items[0]?.href ?? '/dashboard';
  return (
    <header className="rv-cab-movil">
      <Link href={`${casa}${sufijo}`} className="rv-cab-movil__logo" aria-label="Likida, ir al inicio">
        <LogoV2 alto={28} />
      </Link>
      <div className="rv-cab-movil__acciones">
        <FechaHoy className="rv-cab-movil__fecha" />
        <MenuGuia rol={rol} perfil={perfil} compacto />
        {campana && (
          <Link href={`/dashboard/notificaciones${sufijo}`} className="rv-icono-boton" aria-label="Notificaciones">
            <Bell width={18} height={18} strokeWidth={1.75} aria-hidden />
          </Link>
        )}
      </div>
    </header>
  );
}
