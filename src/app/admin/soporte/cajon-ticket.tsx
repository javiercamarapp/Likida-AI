'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Drawer } from '../../ui-v2/componentes';

/** El ticket elegido (`?ticket=`) en el cajón de 640 de Rovaq («Soporte»: hilo y respuesta). El servidor ya leyó y armó el contenido; aquí solo
 *  se abre y se cierra: al cerrar vuelve a la cola sin recargar el scroll. Foco, Esc, fondo y hoja inferior en móvil los da `Drawer`. */
export function CajonTicket({ titulo, descripcion, hrefCerrar, children }: { titulo: string; descripcion?: string; hrefCerrar: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <Drawer abierto onCerrar={() => router.replace(hrefCerrar, { scroll: false })} titulo={titulo} descripcion={descripcion} tamano="xl">
      {children}
    </Drawer>
  );
}
