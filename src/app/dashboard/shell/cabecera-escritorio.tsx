'use client';

import { ChevronsLeft } from 'lucide-react';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import { useRiel } from './colapso';
import MenuGuia from './menu-guia';
import { TRAZO_ICONO } from '../../ui-v2/componentes/icono';

/**
 * La topbar de escritorio (44 px), como la de Rovaq: el botón de plegar/expandir el sidebar y, JUNTO a él, el botón «Guía» (píldora de
 * 28 px; en Rovaq va justo después del título y no al extremo derecho). La campana ya no vive aquí: es «Avisos» en el pie del sidebar
 * (`ui-v2/componentes/pie-sidebar.tsx`), con el mismo conteo; y la fecha de hoy se retiró. Sin miga de pan ni buscador. Es contexto y
 * atajos, no navegación (no es un landmark <nav>: el contrato e2e exige UNA sola navegación). Bajo 768 px no existe (la reemplaza `CabeceraMovil`).
 */
export default function CabeceraEscritorio({ rol, perfil }: { rol: string; perfil?: PerfilTenant | null }) {
  const { riel, alternar } = useRiel();
  return (
    <header className="rv-cab-esc">
      <div className="rv-cab-esc__izq">
        <button type="button" className="rv-icono-boton rv-cab-esc__plegar" onClick={alternar} aria-label={riel ? 'Expandir el menú' : 'Plegar el menú'}
          title={riel ? 'Expandir el menú' : 'Plegar el menú'} aria-expanded={!riel}>
          <ChevronsLeft className="rv-chev-plegar" width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
        </button>
        <MenuGuia rol={rol} perfil={perfil} alineacion="inicio" />
      </div>
    </header>
  );
}
