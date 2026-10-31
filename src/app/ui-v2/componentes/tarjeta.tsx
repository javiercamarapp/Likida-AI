import type { ReactNode } from 'react';
import type { InfoClave } from '../info-catalogo';
import { cx } from './clases';
import { Boton } from './boton';
import { EstadoVacio } from './estado-vacio';
import { InfoTip } from './info-tip';
import { BotonReintentar } from './boton-reintentar';

export type EstadoTarjeta = 'ok' | 'vacio' | 'cargando' | 'error';

/** Tarjeta unificada (CardV2): cabecera «título + ⓘ + acciones», radio 12, padding compacto y los MISMOS estados
 *  en todo el producto: vacío (UNA línea punteada), cargando (datos previos atenuados, `aria-busy`; sin esqueleto) y
 *  error («No es cero» + Reintentar). Una tarjeta nunca se pinta con una sola cifra suelta ni con vacío interior. */
export function Tarjeta({ titulo, info, acciones, estado = 'ok', mensaje, onReintentar, reintentar, children, className }: {
  titulo: string;
  /** Clave del catálogo de explicaciones: pone la ⓘ junto al título. */
  info?: InfoClave;
  acciones?: ReactNode;
  estado?: EstadoTarjeta;
  /** Vacío: qué falta. Error: causa. */
  mensaje?: string;
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
        {estado === 'vacio' ? <EstadoVacio titulo={mensaje ?? 'Sin datos en el periodo'} /> : null}
        {estado === 'error' ? (
          <div className="rv-tarjeta__error" role="alert">
            <span>{mensaje ?? 'No disponible ahora. No es cero: la consulta no respondió a tiempo.'}</span>
            {onReintentar ? <Boton tamano="sm" onClick={onReintentar}>Reintentar</Boton> : reintentar ? <BotonReintentar /> : null}
          </div>
        ) : null}
        {estado === 'ok' || estado === 'cargando' ? children : null}
      </div>
    </section>
  );
}
