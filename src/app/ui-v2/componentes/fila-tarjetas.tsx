import type { ReactNode } from 'react';
import { cx } from './clases';
import './fila-tarjetas.css';

/** Las cinco formas de una fila de tarjetas sobre la rejilla de 12 columnas (CONTRATO-VISUAL §2 P3). */
export type VarianteFila = '8-4' | '4-4-4' | '6-6' | '4-8' | '12';

/** UNA fila de tarjetas sobre una rejilla de 12 columnas con separación de 12 px (10 en móvil).
 *  · `8-4` / `4-8`: dos tarjetas, la ancha y la angosta. · `4-4-4`: tres iguales. · `6-6`: dos iguales. · `12`: una de lado a lado.
 *  Responsivo, sin JavaScript: hasta 1023 px todo pasa a 6+6 (la tercera de `4-4-4` ocupa el ancho completo); en móvil (≤767 px),
 *  una columna. Las tarjetas hijas se estiran a la misma altura y su cuerpo (vacío/error incluidos) llena el hueco.
 *  `llena`: la fila absorbe el alto que sobre en la pantalla (la última fila del Resumen). */
export function FilaTarjetas({ variante, llena, children, className }: {
  variante: VarianteFila;
  llena?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('rv-fila-tarjetas', className)} data-variante={variante} data-llena={llena || undefined}>
      {children}
    </div>
  );
}
