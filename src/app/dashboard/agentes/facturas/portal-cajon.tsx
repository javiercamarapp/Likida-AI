'use client';

import { useState, type ReactNode } from 'react';
import { Boton, Drawer } from '@/app/ui-v2/componentes';

/**
 * «Vista rápida» de UN portal (Rovaq, plantilla de bandeja): la fila de la tabla solo dice nombre, estado y desde cuándo; la explicación
 * larga (qué se guarda, qué no se hará nunca, el código de un solo uso) y las dos acciones van en un cajón de 420 que se abre aquí.
 * El texto legal se dice UNA vez, dentro del cajón del portal abierto, no repetido en cada fila. El contenido (`VincularAsistida` y
 * `ControlesRelogin`) sigue siendo el de siempre, con sus acciones de servidor y sus puertas de permisos.
 */
export function CajonPortal({ titulo, subtitulo, disparador, cifras, pie, children }: {
  titulo: string;
  subtitulo?: string;
  disparador: string;
  /** Rovaq (vista rápida): cuadrícula 2×2 de cifras ya formateadas; sin dato, «—», nunca un 0 inventado. */
  cifras?: readonly { etiqueta: string; valor: string }[];
  /** El pie con la acción primaria del cajón (a la derecha). */
  pie?: ReactNode;
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Boton type="button" variante="ghost" tamano="sm" aria-haspopup="dialog" onClick={() => setAbierto(true)}>{disparador}</Boton>
      {/* La raíz del cajón corta la herencia del `text-align` de la celda numérica (TD alineada a la derecha) donde vive el <dialog>: sin ella el
          cajón entero salía alineado a la derecha. `display: contents` no añade caja. */}
      <div className="rv-fact__cajon-raiz">
        <Drawer abierto={abierto} onCerrar={() => setAbierto(false)} titulo={titulo} descripcion={subtitulo} tamano="m" pie={pie ? <div className="rv-esq__vr-pie">{pie}</div> : undefined}>
          <div className="rv-fact__pila">
            {cifras && cifras.length > 0 ? (
              <dl className="rv-esq__vr">
                {cifras.map((c) => (<div key={c.etiqueta}><dt>{c.etiqueta}</dt><dd>{c.valor}</dd></div>))}
              </dl>
            ) : null}
            {children}
          </div>
        </Drawer>
      </div>
    </>
  );
}
