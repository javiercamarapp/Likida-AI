import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { InfoClave } from '../info-catalogo';
import { cx } from './clases';
import { EstadoVacio } from './estado-vacio';
import { EstadoError } from './estado-error';
import { InfoTip } from './info-tip';

export type EstadoTarjeta = 'ok' | 'vacio' | 'cargando' | 'error';

/** La tarjeta ÚNICA (radio 12, padding 14, sin sombra): cabecera «título + acciones a la derecha + ⓘ» en UN solo estilo (14/600) y
 *  los MISMOS estados en todo el producto: vacío (título + una línea + UNA acción), cargando (esqueleto con la forma real, o los datos
 *  previos atenuados con `aria-busy` si no se da uno) y error blando («No disponible ahora. No es cero» + Reintentar).
 *  Una tarjeta nunca se pinta con una sola cifra suelta ni con vacío interior. */
export function Tarjeta({ titulo, info, acciones, estado = 'ok', mensaje, detalle, accionVacio, iconoVacio, contenida, formulario, esqueleto, onReintentar, reintentar, elevar, entra, children, className }: {
  titulo: string;
  /** Clave del catálogo de explicaciones: pone la ⓘ junto al título. */
  info?: InfoClave;
  acciones?: ReactNode;
  estado?: EstadoTarjeta;
  /** Vacío: qué falta (título, ≤6 palabras). Error: causa. */
  mensaje?: string;
  /** Vacío: la línea de apoyo (qué falta y quién lo resuelve). */
  detalle?: string;
  /** Vacío: UNA acción, solo si el rol puede hacerla. */
  accionVacio?: ReactNode;
  /** Vacío: icono lucide sobrio sobre el título (no cruzarlo desde un servidor hacia un componente de cliente). */
  iconoVacio?: LucideIcon;
  /** La tarjeta NO se estira a la altura de su vecina en la rejilla (`align-self: start`); con vacío, el vacío va contenido. */
  contenida?: boolean;
  /** A47-FE-01: ranura para el formulario de CAPTURA. Se pinta en `ok` Y en `vacio`, porque en una flota nueva el estado de la
   *  tarjeta es justamente `vacio` y es ahí donde hace falta capturar el primer dato. Un formulario pasado por `children` se
   *  pierde con el vacío (`children` solo se pinta en `ok`), y la pantalla queda sin salida. */
  formulario?: ReactNode;
  /** Cargando: el esqueleto de la forma real de lo que va a ocupar este lugar. */
  esqueleto?: ReactNode;
  onReintentar?: () => void;
  /** Desde un componente de servidor: Reintentar vuelve a pedir los datos de la página. */
  reintentar?: boolean;
  /** Rovaq `[data-lift]`: la tarjeta sube 1 px al pasar el puntero (solo con movimiento permitido). Para tarjetas del Resumen, no de formularios. */
  elevar?: boolean;
  /** Rovaq `[data-entra]`: entrada al montar (translateY, 180 ms). Solo con movimiento permitido. */
  entra?: 'tarjeta' | 'seccion';
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('rv-tarjeta', className)} data-contenida={contenida || undefined} data-lift={elevar || undefined} data-entra={entra} aria-busy={estado === 'cargando' || undefined} data-estado={estado}>
      <header className="rv-tarjeta__cab">
        <h2 className="rv-tarjeta__titulo">{titulo}</h2>
        {acciones ? <div className="rv-tarjeta__acciones">{acciones}</div> : null}
        {info ? <InfoTip clave={info} /> : null}
      </header>
      <div className="rv-tarjeta__cuerpo">
        {estado === 'vacio' ? <EstadoVacio titulo={mensaje ?? 'Sin datos en el periodo'} accion={accionVacio} icono={iconoVacio} contenido={contenida}>{detalle}</EstadoVacio> : null}
        {estado === 'error' ? <EstadoError onReintentar={onReintentar} reintentar={reintentar} compacto>{mensaje}</EstadoError> : null}
        {estado === 'cargando' && esqueleto ? esqueleto : null}
        {estado === 'ok' || (estado === 'cargando' && !esqueleto) ? children : null}
        {formulario && (estado === 'ok' || estado === 'vacio') ? formulario : null}
      </div>
    </section>
  );
}
