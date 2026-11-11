'use client';

import { createContext, useContext } from 'react';
import { ChevronsLeft } from 'lucide-react';
import { useRiel } from '../dashboard/shell/colapso';
import { TRAZO_ICONO } from '../ui-v2/componentes/icono';
import type { RequiereAccion } from './requiere-accion';

const ContextoRequiereAccion = createContext<RequiereAccion | undefined>(undefined);

/** El layout (servidor) resuelve el dato y lo da por aquí: así `chrome.tsx` no necesita props nuevas. */
export function ProveedorRequiereAccion({ valor, children }: { valor: RequiereAccion; children: React.ReactNode }) {
  return <ContextoRequiereAccion.Provider value={valor}>{children}</ContextoRequiereAccion.Provider>;
}

/** El texto de la campana para lectores de pantalla y el tooltip. `null` = lectura caída: «sin dato», nunca «0». */
export function etiquetaCampana(r: RequiereAccion | undefined): string {
  if (!r) return 'Notificaciones';
  if (r.pendientes === null) return 'Notificaciones: sin dato';
  if (r.pendientes === 0) return 'Notificaciones: nada pendiente';
  const n = `${r.pendientes} ${r.pendientes === 1 ? 'pendiente' : 'pendientes'}`;
  return `Notificaciones: ${n}${r.hayUrgente ? ', hay algo urgente' : ''}`;
}

/** Lo que «Avisos» del pie del sidebar lee del proveedor (el layout lo resuelve en el servidor). */
export function useRequiereAccion(): RequiereAccion | undefined {
  return useContext(ContextoRequiereAccion);
}

/**
 * La cabecera de /admin, como la de Rovaq y como la del dashboard (`CabeceraEscritorio`, clases `.rv-cab-esc`): solo el botón de
 * plegar/expandir el menú. Sin ese botón, al plegar el sidebar a riel no habría NINGÚN control para volver a abrirlo. La campana y la
 * fecha se retiraron: la campana vive como «Avisos» en el pie del sidebar (mismo conteo real, `useRequiereAccion`; lectura caída =
 * «sin dato», nunca 0). Entre 768 y 1023 px el riel es obligatorio por CSS y el botón se oculta.
 */
export default function CabeceraAdmin() {
  const { riel, alternar } = useRiel();
  return (
    <header className="rv-cab-esc">
      <div className="rv-cab-esc__izq">
        <button type="button" className="rv-icono-boton rv-cab-esc__plegar" onClick={alternar} aria-label={riel ? 'Expandir el menú' : 'Plegar el menú'}
          title={riel ? 'Expandir el menú' : 'Plegar el menú'} aria-expanded={!riel}>
          <ChevronsLeft className="rv-chev-plegar" width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
        </button>
      </div>
    </header>
  );
}
