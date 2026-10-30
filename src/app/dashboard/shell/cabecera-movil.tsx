'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bell, Menu } from 'lucide-react';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import LogoV2 from './logo-v2';
import { hrefsDelMenu } from './menu-por-perfil';
import { useMenuV2 } from './navegacion-v2';
import HojaMas from './hoja-mas';

/**
 * La cabecera móvil (<768 px): sticky, 56 px más el área segura de arriba (notch). Logo de 28 px de alto, campana de 44 de Notificaciones y el
 * botón «Más», que abre la hoja con el árbol completo. En escritorio no existe (`display: none` en `shell.css`).
 */
export default function CabeceraMovil({ rol, rolEtiqueta, nombre, perfil, usoIa, cerrarSesion, insignias }: {
  rol: string; rolEtiqueta: string; nombre: string | null; perfil?: PerfilTenant | null; usoIa?: { pct: number } | null;
  cerrarSesion?: () => Promise<void>; insignias?: Record<string, string>;
}) {
  const [abierta, setAbierta] = useState(false);
  const { sufijo, menu } = useMenuV2(rol, perfil);
  const campana = hrefsDelMenu(menu).includes('/dashboard/notificaciones');
  // El logo lleva a la «casa» del rol (su primer ítem), no a un `/dashboard` que el rol podría no abrir (el contador, bajo el perfil).
  const casa = menu.resumen[0]?.href ?? menu.grupos[0]?.items[0]?.href ?? '/dashboard';
  return (
    <>
      <header className="rv-cab-movil">
        <Link href={`${casa}${sufijo}`} className="rv-cab-movil__logo" aria-label="Likida, ir al inicio">
          <LogoV2 alto={28} />
        </Link>
        <div className="rv-cab-movil__acciones">
          {campana && (
            <Link href={`/dashboard/notificaciones${sufijo}`} className="rv-icono-boton" aria-label="Notificaciones">
              <Bell width={18} height={18} strokeWidth={1.75} aria-hidden />
            </Link>
          )}
          <button type="button" className="rv-icono-boton" aria-label="Más: abrir el menú completo" aria-haspopup="dialog" data-tour="nav-mas"
            aria-expanded={abierta} onClick={() => setAbierta(true)}>
            <Menu width={18} height={18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </header>
      <HojaMas abierta={abierta} alCerrar={() => setAbierta(false)} rol={rol} rolEtiqueta={rolEtiqueta} nombre={nombre} perfil={perfil}
        usoIa={usoIa} cerrarSesion={cerrarSesion} insignias={insignias} />
    </>
  );
}
