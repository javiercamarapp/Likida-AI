'use client';

import { X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// DRAWER Y MODAL sobre <dialog> NATIVO (PLAN §2.3).
//
// `showModal()` da gratis el foco atrapado, el fondo inerte, Esc y la devolución
// del foco al disparador (mismo patrón que admin/ui/confirmar.tsx). Entrada
// ≤ 180 ms; la SALIDA no se anima. Este archivo es el ÚNICO lugar donde debe
// vivir un <dialog> / role="dialog" de ui-v2 (la prueba de contrato de la
// Fase 2 lo vigila; por eso el globo del recorrido no usa ese rol).
// Drawer en móvil (< 820 px) = hoja inferior con grabber; arrastrar > 80 px cierra.
// ═══════════════════════════════════════════════════════════════════════════

interface Base {
  abierto: boolean;
  onCerrar: () => void;
  titulo: string;
  descripcion?: ReactNode;
  children: ReactNode;
  /** Pie con acciones (botones). */
  pie?: ReactNode;
}

function useDialogo(abierto: boolean, onCerrar: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const previo = useRef<Element | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) {
      previo.current = document.activeElement;
      d.showModal();
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
    if (!abierto && d.open) {
      d.close();
      if (previo.current instanceof HTMLElement) previo.current.focus();
    }
  }, [abierto]);
  // Si el componente se desmonta con el diálogo abierto, también se devuelve el foco al disparador.
  useEffect(() => () => {
    const d = ref.current;
    if (d?.open) { d.close(); if (previo.current instanceof HTMLElement) previo.current.focus(); }
  }, []);

  const alCancelar = useCallback((e: React.SyntheticEvent) => {
    e.preventDefault(); // Esc: el estado lo manda el padre
    onCerrar();
  }, [onCerrar]);
  // Foco atrapado de verdad: el <dialog> nativo deja escapar Tab hacia el navegador; aquí se cicla dentro del panel.
  const alTeclear = useCallback((e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== 'Tab') return;
    const d = ref.current;
    if (!d) return;
    const foco = [...d.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')]
      .filter((el) => el.getClientRects().length > 0);
    if (foco.length === 0) return;
    const primero = foco[0], ultimo = foco[foco.length - 1];
    if (e.shiftKey && (document.activeElement === primero || !d.contains(document.activeElement))) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && (document.activeElement === ultimo || !d.contains(document.activeElement))) { e.preventDefault(); primero.focus(); }
  }, []);
  // Clic en el fondo (el propio <dialog>) = cerrar.
  const alClic = useCallback((e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === ref.current) onCerrar();
  }, [onCerrar]);
  return { ref, alCancelar, alClic, alTeclear };
}

function Cabecera({ idTitulo, idDesc, titulo, descripcion, onCerrar }: {
  idTitulo: string; idDesc: string; titulo: string; descripcion?: ReactNode; onCerrar: () => void;
}) {
  return (
    <header className="rv-ov__cab">
      <div className="rv-ov__textos">
        <h2 id={idTitulo} className="rv-ov__titulo">{titulo}</h2>
        {descripcion ? <p id={idDesc} className="rv-ov__desc">{descripcion}</p> : null}
      </div>
      <button type="button" className="rv-ov__cerrar" aria-label="Cerrar" onClick={onCerrar} data-autofocus>
        <X width={16} height={16} strokeWidth={2} aria-hidden="true" />
      </button>
    </header>
  );
}

export type TamanoDrawer = 'm' | 'l' | 'xl'; // 420 / 480 / 640 px

export function Drawer({ abierto, onCerrar, titulo, descripcion, children, pie, tamano = 'm' }: Base & { tamano?: TamanoDrawer }) {
  const { ref, alCancelar, alClic, alTeclear } = useDialogo(abierto, onCerrar);
  const panel = useRef<HTMLDivElement>(null);
  const y0 = useRef<number | null>(null);
  const idTitulo = useId();
  const idDesc = useId();

  return (
    <dialog
      ref={ref}
      className="rv-ov rv-ov--drawer"
      data-tamano={tamano}
      aria-labelledby={idTitulo}
      aria-describedby={descripcion ? idDesc : undefined}
      onCancel={alCancelar}
      onClick={alClic}
      onKeyDown={alTeclear}
    >
      <div className="rv-ov__panel" ref={panel}>
        <div
          className="rv-ov__grabber"
          aria-hidden="true"
          onPointerDown={(e) => { y0.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => {
            if (y0.current === null || !panel.current) return;
            const dy = Math.max(0, e.clientY - y0.current);
            panel.current.style.transform = dy ? `translateY(${dy}px)` : '';
            panel.current.style.transition = 'none';
          }}
          onPointerUp={(e) => {
            if (y0.current === null) return;
            const dy = e.clientY - y0.current;
            y0.current = null;
            if (panel.current) { panel.current.style.transition = ''; panel.current.style.transform = ''; }
            if (dy > 80) onCerrar();
          }}
        />
        <Cabecera idTitulo={idTitulo} idDesc={idDesc} titulo={titulo} descripcion={descripcion} onCerrar={onCerrar} />
        <div className="rv-ov__cuerpo">{children}</div>
        {pie ? <footer className="rv-ov__pie">{pie}</footer> : null}
      </div>
    </dialog>
  );
}

export type TamanoModal = 'm' | 'l'; // 440 / 560 px

/** `alerta` = confirmación que interrumpe (role="alertdialog"): acciones destructivas o con efectos fiscales. */
export function Modal({ abierto, onCerrar, titulo, descripcion, children, pie, tamano = 'm', alerta = false }: Base & { tamano?: TamanoModal; alerta?: boolean }) {
  const { ref, alCancelar, alClic, alTeclear } = useDialogo(abierto, onCerrar);
  const idTitulo = useId();
  const idDesc = useId();
  return (
    <dialog
      ref={ref}
      className="rv-ov rv-ov--modal"
      role={alerta ? 'alertdialog' : undefined}
      data-tamano={tamano}
      aria-labelledby={idTitulo}
      aria-describedby={descripcion ? idDesc : undefined}
      onCancel={alCancelar}
      onClick={alClic}
      onKeyDown={alTeclear}
    >
      <div className="rv-ov__panel">
        <Cabecera idTitulo={idTitulo} idDesc={idDesc} titulo={titulo} descripcion={descripcion} onCerrar={onCerrar} />
        <div className="rv-ov__cuerpo">{children}</div>
        {pie ? <footer className="rv-ov__pie">{pie}</footer> : null}
      </div>
    </dialog>
  );
}
