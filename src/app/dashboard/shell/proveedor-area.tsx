'use client';

import { useMemo, type ReactNode } from 'react';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import { ProveedorAreaV2 } from '../../ui-v2/componentes/contexto-area';
import { ProveedorPestanasHub, type ValorPestanasHub } from '../../ui-v2/componentes/pestanas-hub';
import { useMenuV2 } from './navegacion-v2';
import { areaDeRuta } from './area-de-ruta';
import { hrefActivo, type MenuV2 } from './menu-por-perfil';

/** Las pestañas del ítem activo del menú (`pestanas` en `rutas.ts`), o null si el ítem no las trae (hoy ninguno: el dashboard las irá declarando). */
export function pestanasDeRuta(pathname: string, menu: MenuV2): ValorPestanasHub | null {
  const href = hrefActivo(pathname, menu);
  if (!href) return null;
  const item = [...menu.resumen, ...menu.grupos.flatMap((g) => g.items), ...menu.pie].find((i) => i.href === href);
  const pestanas = item?.pestanas;
  if (!item || !pestanas || pestanas.length < 2) return null;
  const actual = [...pestanas].filter((p) => pathname === p.href || pathname.startsWith(`${p.href}/`)).sort((a, b) => b.href.length - a.href.length)[0];
  return { etiqueta: `Secciones de ${item.nombre}`, actual: actual?.href ?? pestanas[0].href, pestanas };
}

/** Calcula el área de la pantalla abierta con el menú del rol/perfil (el que ya pinta el sidebar) y la ofrece al encabezado; ofrece también las pestañas del ítem activo a `MarcoPagina`. */
export default function ProveedorArea({ rol, perfil, children }: { rol: string; perfil?: PerfilTenant | null; children: ReactNode }) {
  const { pathname, menu } = useMenuV2(rol, perfil);
  const valor = useMemo(() => pestanasDeRuta(pathname, menu), [pathname, menu]);
  return (
    <ProveedorAreaV2 value={areaDeRuta(pathname, menu)}>
      <ProveedorPestanasHub valor={valor} claseRespaldo="rv-pestanas-dash">{children}</ProveedorPestanasHub>
    </ProveedorAreaV2>
  );
}
