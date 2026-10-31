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
export function Tarjeta({ titulo, info, acciones, estado = 'ok', mensaje, detalle, accionVacio, esqueleto, onReintentar, reintentar, children, className }: {
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
  /** Cargando: el esqueleto de la forma real de lo que va a ocupar este lugar. */
  esqueleto?: ReactNode;
  onReintentar?: () => void;
  /** Desde un componente de servidor: Reintentar vuelve a pedir los datos de la página. */
  reintentar?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('rv-tarjeta', className)} aria-busy={estado === 'cargando' || undefined} data-estado={estado}>
      <header className="rv-tarjeta__cab">
        <h2 className="rv-tarjeta__titulo">{titulo}</h2>
        {acciones ? <div className="rv-tarjeta__acciones">{acciones}</div> : null}
        {info ? <InfoTip clave={info} /> : null}
      </header>
      <div className="rv-tarjeta__cuerpo">
        {estado === 'vacio' ? <EstadoVacio titulo={mensaje ?? 'Sin datos en el periodo'} accion={accionVacio}>{detalle}</EstadoVacio> : null}
        {estado === 'error' ? <EstadoError onReintentar={onReintentar} reintentar={reintentar} compacto>{mensaje}</EstadoError> : null}
        {estado === 'cargando' && esqueleto ? esqueleto : null}
        {estado === 'ok' || (estado === 'cargando' && !esqueleto) ? children : null}
      </div>
    </section>
  );
}
