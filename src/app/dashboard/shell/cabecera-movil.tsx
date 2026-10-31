'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import LogoV2 from './logo-v2';
import { hrefsDelMenu } from './menu-por-perfil';
import { useMenuV2 } from './navegacion-v2';
import HojaMas from './hoja-mas';
import BarraInferior from './barra-inferior';
import MenuGuia from './menu-guia';

/**
 * La navegación móvil (<768 px): cabecera sticky de 56 px más el área segura de arriba (notch) con el logo de 28 px de alto, «Guía» y la
 * campana de 44 de Notificaciones; la barra inferior flotante (4 destinos del rol + «Más») y la hoja «Más», que abre el árbol completo
 * y el pie (tema + cuenta). La hoja la abre la barra: su estado vive aquí para que cabecera, barra y hoja sean una sola pieza. En
 * escritorio nada de esto existe (`display: none` en `shell.css`).
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
          <MenuGuia rol={rol} perfil={perfil} compacto />
          {campana && (
            <Link href={`/dashboard/notificaciones${sufijo}`} className="rv-icono-boton" aria-label="Notificaciones">
              <Bell width={18} height={18} strokeWidth={1.75} aria-hidden />
            </Link>
          )}
        </div>
      </header>
      <BarraInferior rol={rol} perfil={perfil} masAbierta={abierta} alAbrirMas={() => setAbierta(true)} />
      <HojaMas abierta={abierta} alCerrar={() => setAbierta(false)} rol={rol} rolEtiqueta={rolEtiqueta} nombre={nombre} perfil={perfil}
        usoIa={usoIa} cerrarSesion={cerrarSesion} insignias={insignias} />
    </>
  );
}
