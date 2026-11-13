'use client';

import type { ReactNode } from 'react';
import { Boton, Drawer, useAbrirPorUrl, type TamanoDrawer } from '@/app/ui-v2/componentes';

/**
 * EL CAJÓN DE ALTA DE LOS REGISTROS (F26, paquete B). Rovaq da de alta en un cajón lateral abierto desde el botón primario de la
 * cabecera de página; aquí lo mismo: el botón (alto 28-32, un solo primario por zona) abre un `Drawer` cuyo cuerpo es el formulario que la
 * página ya tenía (con su propio botón de guardar y su aviso de resultado, que NO cambian: la acción de servidor y sus puertas de permiso
 * siguen siendo las de siempre). Se abre también por `?abrir=<id>` (enlace profundo), igual que `FormaEnCajon`.
 */
export function CajonAlta({ id, titulo, descripcion, disparador, primario = false, variante, tamano = 'm', abiertoInicial = false, children }: {
  /** Estable: lo que va en `?abrir=<id>`. */
  id: string;
  titulo: string;
  descripcion?: string;
  /** El texto del botón que lo abre. */
  disparador: string;
  /** El botón de la cabecera de página es el primario de la zona; el resto, secundarios. */
  primario?: boolean;
  /** Para el disparador dentro de una fila de tabla (`ghost`); por omisión sigue a `primario`. */
  variante?: 'primary' | 'secondary' | 'ghost';
  tamano?: TamanoDrawer;
  abiertoInicial?: boolean;
  children: ReactNode;
}) {
  const { abierto, abrir, cerrar } = useAbrirPorUrl({ id, abiertoInicial });
  return (
    <>
      <Boton type="button" variante={variante ?? (primario ? 'primary' : 'secondary')} aria-haspopup="dialog" onClick={abrir}>{disparador}</Boton>
      <Drawer abierto={abierto} onCerrar={cerrar} titulo={titulo} descripcion={descripcion} tamano={tamano} cierraConFondo={false}>
        {children}
      </Drawer>
    </>
  );
}
