import type { ReactNode } from 'react';

/** Estado vacío v2: celda punteada y UNA línea (qué falta + CTA opcional). Sin ilustraciones
 *  ni párrafos (ESTILO §13). Nunca rellena con datos de ejemplo. `escena` se acepta por
 *  compatibilidad con las páginas existentes y se ignora. Distinto del `EstadoVacio` de
 *  admin/ui/kit.tsx, que sigue siendo el de v1. */
export function EstadoVacio({ titulo, children, accion }: {
  /** @deprecated sin efecto: ya no hay escenas. */
  escena?: string;
  titulo: string;
  children?: ReactNode;
  accion?: ReactNode;
  /** @deprecated sin efecto: el estado vacío siempre es compacto. */
  compacto?: boolean;
}) {
  return (
    <div className="rv-vacio">
      <h3 className="rv-vacio__titulo">{titulo}</h3>
      {children ? <p className="rv-vacio__texto">{children}</p> : null}
      {accion ? <div className="rv-vacio__accion">{accion}</div> : null}
    </div>
  );
}
