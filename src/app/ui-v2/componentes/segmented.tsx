'use client';

import { useRef, type KeyboardEvent } from 'react';
import { cx } from './clases';

// SegmentedControl (Vexa `ui/segmented.tsx`): elección única entre 2-5 opciones cortas (periodo, vista, modo). Es un radiogroup
// con tabulación en balancín (solo el activo entra con Tab) y flechas (←/→/↑/↓, Inicio, Fin) que mueven la selección y el foco.
// Para navegar entre RUTAS usa TabsLinea; para paneles de la misma página, Tabs. Pista suave + borde, activo blanco con anillo.

export interface OpcionSegmentada<T extends string> { valor: T; etiqueta: string; conteo?: number; deshabilitada?: boolean }

export function SegmentedControl<T extends string>({ opciones, valor, onChange, etiqueta, tamano = 'md', className }: {
  opciones: readonly OpcionSegmentada<T>[];
  valor: T;
  onChange: (v: T) => void;
  /** Nombre accesible del grupo («Periodo»). Obligatorio. */
  etiqueta: string;
  tamano?: 'sm' | 'md';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mover = (e: KeyboardEvent, i: number) => {
    const habilitadas = opciones.map((o, k) => ({ o, k })).filter(({ o }) => !o.deshabilitada);
    if (habilitadas.length === 0) return;
    const pos = Math.max(0, habilitadas.findIndex(({ k }) => k === i));
    let destino = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') destino = (pos + 1) % habilitadas.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') destino = (pos - 1 + habilitadas.length) % habilitadas.length;
    else if (e.key === 'Home') destino = 0;
    else if (e.key === 'End') destino = habilitadas.length - 1;
    if (destino < 0) return;
    e.preventDefault();
    const siguiente = habilitadas[destino].o;
    onChange(siguiente.valor);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  };
  return (
    <div className={cx('rv-seg', className)} data-tam={tamano} role="radiogroup" aria-label={etiqueta} ref={ref}>
      {opciones.map((o, i) => (
        <button
          key={o.valor}
          type="button"
          role="radio"
          className="rv-seg__btn"
          aria-checked={o.valor === valor}
          disabled={o.deshabilitada}
          tabIndex={o.valor === valor ? 0 : -1}
          onClick={() => onChange(o.valor)}
          onKeyDown={(e) => mover(e, i)}
        >
          {o.etiqueta}
          {o.conteo !== undefined ? <span className="rv-seg__conteo">{o.conteo}</span> : null}
        </button>
      ))}
    </div>
  );
}
