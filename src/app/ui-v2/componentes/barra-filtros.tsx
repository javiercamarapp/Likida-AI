'use client';

import { Search, SlidersHorizontal } from 'lucide-react';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { cx } from './clases';
import { FiltroChip, FiltroLimpiar } from './filtros';
import { useMovil } from './movil';
import { PanelLateral, Popover } from './overlay';

export interface ChipFiltro { id: string; etiqueta: string; activo: boolean }

type Ocultos = Record<string, string> | ReadonlyArray<readonly [string, string]>;

/** Barra de filtros COMPACTA (LF): UNA sola fila baja (controles de 32 px; 36 con caja táctil de 44 en móvil), con scroll horizontal
 *  cuando no cabe; nunca apila filtros. Dos usos:
 *   · controlada (cliente): `busqueda`, `chips`/`onChip`, `avanzados`;
 *   · GET (estado en la URL): `accion` (+ `ocultos`) la vuelve un <form method="get"> y los hijos son FiltroOpciones/FiltroBusqueda/
 *     FiltroFecha/FiltroInterruptor/FiltroCampo. Elegir una opción o una fecha envía; Intro envía la búsqueda.
 *  «Limpiar» (discreto) aparece con `limpiarHref` cuando hay filtros vigentes (`nActivos` > 0). */
export function BarraFiltros({ busqueda, chips = [], onChip, avanzados, nAvanzados = 0, fuentes, className, accion, ocultos, etiqueta = 'Filtros', limpiarHref, nActivos = 0, enLinea = false, buscar = false, children }: {
  busqueda?: { valor: string; onCambio: (v: string) => void; placeholder?: string; etiqueta?: string };
  chips?: readonly ChipFiltro[];
  onChip?: (id: string) => void;
  /** Contenido de los filtros avanzados (se pliega bajo el botón «Filtros»). */
  avanzados?: ReactNode;
  /** Cuántos filtros avanzados hay activos (se muestra junto al botón). */
  nAvanzados?: number;
  /** Chip de cobertura a la derecha, p. ej. «Fuentes 5 de 7». */
  fuentes?: string;
  className?: string;
  /** Con `accion` la barra es un formulario GET hacia esa ruta. */
  accion?: string;
  /** Parámetros que el GET debe conservar (un <form> reemplaza el query string entero). */
  ocultos?: Ocultos;
  /** Nombre accesible de la barra. */
  etiqueta?: string;
  limpiarHref?: string;
  nActivos?: number;
  /** Dentro de una tarjeta o de una fila de encabezado: sin sticky ni fondo propio. */
  enLinea?: boolean;
  /** La barra contiene una búsqueda (FiltroBusqueda): solo entonces es una región `search`. */
  buscar?: boolean;
  children?: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const ancla = useRef<HTMLButtonElement>(null);
  const idPanel = useId();
  const movil = useMovil();
  const esForma = accion !== undefined;
  const pares: Array<readonly [string, string]> = ocultos ? (Array.isArray(ocultos) ? [...(ocultos as ReadonlyArray<readonly [string, string]>)] : Object.entries(ocultos as Record<string, string>)) : [];

  const cuerpo = (
    <>
      {esForma ? pares.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />) : null}
      {busqueda ? (
        <label className="rv-fl rv-fl--buscar">
          <Search aria-hidden="true" />
          <span className="rv-sr">{busqueda.etiqueta ?? 'Buscar'}</span>
          <input type="search" className="border-0 bg-transparent" value={busqueda.valor} placeholder={busqueda.placeholder ?? 'Buscar'} onChange={(e) => busqueda.onCambio(e.target.value)} />
        </label>
      ) : null}
      <div className="rv-filtros__chips">
        {chips.map((c) => <FiltroChip key={c.id} activo={c.activo} onClick={() => onChip?.(c.id)}>{c.etiqueta}</FiltroChip>)}
        {children}
      </div>
      <div className="rv-filtros__derecha">
        {fuentes ? <span className="rv-filtros__fuentes">{fuentes}</span> : null}
        {limpiarHref && nActivos > 0 ? <FiltroLimpiar href={limpiarHref} /> : null}
        {esForma ? <noscript><button type="submit" className="rv-btn rv-btn--sm">Aplicar</button></noscript> : null}
        {avanzados ? (
          <button ref={ancla} type="button" className="rv-fl" data-activo={nAvanzados > 0 ? '' : undefined} aria-expanded={abierto} aria-controls={idPanel} onClick={() => setAbierto((v) => !v)}>
            <SlidersHorizontal aria-hidden="true" />
            <span>Filtros</span>
            {nAvanzados > 0 ? <span className="rv-fl__n">{nAvanzados}</span> : null}
          </button>
        ) : null}
      </div>
      {avanzados ? (movil ? (
        <PanelLateral abierto={abierto} onCerrar={() => setAbierto(false)} titulo="Filtros" ancho={320}>{avanzados}</PanelLateral>
      ) : (
        <Popover abierto={abierto} onCerrar={() => setAbierto(false)} ancla={ancla} etiqueta="Filtros avanzados" id={idPanel}>
          <div className="rv-filtros__avanzados">{avanzados}</div>
        </Popover>
      )) : null}
    </>
  );

  if (esForma) {
    // Elegir una fecha o marcar un interruptor envía; la búsqueda envía con Intro (botón de envío oculto = envío implícito siempre válido).
    const alCambiar = (e: FormEvent<HTMLFormElement>) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement && t.hasAttribute('data-auto')) e.currentTarget.requestSubmit();
    };
    return (
      <form method="get" action={accion} role={busqueda || buscar ? 'search' : undefined} aria-label={etiqueta} className={cx('rv-filtros', enLinea && 'rv-filtros--en-linea', className)} onChange={alCambiar}>
        {cuerpo}
        <button type="submit" className="rv-sr" tabIndex={-1} aria-hidden="true">Aplicar</button>
      </form>
    );
  }
  return <div className={cx('rv-filtros', enLinea && 'rv-filtros--en-linea', className)} role="toolbar" aria-label={etiqueta}>{cuerpo}</div>;
}
