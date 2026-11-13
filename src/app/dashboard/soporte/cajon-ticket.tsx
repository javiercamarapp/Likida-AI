'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Drawer } from '@/app/ui-v2/componentes';

/** CAJÓN DE LA CONVERSACIÓN de un ticket (Rovaq: cajón de 640 con el hilo y la respuesta). Nace abierto porque la URL manda (`?ticket=<id>`);
 *  al cerrar vuelve a la cola sin recargar el scroll. Foco, Esc y fondo los da `Drawer`. */
export function CajonTicket({ titulo, subtitulo, hrefCerrar, children }: { titulo: string; subtitulo?: string; hrefCerrar: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <Drawer abierto onCerrar={() => router.replace(hrefCerrar, { scroll: false })} titulo={titulo} descripcion={subtitulo} tamano="xl">
      {children}
    </Drawer>
  );
}
