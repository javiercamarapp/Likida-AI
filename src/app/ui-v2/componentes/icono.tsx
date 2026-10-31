import type { LucideIcon } from 'lucide-react';

/** Tamaños permitidos (px). 16 es el de Vexa (botones, filas, menús); 14 = chevrón de grupo y chip; 18 = cierre de hoja móvil;
 *  20 = encabezados de estado y avisos grandes. Otro valor no compila. */
export type TamanoIcono = 14 | 16 | 18 | 20;

/** Trazo único de TODOS los iconos de Vexa (`icons.tsx`: rejilla de 24, 1.75, extremos y uniones redondeados). */
export const TRAZO_ICONO = 1.75;

/**
 * Envoltorio ÚNICO de lucide: fija el trazo (1.75) y el tamaño (16 por omisión; 14/18/20 solo donde Vexa los usa), y nunca deja
 * pasar un `strokeWidth` propio. Decorativo por omisión (`aria-hidden`); con `etiqueta` es una imagen con nombre. Hereda el color
 * (`currentColor`). Sin `style=`: el tamaño va en los atributos `width/height`.
 *
 *   <Icono icono={Info} />                      16 px, decorativo
 *   <Icono icono={AlertTriangle} tam={20} etiqueta="Atención" />
 *
 * Guarda: `iconos_trazo.test.ts` (código nuevo no puede mezclar grosores).
 */
export function Icono({ icono: Glifo, tam = 16, etiqueta, className }: {
  icono: LucideIcon;
  tam?: TamanoIcono;
  /** Nombre accesible; sin él, el icono es decorativo y el texto vecino lo nombra. */
  etiqueta?: string;
  className?: string;
}) {
  return (
    <Glifo
      width={tam}
      height={tam}
      strokeWidth={TRAZO_ICONO}
      className={className}
      focusable="false"
      {...(etiqueta ? { role: 'img', 'aria-label': etiqueta } : { 'aria-hidden': true })}
    />
  );
}
