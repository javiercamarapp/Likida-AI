import type { ReactNode } from 'react';
import type { InfoClave } from '../info-catalogo';
import { cx } from './clases';
import { InfoTip } from './info-tip';

/** El título ÚNICO de un recuadro que no es una `Tarjeta` (sección con `.card`, bloque de formulario, lista): un solo estilo (14/600, token
 *  --t-card) y la ⓘ del catálogo pegada al título. `info` es obligatoria: un recuadro con título sin explicación no existe (lo vigila
 *  `info_cobertura.test.ts`). `nivel` solo cambia la etiqueta HTML (la jerarquía del documento), no el aspecto. */
export function TituloRecuadro({ info, children, nivel = 'h2', id, className }: {
  info: InfoClave;
  children: ReactNode;
  nivel?: 'h2' | 'h3';
  id?: string;
  /** Clases del contenedor (p. ej. el margen inferior que traía el título suelto). */
  className?: string;
}) {
  const H = nivel;
  return (
    <div className={cx('rv-recuadro-tit', className)}>
      <H id={id} className="rv-recuadro-tit__texto">{children}</H>
      <InfoTip clave={info} />
    </div>
  );
}
