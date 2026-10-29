import type { ReactNode } from 'react';

/** Encabezado de página: rótulo mono 11 px, H1 20/600, descripción de una línea
 *  y acciones a la derecha. Sin [data-ui="v2"] se ve como un título sobrio de
 *  siempre (misma jerarquía, sin la piel nueva). */
export function EncabezadoPagina({ rotulo, titulo, descripcion, acciones }: {
  rotulo?: string;
  titulo: string;
  descripcion?: string;
  acciones?: ReactNode;
}) {
  return (
    <header className="rv-encabezado">
      <div className="rv-encabezado__texto">
        {rotulo ? <p className="rv-encabezado__rotulo">{rotulo}</p> : null}
        <h1 className="rv-encabezado__titulo font-display">{titulo}</h1>
        {descripcion ? <p className="rv-encabezado__desc">{descripcion}</p> : null}
      </div>
      {acciones ? <div className="rv-encabezado__acciones">{acciones}</div> : null}
    </header>
  );
}
