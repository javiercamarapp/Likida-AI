'use client';

import { X } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import LogoV2 from '../../dashboard/shell/logo-v2';

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
  children?: ReactNode;
  /** Pie con acciones (botones). */
  pie?: ReactNode;
  /** `false` ignora el clic al fondo (formularios a medio llenar). Esc y Cerrar siguen cerrando. */
  cierraConFondo?: boolean;
}

// ── Scroll lock por contador ────────────────────────────────────────────────────────────────────
// Varios overlays apilados (un Modal sobre un Drawer) comparten UN bloqueo: <html data-overlay-abierto> se quita solo
// cuando se cierra el último.
let abiertos = 0;
function bloquearScroll() {
  abiertos += 1;
  document.documentElement.setAttribute('data-overlay-abierto', '');
}
function soltarScroll() {
  abiertos = Math.max(0, abiertos - 1);
  if (abiertos === 0) document.documentElement.removeAttribute('data-overlay-abierto');
}

// ── Disparador para devolver el foco, también en WebKit ─────────────────────────────────────────
// Safari (macOS e iOS) NO enfoca un <button> al hacer clic: `document.activeElement` es <body> y el foco "no tendría
// adónde volver". Se recuerda el último elemento tocado con el puntero y se usa si no hay uno enfocado.
let ultimoToque: Element | null = null;
let escuchando = false;
function escucharToques() {
  if (escuchando || typeof document === 'undefined') return;
  escuchando = true;
  document.addEventListener('pointerdown', (e) => {
    ultimoToque = (e.target as Element | null)?.closest?.('button,a[href],[role="button"],input,select,textarea,summary,[tabindex]') ?? null;
  }, true);
}

const SELECTOR_CAMPO = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([disabled]),select:not([disabled]),textarea:not([disabled])';

function useDialogo(abierto: boolean, onCerrar: () => void, cierraConFondo = true) {
  const ref = useRef<HTMLDialogElement>(null);
  const previo = useRef<Element | null>(null);
  const bloqueado = useRef(false);
  const desdeFondo = useRef(false);

  const liberar = useCallback((d: HTMLDialogElement | null) => {
    if (bloqueado.current) { bloqueado.current = false; soltarScroll(); }
    // El navegador ya devolvió el foco en Chromium; en WebKit (y si el disparador cambió) se asegura aquí.
    const destino = previo.current;
    previo.current = null;
    if (destino instanceof HTMLElement && destino.isConnected) {
      const a = document.activeElement;
      if (!a || a === document.body || d?.contains(a)) destino.focus();
    }
  }, []);

  useEffect(() => {
    escucharToques();
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) {
      const a = document.activeElement;
      previo.current = a && a !== document.body ? a : (ultimoToque?.isConnected ? ultimoToque : null);
      d.showModal();
      bloquearScroll(); bloqueado.current = true;
      // Foco inicial: lo marcado `data-autofocus`; si no, el primer campo del cuerpo; si no, Cerrar.
      (d.querySelector<HTMLElement>('[data-autofocus]') ?? d.querySelector<HTMLElement>('.rv-ov__cuerpo')?.querySelector<HTMLElement>(SELECTOR_CAMPO) ?? d.querySelector<HTMLElement>('.rv-ov__cerrar'))?.focus();
    }
    if (!abierto && d.open) { d.close(); liberar(d); }
  }, [abierto, liberar]);
  // Si el componente se desmonta con el diálogo abierto, también se suelta el bloqueo y se devuelve el foco.
  useEffect(() => () => {
    const d = ref.current;
    if (d?.open) d.close();
    liberar(null);
  }, [liberar]);

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
  // Clic en el fondo (el propio <dialog>) = cerrar, pero solo si el gesto EMPEZÓ en el fondo (arrastrar un texto desde un
  // campo hasta afuera no debe cerrar).
  const alPuntero = useCallback((e: React.PointerEvent<HTMLDialogElement>) => { desdeFondo.current = e.target === ref.current; }, []);
  const alClic = useCallback((e: React.MouseEvent<HTMLDialogElement>) => {
    if (cierraConFondo && desdeFondo.current && e.target === ref.current) onCerrar();
    desdeFondo.current = false;
  }, [onCerrar, cierraConFondo]);
  return { ref, alCancelar, alClic, alTeclear, alPuntero };
}

