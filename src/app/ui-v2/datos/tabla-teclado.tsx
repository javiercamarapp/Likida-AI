'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { destinoFoco } from './estado-tabla';

const ENFOCABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const ESCRIBE = /^(text|search|email|number|tel|url|password|date|time|datetime-local|month|week)$/;

/** Envoltura de cliente de una `TablaLista`: flechas ↑ ↓ pasan al mismo control de la fila vecina (Ctrl+Inicio / Ctrl+Fin, a la
 *  primera / última), y, si la tabla tiene selección, «seleccionar todas» y el conteo anunciado. No guarda estado de datos: el orden y
 *  la página viven en la URL. Sin JavaScript la tabla funciona igual (Tab recorre los enlaces; las casillas se envían con su formulario). */
export function TablaTeclado({ children, seleccion, className }: { children: ReactNode; seleccion?: { singular: string; plural: string }; className?: string }) {
  const raiz = useRef<HTMLDivElement>(null);

  // Escuchas NATIVAS (no props de React): funcionan igual con el marcado que viene del servidor y con cualquier hijo, sin depender
  // del rastreo de valor de React sobre cada <input>.
  useEffect(() => {
    const el = raiz.current;
    if (!el) return;

    const enfocables = (): HTMLElement[][] => {
      const trs = Array.from(el.querySelectorAll<HTMLElement>('tbody > tr'));
      return trs.map((tr) => Array.from(tr.querySelectorAll<HTMLElement>(ENFOCABLE))).filter((c) => c.length > 0);
    };

    const alTeclear = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey || e.shiftKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('thead') || t.closest('tfoot')) return;
      if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      if (t instanceof HTMLInputElement && ESCRIBE.test(t.type)) return;
      const filas = enfocables();
      const fila = filas.findIndex((c) => c.includes(t));
      if (fila < 0) return;
      const d = destinoFoco(e.key, e.ctrlKey, fila, filas[fila].indexOf(t), filas.length);
      if (!d) return;
      e.preventDefault();
      const destino = filas[d.fila];
      destino[Math.min(d.indice, destino.length - 1)].focus();
    };

    const actualizarConteo = () => {
      if (!seleccion) return;
      const casillas = Array.from(el.querySelectorAll<HTMLInputElement>('input[data-sel-fila]'));
      const marcadas = casillas.filter((c) => c.checked).length;
      const todas = el.querySelector<HTMLInputElement>('input[data-sel-todas]');
      if (todas) { todas.checked = marcadas > 0 && marcadas === casillas.length; todas.indeterminate = marcadas > 0 && marcadas < casillas.length; }
      for (const tr of Array.from(el.querySelectorAll<HTMLElement>('tbody > tr'))) {
        const c = tr.querySelector<HTMLInputElement>('input[data-sel-fila]');
        if (c) tr.toggleAttribute('data-seleccionada', c.checked);
      }
      const aviso = el.querySelector<HTMLElement>('[data-sel-conteo]') ?? el.parentElement?.querySelector<HTMLElement>('[data-sel-conteo]');
      if (aviso) aviso.textContent = marcadas === 0 ? '' : `${marcadas} ${marcadas === 1 ? seleccion.singular : seleccion.plural}`;
    };

    const alCambiar = (e: Event) => {
      const t = e.target as HTMLInputElement;
      if (!seleccion || t.tagName !== 'INPUT') return;
      if (t.hasAttribute('data-sel-todas')) {
        el.querySelectorAll<HTMLInputElement>('input[data-sel-fila]').forEach((c) => { c.checked = t.checked; });
      }
      actualizarConteo();
    };

    el.addEventListener('keydown', alTeclear);
    el.addEventListener('change', alCambiar);
    return () => { el.removeEventListener('keydown', alTeclear); el.removeEventListener('change', alCambiar); };
  }, [seleccion?.singular, seleccion?.plural]); // eslint-disable-line react-hooks/exhaustive-deps -- `seleccion` es un objeto literal nuevo por render: se vigilan sus dos textos

  return (
    <div ref={raiz} className={className}>
      {children}
    </div>
  );
}
