import type { ReactNode } from 'react';
import { cx } from './clases';

export type TonoChip = 'neutral' | 'ok' | 'warn' | 'bad' | 'info';

/** Etiqueta compacta. `categoria` 1..8 pinta el tinte y el punto del matiz de
 *  datos (solo chips de categoría, PLAN §2.2); nunca comunica solo con color:
 *  siempre lleva texto. */
export function Chip({ children, tono = 'neutral', categoria, tamano, className }: {
  children: ReactNode;
  tono?: TonoChip;
  categoria?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /** estado = 22 px; delta = 20 px (chip de variación); por omisión 24. */
  tamano?: 'estado' | 'delta';
  className?: string;
}) {
  return (
    <span
      className={cx('rv-chip', className)}
      data-tono={categoria ? undefined : tono}
      data-categoria={categoria}
      data-tam={tamano}
    >
      {categoria ? <i className="rv-chip__punto" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
