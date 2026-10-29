'use client';

import { X } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

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

// ═══════════════════════════════════════════════════════════════════════════
// POPOVER Y MENÚ (ESTILO §8): panel anclado a un disparador, filas de 32, radio 12, 140 ms, `--sh-pop`.
// No es modal: no atrapa el foco ni oscurece; cierra con Esc (devuelve el foco al ancla), clic afuera o al elegir.
// Se pinta en línea (sin portal) para que cuelgue de [data-ui="v2"]; `position: fixed` lo saca del flujo.
// ═══════════════════════════════════════════════════════════════════════════

export function Popover({ abierto, onCerrar, ancla, etiqueta, alineacion = 'fin', children }: {
  abierto: boolean;
  onCerrar: () => void;
  /** Disparador: el panel se ancla a él y le devuelve el foco al cerrar. */
  ancla: RefObject<HTMLElement | null>;
  /** Nombre accesible del panel. */
  etiqueta: string;
  /** `fin` alinea el borde derecho del panel con el del ancla; `inicio`, el izquierdo. */
  alineacion?: 'inicio' | 'fin';
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  // Posición y foco inicial se aplican directo al nodo (sin estado): nace oculto, se coloca y entonces se muestra.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!abierto || !el) return;
    const a = ancla.current?.getBoundingClientRect();
    if (!a) return;
    const p = el.getBoundingClientRect();
    const margen = 8;
    let left = alineacion === 'fin' ? a.right - p.width : a.left;
    left = Math.min(Math.max(margen, left), window.innerWidth - p.width - margen);
    let top = a.bottom + 6;
    if (top + p.height > window.innerHeight - margen) top = Math.max(margen, a.top - 6 - p.height); // sin espacio abajo: arriba
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    el.style.visibility = 'visible';
    el.querySelector<HTMLElement>('[data-autofocus],[role="menuitem"]')?.focus();
  }, [abierto, ancla, alineacion]);

  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCerrar(); ancla.current?.focus(); } };
    const alPuntero = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || ancla.current?.contains(t)) return;
      onCerrar();
    };
    document.addEventListener('keydown', alTeclear);
    document.addEventListener('pointerdown', alPuntero);
    return () => { document.removeEventListener('keydown', alTeclear); document.removeEventListener('pointerdown', alPuntero); };
  }, [abierto, onCerrar, ancla]);

  if (!abierto) return null;
  return (
    <div ref={panel} className="rv-pop" role="group" aria-label={etiqueta} style={{ top: 0, left: 0, visibility: 'hidden' }}>
      {children}
    </div>
  );
}

/** Lista de acciones de un Popover (filas de 32). Flechas arriba/abajo, Inicio y Fin recorren los ítems. */
export function MenuList({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  const alTeclear = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const ir = (k: number) => { e.preventDefault(); items[(k + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') ir(i + 1);
    else if (e.key === 'ArrowUp') ir(i < 0 ? items.length - 1 : i - 1);
    else if (e.key === 'Home') ir(0);
    else if (e.key === 'End') ir(items.length - 1);
  };
  return <div className="rv-menu" role="menu" aria-label={etiqueta} onKeyDown={alTeclear}>{children}</div>;
}

export function MenuItem({ children, icono, onSelect, href, peligro = false, deshabilitado = false }: {
  children: ReactNode;
  icono?: ReactNode;
  onSelect?: () => void;
  /** Con `href` es un enlace de verdad. */
  href?: string;
  peligro?: boolean;
  deshabilitado?: boolean;
}) {
  const comunes = { role: 'menuitem' as const, className: 'rv-menu__item', 'data-peligro': peligro || undefined, 'aria-disabled': deshabilitado || undefined, tabIndex: -1 };
  const cuerpo = <>{icono ? <span className="rv-menu__icono" aria-hidden="true">{icono}</span> : null}{children}</>;
  return href && !deshabilitado
    ? <a {...comunes} href={href} onClick={onSelect}>{cuerpo}</a>
    : <button type="button" {...comunes} onClick={deshabilitado ? undefined : onSelect}>{cuerpo}</button>;
}
