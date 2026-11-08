import Link from 'next/link';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './clases';
import { CajonFiltros, type PropsCajonFiltros } from './cajon-filtros';

// ═══════════════════════════════════════════════════════════════════════════
// BARRA DE PERIODO (R8, estilo Rovaq): UNA fila compacta, gap 8, sin hueco entre filtros y títulos:
//   [segmentado de periodo] [Filtros N] [chips de rango / moneda] ……… [acción secundaria]
// Pieza de SERVIDOR (sin 'use client', sin estado): el periodo son enlaces y las «x» de los chips son enlaces, así que el estado vive en la URL
// y funciona sin JavaScript. Lo único interactivo es el botón «Filtros» + su cajón (`CajonFiltros`, cliente, solo props serializables).
// Nada se inventa: opciones, chips y filtros los pasa cada pantalla desde datos reales. `accion` es un slot de ReactNode (elemento ya armado).
// Con estado de cliente en vez de URL (p. ej. las tres granularidades del inicio) se pasa `selector` (un SegmentedControl) en lugar de `periodo`.
// ═══════════════════════════════════════════════════════════════════════════

export interface OpcionPeriodo { valor: string; etiqueta: string; href: string }
export interface ChipBarra {
  id: string;
  etiqueta: string;
  /** Con `hrefQuitar` el chip lleva una «x» (enlace) que lo quita. Sin él es informativo. */
  hrefQuitar?: string;
}

export function BarraPeriodo({ etiqueta = 'Periodo y filtros', periodo, selector, chips = [], cajon, accion, className }: {
  /** Nombre accesible de la barra. */
  etiqueta?: string;
  /** Segmentado de periodo en modo URL: cada opción es un enlace; `valor` marca la vigente. */
  periodo?: { etiqueta: string; valor: string; opciones: readonly OpcionPeriodo[] };
  /** Alternativa al `periodo`: un selector ya armado (estado de cliente). */
  selector?: ReactNode;
  chips?: readonly ChipBarra[];
  /** Si se omite no hay botón «Filtros» (no se inventan filtros que la pantalla no tiene). */
  cajon?: PropsCajonFiltros;
  /** Acción secundaria a la derecha («Última publicación», «Exportar»). */
  accion?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('rv-bp', className)} role="group" aria-label={etiqueta}>
      {periodo ? (
        <nav className="rv-seg rv-bp__seg" data-tam="sm" aria-label={periodo.etiqueta}>
          {periodo.opciones.map((o) => (
            <Link key={o.valor} href={o.href} prefetch={false} scroll={false} className="rv-seg__btn" aria-current={o.valor === periodo.valor ? 'true' : undefined}>{o.etiqueta}</Link>
          ))}
        </nav>
      ) : selector ?? null}
      {cajon ? <CajonFiltros {...cajon} /> : null}
      {chips.length > 0 ? (
        <ul className="rv-bp__chips" aria-label="Filtros vigentes">
          {chips.map((c) => (
            <li key={c.id} className="rv-bp__chip" data-quitable={c.hrefQuitar ? '' : undefined}>
              <span>{c.etiqueta}</span>
              {c.hrefQuitar ? (
                <Link href={c.hrefQuitar} prefetch={false} scroll={false} className="rv-bp__quitar" aria-label={`Quitar ${c.etiqueta}`}><X aria-hidden="true" strokeWidth={1.75} /></Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {accion ? <div className="rv-bp__accion">{accion}</div> : null}
    </div>
  );
}
