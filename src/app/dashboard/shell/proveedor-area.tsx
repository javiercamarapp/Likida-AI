'use client';

import type { ReactNode } from 'react';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import { ProveedorAreaV2 } from '../../ui-v2/componentes/contexto-area';
import { useMenuV2 } from './navegacion-v2';
import { areaDeRuta } from './area-de-ruta';

/** Calcula el área de la pantalla abierta con el menú del rol/perfil (el que ya pinta el sidebar) y la ofrece al encabezado. */
export default function ProveedorArea({ rol, perfil, children }: { rol: string; perfil?: PerfilTenant | null; children: ReactNode }) {
  const { pathname, menu } = useMenuV2(rol, perfil);
  return <ProveedorAreaV2 value={areaDeRuta(pathname, menu)}>{children}</ProveedorAreaV2>;
}
