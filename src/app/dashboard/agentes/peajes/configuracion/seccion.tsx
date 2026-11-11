import type { ReactNode } from 'react';
import type { InfoClave } from '@/app/ui-v2/info-catalogo';
import { Tarjeta } from '@/app/ui-v2/componentes';

/** El recuadro ÚNICO de la configuración del conciliador: la `Tarjeta` del sistema (título 14/600 + ⓘ) con su ancla `#id` y la línea de
 *  apoyo debajo del título. Sustituye a los `<section>` con encabezado a mano que cada sección repetía. */
export function SeccionConfig({ id, titulo, info, nota, children }: {
  id: string;
  titulo: string;
  info?: InfoClave;
  nota?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div id={id}>
      <Tarjeta titulo={titulo} info={info}>
        {nota ? <p className="rv-pj-nota mb-3">{nota}</p> : null}
        {children}
      </Tarjeta>
    </div>
  );
}
