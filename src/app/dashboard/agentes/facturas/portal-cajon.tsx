'use client';

import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Boton, Drawer } from '@/app/ui-v2/componentes';

/**
 * «Vista rápida» de UN portal (Rovaq, plantilla de bandeja): la fila de la tabla solo dice nombre, estado y desde cuándo; la explicación
 * larga (qué se guarda, qué no se hará nunca, el código de un solo uso) y las dos acciones van en un cajón de 420 que se abre aquí.
 * El texto legal se dice UNA vez, dentro del cajón del portal abierto, no repetido en cada fila. El contenido (`VincularAsistida` y
 * `ControlesRelogin`) sigue siendo el de siempre, con sus acciones de servidor y sus puertas de permisos.
 */
export function CajonPortal({ titulo, subtitulo, disparador, children }: {
  titulo: string;
  subtitulo?: string;
  disparador: string;
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Boton type="button" variante="ghost" tamano="sm" aria-haspopup="dialog" onClick={() => setAbierto(true)}>{disparador}</Boton>
      {/* El cajón se pinta en <body>: dentro de la celda numérica (TD alineada a la derecha) heredaba su text-align y salía todo a la derecha. */}
      {abierto && typeof document !== 'undefined' && createPortal(
        <Drawer abierto={abierto} onCerrar={() => setAbierto(false)} titulo={titulo} descripcion={subtitulo} tamano="m">
          <div className="rv-fact__pila">{children}</div>
        </Drawer>,
        document.body,
      )}
    </>
  );
}
