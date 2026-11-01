import type { ReactNode } from 'react';
import { cx } from './clases';
import { EncabezadoPagina } from './encabezado-pagina';

/** El ÚNICO marco de pantalla: encabezado + bloques apilados con la misma separación (12; 10 en móvil). Sustituye al trío
 *  `<main className="h-full">` + caja redondeada con borde + `BarraPagina` + `px-5 py-5 space-y-N` que cada vista repetía.
 *  El relleno de 24/24/28 lo pone el lienzo del shell (`.rv-contenido`); aquí no hay padding propio. */
export function MarcoPagina({ area, titulo, idTitulo, apoyo, acciones, children, className, ancho }: {
  area?: string;
  titulo: string;
  /** `id` del h1; la región principal se nombra con él (`aria-labelledby`). */
  idTitulo?: string;
  apoyo?: string;
  acciones?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Pantallas de lectura larga (texto legal, formularios): limita el ancho de los bloques. */
  ancho?: 'lectura';
}) {
  return (
    <main className={cx('rv-marco', className)} data-ancho={ancho} aria-labelledby={idTitulo}>
      <EncabezadoPagina area={area} titulo={titulo} idTitulo={idTitulo} apoyo={apoyo} acciones={acciones} />
      {children}
    </main>
  );
}
