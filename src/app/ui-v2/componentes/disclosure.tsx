import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './clases';
import { Icono } from './icono';

/** Bloque plegable con chevron visible: un <details> nativo (teclado, Enter/Espacio y lectores de pantalla gratis, sin JavaScript
 *  ni estado). La cabecera es de 40 px (44 en móvil), 13/600, con el chevron a la derecha que gira al abrir; `resumen` es una línea
 *  corta y apagada junto al chevron (p. ej. «3 documentos») que ayuda a decidir si abrir. Sin funciones como props: se puede pintar
 *  desde un componente de servidor. Para el formulario «Nuevo/Alta…» de una pantalla con datos, ábrelo solo si no hay nada más. */
export function Disclosure({ titulo, resumen, abierto, variante = 'tarjeta', className, children }: {
  titulo: ReactNode;
  /** Línea corta a la derecha de la cabecera (cuenta, estado). */
  resumen?: ReactNode;
  /** Abierto al cargar. */
  abierto?: boolean;
  /** `tarjeta` (borde y fondo propios) o `linea` (sin marco, para plegar un formulario DENTRO de una tarjeta: texto + chevron). */
  variante?: 'tarjeta' | 'linea';
  className?: string;
  children: ReactNode;
}) {
  return (
    <details className={cx('rv-disc', variante === 'linea' && 'rv-disc--linea', className)} open={abierto || undefined}>
      <summary className="rv-disc__cab">
        <span className="rv-disc__titulo">{titulo}</span>
        {resumen ? <span className="rv-disc__resumen">{resumen}</span> : null}
        <Icono icono={ChevronDown} tam={16} className="rv-disc__chev" />
      </summary>
      <div className="rv-disc__cuerpo">{children}</div>
    </details>
  );
}