function Cabecera({ idTitulo, idDesc, titulo, descripcion, onCerrar }: {
  idTitulo: string; idDesc: string; titulo: string; descripcion?: ReactNode; onCerrar: () => void;
}) {
  return (
    <header className="rv-ov__cab">
      <div className="rv-ov__textos">
        <h2 id={idTitulo} className="rv-ov__titulo">{titulo}</h2>
        {descripcion ? <div id={idDesc} className="rv-ov__desc">{descripcion}</div> : null}
      </div>
      <button type="button" className="rv-ov__cerrar" aria-label="Cerrar" onClick={onCerrar}>
        <X width={16} height={16} strokeWidth={2} aria-hidden="true" />
      </button>
    </header>
  );
}

export type TamanoDrawer = 'm' | 'l' | 'xl'; // 420 / 480 / 640 px

/** `ancho` (320 / 420 / 560) es el ancho del PanelLateral; sin él rige `tamano` (420 / 480 / 640, compatibilidad). */
export type AnchoPanel = 320 | 420 | 560;

export function Drawer({ abierto, onCerrar, titulo, descripcion, children, pie, tamano = 'm', ancho, cierraConFondo }: Base & { tamano?: TamanoDrawer; ancho?: AnchoPanel }) {
  const { ref, alCancelar, alClic, alTeclear, alPuntero } = useDialogo(abierto, onCerrar, cierraConFondo);
  const panel = useRef<HTMLDivElement>(null);
  const y0 = useRef<number | null>(null);
  const idTitulo = useId();
  const idDesc = useId();

  return (
    <dialog
      ref={ref}
      className="rv-ov rv-ov--drawer"
      data-tamano={ancho ? undefined : tamano}
      data-ancho={ancho}
      aria-labelledby={idTitulo}
      aria-describedby={descripcion ? idDesc : undefined}
      onCancel={alCancelar}
      onPointerDown={alPuntero}
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
        {/* Marca al pie del cajón (escritorio), como `.drawer-marca` de Vexa: logo oficial de Likida, sin recolorear (hereda la tinta). */}
        <div className="rv-ov__marca" aria-hidden="true"><LogoV2 alto={14} decorativo /></div>
      </div>
    </dialog>
  );
}

export type TamanoModal = 'm' | 'l'; // 440 / 560 px

