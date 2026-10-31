'use client';

import { createContext, useContext } from 'react';

// El AREA del menú a la que pertenece la pantalla abierta (OPERACIÓN, AGENTES, DINERO Y FISCAL…). La calcula el marco
// (`dashboard/shell/proveedor-area.tsx`) con el MISMO menú que pinta el sidebar para ese rol y perfil, así la etiqueta que
// va sobre el título nunca diverge del menú. Fuera del marco (pruebas, v1) vale null y el encabezado no pinta etiqueta.
const Area = createContext<string | null>(null);

export const ProveedorAreaV2 = Area.Provider;

export function useArea(): string | null {
  return useContext(Area);
}

/** La etiqueta de área sobre el título: la que pasa la pantalla (si la ruta no está en el menú) o la del menú. */
export function EtiquetaArea({ area }: { area?: string }) {
  const delMenu = useArea();
  const texto = area ?? delMenu;
  if (!texto) return null;
  return <p className="rv-encabezado__rotulo etiqueta-mono">{texto}</p>;
}
