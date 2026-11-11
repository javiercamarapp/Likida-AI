'use client';

import { KeyRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { Boton, Drawer, Icono, useAbrirPorUrl } from '@/app/ui-v2/componentes';

/** «Emitir llave» en CAJÓN (Rovaq: el alta vive en un cajón de 420, no en una tarjeta al pie). El cajón NO se cierra al emitir: el secreto de la
 *  llave existe solo en esa respuesta (`SecretoUnaVez`) y cerrarlo lo tiraría antes de que se copie. Se abre con el botón o con `?abrir=emitir-llave`. */
export function CajonEmitirLlave({ titulo, disparador, descripcion, abiertoInicial = false, children }: {
  titulo: string;
  disparador: string;
  descripcion?: string;
  abiertoInicial?: boolean;
  children: ReactNode;
}) {
  const { abierto, abrir, cerrar } = useAbrirPorUrl({ id: 'emitir-llave', abiertoInicial });
  return (
    <div className="rv-lla__barra">
      <Boton variante="primary" tamano="sm" aria-haspopup="dialog" icono={<Icono icono={KeyRound} />} onClick={abrir}>{disparador}</Boton>
      <Drawer abierto={abierto} onCerrar={cerrar} titulo={titulo} descripcion={descripcion} tamano="m" cierraConFondo={false}>{children}</Drawer>
    </div>
  );
}
