import type { ReactNode } from 'react';
import { Escena, type EscenaId } from '../svg/escenas';

/** Estado vacío v2: escena SVG estática + qué falta + CTA (un botón o enlace de
 *  verdad que lleve al paso). Nunca rellena con datos de ejemplo. Distinto del
 *  `EstadoVacio` de admin/ui/kit.tsx, que sigue siendo el de v1. */
export function EstadoVacio({ escena, titulo, children, accion, compacto = false }: {
  escena: EscenaId;
  titulo: string;
  children?: ReactNode;
  accion?: ReactNode;
  compacto?: boolean;
}) {
  return (
    <div className="rv-vacio" data-compacto={compacto || undefined}>
      {compacto ? null : <div className="rv-vacio__arte"><Escena id={escena} /></div>}
      <h3 className="rv-vacio__titulo">{titulo}</h3>
      {children ? <p className="rv-vacio__texto">{children}</p> : null}
      {accion ? <div className="rv-vacio__accion">{accion}</div> : null}
    </div>
  );
}
