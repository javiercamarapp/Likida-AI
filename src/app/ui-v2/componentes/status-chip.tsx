import type { ReactNode } from 'react';
import { cx } from './clases';

export type TonoEstado = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'muted';

/** Chip de estado de Vexa (`StatusChip`): punto de 6 px + texto en una pastilla de 22 px con el tinte del tono. Nunca solo color:
 *  el texto siempre dice el estado y el punto cambia de forma en `muted` (hueco). `title` es opcional y NO sustituye al texto.
 *  Para etiquetas de categoría (matiz de datos) sigue siendo `Chip categoria`; para variaciones, `Chip tamano="delta"`. */
export function StatusChip({ tono = 'neutral', children, title, className }: { tono?: TonoEstado; children: ReactNode; title?: string; className?: string }) {
  return (
    <span className={cx('rv-estado', className)} data-tono={tono} title={title}>
      <i className="rv-estado__punto" aria-hidden="true" />
      {children}
    </span>
  );
}
