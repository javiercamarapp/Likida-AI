'use client';

import type { PerfilTenant } from '@/lib/auth/visibilidad';
import { Logo } from '../../logo';
import { ArbolMenu, PieMenu, useMenuV2 } from './navegacion-v2';

/**
 * El sidebar de escritorio v2: 232 px (riel de 72 px entre 768 y 1023). Marca arriba, árbol de navegación que scrollea
 * por dentro y pie fijo con ítems de cuenta, tema y tarjeta de usuario. Bajo 768 px NO se ve (`display: none` en
 * `shell.css`, así que sale también del árbol de accesibilidad): ahí manda la cabecera móvil con su hoja «Más».
 *
 * Conserva el contrato de siempre: `<aside>` con `<nav>` y `<a href>` reales.
 */
export default function SidebarV2({ rol, rolEtiqueta, nombre, perfil, usoIa, cerrarSesion, insignias }: {
  rol: string; rolEtiqueta: string; nombre: string | null; perfil?: PerfilTenant | null; usoIa?: { pct: number } | null;
  cerrarSesion?: () => Promise<void>; insignias?: Record<string, string>;
}) {
  const { pathname, sufijo, menu } = useMenuV2(rol, perfil);
  return (
    <aside className="rv-sb">
      <div className="rv-sb__marca"><Logo alto="h-[18px]" /></div>
      <nav aria-label="Navegación principal" className="rv-sb__nav">
        <ArbolMenu menu={menu} sufijo={sufijo} pathname={pathname} perfil={perfil} insignias={insignias} />
      </nav>
      <div className="rv-sb__pie">
        <PieMenu menu={menu} sufijo={sufijo} pathname={pathname} perfil={perfil} rol={rol} rolEtiqueta={rolEtiqueta} nombre={nombre}
          usoIa={usoIa} cerrarSesion={cerrarSesion} insignias={insignias} />
      </div>
    </aside>
  );
}