/** `alerta` = confirmación que interrumpe (role="alertdialog"): acciones destructivas o con efectos fiscales. */
export function Modal({ abierto, onCerrar, titulo, descripcion, children, pie, tamano = 'm', alerta = false, cierraConFondo, sinCabecera = false, posicion = 'centro' }: Base & {
  tamano?: TamanoModal; alerta?: boolean;
  /** Sin cabecera visible (paleta de comandos): `titulo` queda como nombre accesible. */
  sinCabecera?: boolean;
  /** `arriba` sube el modal a un 12 % de la altura (paleta). */
  posicion?: 'centro' | 'arriba';
}) {
  const { ref, alCancelar, alClic, alTeclear, alPuntero } = useDialogo(abierto, onCerrar, cierraConFondo);
  const idTitulo = useId();
  const idDesc = useId();
  return (
    <dialog
      ref={ref}
      className="rv-ov rv-ov--modal"
      role={alerta ? 'alertdialog' : undefined}
      data-tamano={tamano}
      data-posicion={posicion === 'arriba' ? 'arriba' : undefined}
      aria-labelledby={sinCabecera ? undefined : idTitulo}
      aria-label={sinCabecera ? titulo : undefined}
      aria-describedby={descripcion ? idDesc : undefined}
      onCancel={alCancelar}
      onPointerDown={alPuntero}
      onClick={alClic}
      onKeyDown={alTeclear}
    >
      <div className="rv-ov__panel">
        {sinCabecera ? null : <Cabecera idTitulo={idTitulo} idDesc={idDesc} titulo={titulo} descripcion={descripcion} onCerrar={onCerrar} />}
        {sinCabecera && descripcion ? <div id={idDesc} hidden>{descripcion}</div> : null}
        <div className="rv-ov__cuerpo" data-sin-padding={sinCabecera || undefined}>{children}</div>
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

/** Coloca un panel `position: fixed` bajo su ancla (o encima si abajo no cabe), dentro del viewport. */
function colocarPanel(el: HTMLElement, ancla: HTMLElement | null, alineacion: 'inicio' | 'fin') {
  const a = ancla?.getBoundingClientRect();
  if (!a) return;
  const p = el.getBoundingClientRect();
  const margen = 8;
  let left = alineacion === 'fin' ? a.right - p.width : a.left;
  left = Math.min(Math.max(margen, left), window.innerWidth - p.width - margen);
  let top = a.bottom + 6;
  if (top + p.height > window.innerHeight - margen) top = Math.max(margen, a.top - 6 - p.height); // sin espacio abajo: arriba
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
}

export function Popover({ abierto, onCerrar, ancla, etiqueta, alineacion = 'fin', className, id, children }: {
  abierto: boolean;
  onCerrar: () => void;
  /** Disparador: el panel se ancla a él y le devuelve el foco al cerrar. */
  ancla: RefObject<HTMLElement | null>;
  /** Nombre accesible del panel. */
  etiqueta: string;
  /** `fin` alinea el borde derecho del panel con el del ancla; `inicio`, el izquierdo. */
  alineacion?: 'inicio' | 'fin';
  className?: string;
  id?: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  // El ancla declara que abre un panel y si está abierto (lectores de pantalla), sin que cada consumidor lo recuerde.
  useEffect(() => {
    const a = ancla.current;
    if (!a) return;
    if (!a.hasAttribute('aria-haspopup')) a.setAttribute('aria-haspopup', 'true');
    a.setAttribute('aria-expanded', String(abierto));
  }, [abierto, ancla]);

  // Posición: nace oculto, se coloca y entonces se muestra; se recoloca con resize y scroll.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!abierto || !el) return;
    colocarPanel(el, ancla.current, alineacion);
    el.style.visibility = 'visible';
    el.querySelector<HTMLElement>('[data-autofocus],[role="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, [abierto, ancla, alineacion]);

  useEffect(() => {
    if (!abierto) return;
    // Esc en CAPTURA y con preventDefault: dentro de un Drawer/Modal cierra solo el popover, no el <dialog> contenedor.
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      onCerrar(); ancla.current?.focus();
    };
    const alPuntero = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || ancla.current?.contains(t)) return;
      onCerrar();
    };
    // Tab fuera del panel (y del ancla) lo cierra: no queda un panel abierto sin foco dentro.
    const alPerderFoco = (e: FocusEvent) => {
      const a = e.relatedTarget as Node | null;
      if (!a || panel.current?.contains(a) || ancla.current?.contains(a)) return;
      onCerrar();
    };
    const el = panel.current;
    const recolocar = () => { if (el) colocarPanel(el, ancla.current, alineacion); };
    document.addEventListener('keydown', alTeclear, true);
    document.addEventListener('pointerdown', alPuntero);
    el?.addEventListener('focusout', alPerderFoco);
    const anc = ancla.current;
    anc?.addEventListener('focusout', alPerderFoco); // Tab desde el disparador (p. ej. el ⓘ, cuyo foco nunca entra al panel) también cierra
    window.addEventListener('resize', recolocar);
    window.addEventListener('scroll', recolocar, true);
    return () => {
      document.removeEventListener('keydown', alTeclear, true);
      document.removeEventListener('pointerdown', alPuntero);
      el?.removeEventListener('focusout', alPerderFoco);
      anc?.removeEventListener('focusout', alPerderFoco);
      window.removeEventListener('resize', recolocar);
      window.removeEventListener('scroll', recolocar, true);
    };
  }, [abierto, onCerrar, ancla, alineacion]);

  if (!abierto) return null;
  return (
    <div ref={panel} id={id} className={['rv-pop', className].filter(Boolean).join(' ')} role="group" aria-label={etiqueta} style={{ top: 0, left: 0, visibility: 'hidden' }}>
      {children}
    </div>
  );
}

/** PanelLateral: base única de drawers de detalle, filtros avanzados, evidencia, notificaciones y menú de cuenta.
 *  Anchos 320 / 420 / 560, cabecera, cierre, animación 180 ms y hoja inferior en móvil: los mismos del Drawer. */
export function PanelLateral({ ancho = 420, ...resto }: Base & { ancho?: AnchoPanel }) {
  return <Drawer ancho={ancho} {...resto} />;
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
