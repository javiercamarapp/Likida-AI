import type { ReactNode } from 'react';

/** Estado vacío ÚNICO: título (≤6 palabras, sin punto), UNA línea (qué falta y quién lo resuelve) y a lo sumo UNA acción. Sin
 *  ilustración, sin borde punteado y sin datos de ejemplo. La ausencia de datos nunca va en rojo (eso es `EstadoError`).
 *  Compacto dentro de una tarjeta; con `pantalla` ocupa el cuerpo de una pantalla vacía. Distinto del `EstadoVacio` de
 *  admin/ui/kit.tsx, que sigue siendo el de v1. */
export function EstadoVacio({ titulo, children, accion, pantalla }: {
  titulo: string;
  /** La línea: qué falta y quién lo resuelve (≤ 48 caracteres de ancho útil por renglón). */
  children?: ReactNode;
  /** UNA sola acción principal, y solo si el rol puede hacerla. */
  accion?: ReactNode;
  /** Pantalla entera vacía (con borde sólido y más aire), en vez de un hueco dentro de una tarjeta. */
  pantalla?: boolean;
  /** @deprecated sin efecto: ya no hay escenas. */
  escena?: string;
  /** @deprecated sin efecto: el estado vacío siempre es compacto salvo `pantalla`. */
  compacto?: boolean;
}) {
  return (
    <div className="rv-vacio" role="status" data-pantalla={pantalla || undefined}>
      <h3 className="rv-vacio__titulo">{titulo}</h3>
      {children ? <p className="rv-vacio__texto">{children}</p> : null}
      {accion ? <div className="rv-vacio__accion">{accion}</div> : null}
    </div>
  );
}
