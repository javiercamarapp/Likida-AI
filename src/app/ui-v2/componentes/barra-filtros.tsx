'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { Boton } from './boton';
import { cx } from './clases';
import { useMovil } from './movil';
import { PanelLateral, Popover } from './overlay';

export interface ChipFiltro { id: string; etiqueta: string; activo: boolean }

/** Barra de filtros COMPACTA: UNA sola fila de 40 px (36–40; 44 en móvil por el toque) con búsqueda, chips y «Filtros»
 *  (los avanzados van plegados: popover en escritorio, hoja inferior en móvil). Sticky con la cabecera. Prohibido apilar
 *  filtros en varias filas: los chips se desplazan en horizontal. */
export function BarraFiltros({ busqueda, chips = [], onChip, avanzados, nAvanzados = 0, fuentes, className }: {
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
}) {
  const [abierto, setAbierto] = useState(false);
  const ancla = useRef<HTMLButtonElement>(null);
  const idPanel = useId();
  const movil = useMovil();
  return (
    <div className={cx('rv-filtros', className)} role="toolbar" aria-label="Filtros">
      {busqueda ? (
        <label className="rv-filtros__buscar">
          <span className="rv-sr">{busqueda.etiqueta ?? 'Buscar'}</span>
          <input type="search" value={busqueda.valor} placeholder={busqueda.placeholder ?? 'Buscar'} onChange={(e) => busqueda.onCambio(e.target.value)} />
        </label>
      ) : null}
      <div className="rv-filtros__chips">
        {chips.map((c) => (
          <button key={c.id} type="button" className="rv-chip" aria-pressed={c.activo} onClick={() => onChip?.(c.id)}>{c.etiqueta}</button>
        ))}
      </div>
      <div className="rv-filtros__derecha">
        {fuentes ? <span className="rv-filtros__fuentes">{fuentes}</span> : null}
        {avanzados ? (
          <Boton ref={ancla} tamano="sm" icono={<SlidersHorizontal />} aria-expanded={abierto} aria-controls={idPanel} onClick={() => setAbierto((v) => !v)}>
            Filtros{nAvanzados > 0 ? ` · ${nAvanzados}` : ''}
          </Boton>
        ) : null}
      </div>
      {avanzados ? (movil ? (
        <PanelLateral abierto={abierto} onCerrar={() => setAbierto(false)} titulo="Filtros" ancho={320}>{avanzados}</PanelLateral>
      ) : (
        <Popover abierto={abierto} onCerrar={() => setAbierto(false)} ancla={ancla} etiqueta="Filtros avanzados" id={idPanel}>
          <div style={{ display: 'grid', gap: 8, minWidth: 260 }}>{avanzados}</div>
        </Popover>
      )) : null}
    </div>
  );
}
