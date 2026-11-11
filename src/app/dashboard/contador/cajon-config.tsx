'use client';

import type { ReactNode } from 'react';
import { Boton, Drawer, useAbrirPorUrl } from '@/app/ui-v2/componentes';

/**
 * La configuración fiscal del contador (estímulo de peaje, plantilla del ERP, emisor de timbrado) vive en un cajón, no en el panel:
 * en Rovaq los formularios de configuración no comparten pantalla con las cifras. Cada formulario conserva su acción de servidor y su
 * puerta de permisos (siguen siendo `estimulo-peaje.tsx`, `perfil-erp.tsx` y `timbrado.tsx`); aquí solo se abren. Se abre también por
 * `?abrir=<id>`. El disparador es un botón de 32 px (cabecera de página), no el compacto de tablas.
 */
export function CajonConfigFiscal({ id, titulo, descripcion, disparador, children }: {
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
        {children}
      </Drawer>
    </>
  );
}
