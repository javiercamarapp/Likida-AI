'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Selector de cliente con teclado (Rovaq P2c, la paleta ⌘K): desde el buscador o desde la tabla, ↓/↑ mueven la fila resaltada (negra con
 * texto blanco), Intro la elige y Esc quita el resaltado. Sin fila resaltada, Intro conserva su efecto normal (enviar la búsqueda). La
 * elección es la MISMA acción de servidor de cada fila (su botón «Elegir»): aquí solo se mueve el resaltado y se pulsa ese botón.
 */
export function NavegacionFilas({ children }: { children: ReactNode }) {
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let actual = -1;
    const filas = () => Array.from(raiz.current?.querySelectorAll<HTMLTableRowElement>('tbody tr') ?? []);
    const marcar = (i: number) => {
      const lista = filas();
      lista.forEach((f, k) => { if (k === i) f.setAttribute('data-resaltada', ''); else f.removeAttribute('data-resaltada'); });
      actual = i;
      lista[i]?.scrollIntoView({ block: 'nearest' });
    };
    const enBuscadorOTabla = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      if (t === document.body) return true;
      if (t instanceof HTMLInputElement && t.type === 'search') return true;
      return Boolean(raiz.current?.contains(t));
    };
    const alTecla = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || !enBuscadorOTabla(e.target)) return;
      const n = filas().length;
      if (n === 0) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); marcar(Math.min(n - 1, actual + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); marcar(Math.max(0, actual - 1)); }
      else if (e.key === 'Escape' && actual >= 0) { marcar(-1); }
      else if (e.key === 'Enter' && actual >= 0) {
        const boton = filas()[actual]?.querySelector<HTMLButtonElement>('button[type="submit"]');
        if (boton) { e.preventDefault(); boton.click(); }
      }
    };
    document.addEventListener('keydown', alTecla);
    return () => document.removeEventListener('keydown', alTecla);
  }, []);

  return <div ref={raiz} className="adm-sel-tabla">{children}</div>;
}
