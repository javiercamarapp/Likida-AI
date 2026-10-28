'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import { hrefActivo, hrefsDelMenu } from './menu-por-perfil';
import { useMenuV2 } from './navegacion-v2';

/**
 * La cabecera de escritorio (44 px): dónde estás (el nombre del ítem activo del menú) y la campana de Notificaciones.
 * Es contexto, no navegación: no repite enlaces del sidebar salvo la campana, que es el único acceso rápido.
 * Bajo 768 px no existe (la reemplaza `CabeceraMovil`).
 */
export default function CabeceraEscritorio({ rol, perfil }: { rol: string; perfil?: PerfilTenant | null }) {
  const { pathname, sufijo, menu } = useMenuV2(rol, perfil);
  const activo = hrefActivo(pathname, menu);
  const todos = [...menu.resumen, ...menu.grupos.flatMap((g) => g.items), ...menu.pie];
  const titulo = todos.find((i) => i.href === activo)?.nombre ?? '';
  const campana = hrefsDelMenu(menu).includes('/dashboard/notificaciones');
  return (
    <header className="rv-cab-esc">
      <div className="rv-cab-esc__titulo">{titulo}</div>
      {campana && (
        <Link href={`/dashboard/notificaciones${sufijo}`} className="rv-icono-boton" aria-label="Notificaciones" title="Notificaciones">
          <Bell width={16} height={16} strokeWidth={1.75} aria-hidden />
        </Link>
      )}
    </header>
  );
}
