'use client';

import type { PerfilTenant } from '@/lib/auth/visibilidad';
import { shell as shellEs } from '@/lib/i18n/es/shell';
import { etiquetaNav } from '@/lib/i18n/nav';
import { useT } from '@/lib/i18n/proveedor';
import MenuGuia from './menu-guia';
import BotonBuscar from './boton-buscar';
import { useMenuV2 } from './navegacion-v2';
import { hrefActivo } from './menu-por-perfil';
import { TRAZO_ICONO } from '../../ui-v2/componentes/icono';

/**
 * La topbar de escritorio (44 px), como la de Rovaq: el TÍTULO de la pantalla (icono de 15 px y el nombre
 * EXACTO de la entrada del menú, decorativo para lectores de pantalla porque el h1 de la página ya lo dice), el botón «Guía» (píldora
 * de 28 px pegada al título) y, a la derecha, el disparador visible del buscador ⌘K. La campana ya no vive aquí: es «Avisos» en el pie
 * del sidebar; la fecha se retiró. Sin miga de pan. Es contexto y atajos, no navegación (no es un landmark <nav>: el contrato e2e
 * exige UNA sola navegación). Bajo 768 px no existe (la reemplaza `CabeceraMovil`, que ya lleva su propio título).
 */
export default function CabeceraEscritorio({ rol, perfil }: { rol: string; perfil?: PerfilTenant | null }) {
  const tr = useT('shell', shellEs);
  const { pathname, menu } = useMenuV2(rol, perfil);
  const href = hrefActivo(pathname, menu);
  // Solo una pantalla que el menú del rol conoce lleva título: nunca uno inventado.
  const actual = href ? [...menu.resumen, ...menu.grupos.flatMap((g) => g.items), ...menu.pie].find((i) => i.href === href) : undefined;
  return (
    <header className="rv-cab-esc">
      <div className="rv-cab-esc__izq">
        {actual && (
          <span className="rv-cab-esc__titulo" aria-hidden>
            <actual.Icono width={15} height={15} strokeWidth={TRAZO_ICONO} aria-hidden />
            <span>{etiquetaNav(tr, actual.nombre)}</span>
          </span>
        )}
        <MenuGuia rol={rol} perfil={perfil} alineacion="inicio" />
      </div>
      <div className="rv-cab-esc__der">
        <BotonBuscar />
      </div>
    </header>
  );
}
