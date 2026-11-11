'use client';

import type { ReactNode } from 'react';
import { Boton, Drawer, useAbrirPorUrl } from '@/app/ui-v2/componentes';

/**
 * La configuración del agente (estrategia de insistencia y cobranza por gasto) vive en un cajón de 640, no dentro de la pantalla:
 * en Rovaq la configuración va en una página aparte o en un cajón, y el hub se queda con cifras y listas. Los formularios son los de
 * siempre (`FormaEstrategia`, `FormaPorGasto`) con sus acciones de servidor y su puerta de permisos. Se abre también por `?abrir=<id>`.
 */
export function CajonEstrategia({ id, titulo, descripcion, disparador, children }: {
  id: string;
  titulo: string;
  descripcion?: string;
  disparador: string;
  children: ReactNode;
}) {
  const { abierto, abrir, cerrar } = useAbrirPorUrl({ id });
  return (
    <>
      <Boton type="button" variante="secondary" aria-haspopup="dialog" onClick={abrir}>{disparador}</Boton>
      <Drawer abierto={abierto} onCerrar={cerrar} titulo={titulo} descripcion={descripcion} tamano="xl" cierraConFondo={false}>
        <div className="rv-cob__cajon">{children}</div>
      </Drawer>
    </>
  );
}
