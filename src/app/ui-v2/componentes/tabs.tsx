'use client';

import { useCallback, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './clases';

// PESTAÑAS DE SECCIÓN (Vexa `pc-tabs`): fila con filete inferior, 36 px, 13/500, la activa en 600 con subrayado de 2 px en tinta.
// · `Tabs`: paneles de la MISMA página (WAI-ARIA tablist/tab/tabpanel). Flechas, Inicio y Fin cambian y activan; Tab entra a la
//   pestaña activa y de ahí al panel. `param="vista"` sincroniza la selección con ?vista= (history.replaceState, sin recargar).
// · `TabsLinea`: secciones que son RUTAS distintas (enlaces con aria-current="page"), como `TabsLinea` de Vexa. Máximo 6.

// `replaceState` no emite `popstate`: Tabs avisa por su propio evento para que todas las Tabs con `param` se enteren.
const EVENTO_URL = 'rv-tabs-url';
const suscribirUrl = (f: () => void) => {
  window.addEventListener('popstate', f); window.addEventListener(EVENTO_URL, f);
  return () => { window.removeEventListener('popstate', f); window.removeEventListener(EVENTO_URL, f); };
};

export interface PestanaDef {
  valor: string;
  etiqueta: string;
  /** Número a la derecha; 0 se pinta gris (un cero no es una alerta). */
  conteo?: number | null;
  /** El conteo pide acción (burdeos, `--senal`): solo si de verdad hay algo que atender. Por omisión el conteo es neutro. */
  atencion?: boolean;
  contenido: ReactNode;
}

export function ConteoPestana({ n, atencion }: { n: number; atencion?: boolean }) {
  return <span className="rv-tabs__conteo" data-cero={n === 0 || undefined} data-atencion={(atencion && n > 0) || undefined}>{n}</span>;
}

export function Tabs({ etiqueta, pestanas, valor, valorInicial, onChange, param, className }: {
  /** Nombre accesible de la fila de pestañas. */
  etiqueta: string;
  pestanas: readonly PestanaDef[];
  /** Controlado. Sin él, la pieza guarda su propio estado empezando en `valorInicial` (o la primera). */
  valor?: string;
  valorInicial?: string;
  onChange?: (v: string) => void;
  /** Nombre del parámetro de URL que refleja la pestaña (opcional). */
  param?: string;
  className?: string;
}) {
  const base = useId();
  const lista = useRef<HTMLDivElement>(null);
  const primero = pestanas[0]?.valor ?? '';
  const [propio, setPropio] = useState<string | null>(null);
  // Parámetro de la URL: en el servidor es null y tras hidratar se lee de la barra (sin setState en un efecto).
  const delUrl = useSyncExternalStore(suscribirUrl, () => (param ? new URLSearchParams(window.location.search).get(param) : null), () => null);
  const candidato = valor ?? (param ? null : propio) ?? (delUrl && pestanas.some((p) => p.valor === delUrl) ? delUrl : null) ?? valorInicial ?? primero;
  const activo = pestanas.some((p) => p.valor === candidato) ? candidato : primero;

  const elegir = useCallback((v: string) => {
    if (valor === undefined && !param) setPropio(v); // con `param` la fuente de verdad es la URL (atrás/adelante la cambian)
    onChange?.(v);
    if (param) {
      const u = new URL(window.location.href);
      u.searchParams.set(param, v);
      window.history.replaceState(window.history.state, '', u);
      window.dispatchEvent(new Event(EVENTO_URL));
    }
  }, [valor, onChange, param]);

  const teclear = (e: KeyboardEvent, i: number) => {
    const n = pestanas.length;
    let d = -1;
    if (e.key === 'ArrowRight') d = (i + 1) % n;
    else if (e.key === 'ArrowLeft') d = (i - 1 + n) % n;
    else if (e.key === 'Home') d = 0;
    else if (e.key === 'End') d = n - 1;
    if (d < 0) return;
    e.preventDefault();
    elegir(pestanas[d].valor);
    lista.current?.querySelectorAll<HTMLElement>('[role="tab"]')[d]?.focus();
  };

  return (
    <div className={cx('rv-tabsx', className)}>
      <div className="rv-tabs" role="tablist" aria-label={etiqueta} ref={lista}>
        {pestanas.map((p, i) => (
          <button
            key={p.valor}
            type="button"
            role="tab"
            id={`${base}-t-${p.valor}`}
            className="rv-tabs__tab"
            aria-selected={p.valor === activo}
            aria-controls={`${base}-p-${p.valor}`}
            tabIndex={p.valor === activo ? 0 : -1}
            onClick={() => elegir(p.valor)}
            onKeyDown={(e) => teclear(e, i)}
          >
            {p.etiqueta}{p.conteo != null ? <ConteoPestana n={p.conteo} atencion={p.atencion} /> : null}
          </button>
        ))}
      </div>
      {pestanas.map((p) => (
        <div key={p.valor} role="tabpanel" id={`${base}-p-${p.valor}`} aria-labelledby={`${base}-t-${p.valor}`} className="rv-tabs__panel" hidden={p.valor !== activo} tabIndex={p.valor === activo ? 0 : undefined}>
          {p.contenido}
        </div>
      ))}
    </div>
  );
}
