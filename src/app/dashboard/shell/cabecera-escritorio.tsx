'use client';

import { PanelLeft } from 'lucide-react';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import { hrefActivo } from './menu-por-perfil';
import { useMenuV2 } from './navegacion-v2';
import { useRiel } from './colapso';

/**
 * La topbar de escritorio (44 px, ESTILO §4): botón de plegar/expandir el sidebar + breadcrumb 13/500 (categoría / ítem activo,
 * con el icono del ítem). Es contexto, no navegación (por eso un <div>, no un landmark <nav>: el contrato e2e exige UNA sola navegación): sin buscador, sin campana (Notificaciones vive en el pie del sidebar), sin
 * avatar y sin acciones de página. Bajo 768 px no existe (la reemplaza `CabeceraMovil`).
 */
export default function CabeceraEscritorio({ rol, perfil }: { rol: string; perfil?: PerfilTenant | null }) {
  const { pathname, menu } = useMenuV2(rol, perfil);
  const { riel, alternar } = useRiel();
  const activo = hrefActivo(pathname, menu);
  const grupo = menu.grupos.find((g) => g.items.some((i) => i.href === activo));
  const item = [...menu.resumen, ...menu.grupos.flatMap((g) => g.items), ...menu.pie].find((i) => i.href === activo);
  return (
    <header className="rv-cab-esc">
      <button type="button" className="rv-icono-boton rv-cab-esc__plegar" onClick={alternar} aria-label={riel ? 'Expandir el menú' : 'Plegar el menú'}
        title={riel ? 'Expandir el menú' : 'Plegar el menú'} aria-expanded={!riel}>
        <PanelLeft width={16} height={16} strokeWidth={1.75} aria-hidden />
      </button>
      {item && (
        <div className="rv-migas">
          {grupo && <><span className="rv-migas__cat">{grupo.titulo}</span><span className="rv-migas__sep" aria-hidden>/</span></>}
          <span className="rv-migas__act"><item.Icono width={16} height={16} strokeWidth={1.75} aria-hidden />{item.nombre}</span>
        </div>
      )}
    </header>
  );
}
