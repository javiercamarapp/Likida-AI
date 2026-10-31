'use client';

import Link from 'next/link';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './clases';
import { Popover } from './overlay';

// ═══════════════════════════════════════════════════════════════════════════
// FILTROS DE BARRA (LF, 31-oct): la ÚNICA familia de controles de filtro del panel.
//   · alto 32 px (36 en móvil con caja táctil de 44), radio 8, borde fino, 12 px / 500 (--t-small);
//   · activo = fondo gris suave + borde de tinta (nunca azul); el valor vive DENTRO del chip («Estado · Abiertos»);
//   · las opciones salen en un Popover del motor de overlays (lote 3), con rol listbox y teclado completo;
//   · dentro de una `BarraFiltros` con `accion` el estado vive en la URL (GET): elegir envía el formulario;
//   · sin JavaScript cada FiltroOpciones es un <select> nativo del mismo tamaño y la barra ofrece «Aplicar» (noscript).
// Los nombres de los parámetros (`name`) los pone la pantalla: este módulo no inventa ninguno.
// ═══════════════════════════════════════════════════════════════════════════

export interface OpcionFiltro {
  valor: string;
  rotulo: string;
  /** Solo modo enlace: a dónde va esta opción (el estado vive en la URL que arma la pantalla). */
  href?: string;
}

/** Envía el formulario que contiene `el` (si lo hay). */
function enviarForma(el: Element | null) {
  const forma = el?.closest('form');
  if (forma) forma.requestSubmit();
}

/** Chip-selector. Tres modos, el mismo aspecto:
 *   1. `nombre` (+ forma GET): campo del formulario; elegir envía.
 *   2. `onCambio`: estado de cliente (periodo Semanal/Mensual…).
 *   3. opciones con `href`: elegir navega (el filtro ya es un enlace de la pantalla). */
export function FiltroOpciones({ etiqueta, opciones, valor, porDefecto = '', nombre, onCambio, deshabilitado, className, ariaLabel }: {
  etiqueta: string;
  opciones: readonly OpcionFiltro[];
  /** Valor vigente (el de la URL). */
  valor: string;
  /** Valor «sin filtro»: mientras `valor` lo iguale el chip no se marca activo. Por omisión, cadena vacía. */
  porDefecto?: string;
  nombre?: string;
  onCambio?: (valor: string) => void;
  deshabilitado?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  // Lo elegido localmente solo vale mientras el valor de la URL no cambie (al recargar con otro valor manda la URL).
  const [local, setLocal] = useState<{ base: string; v: string }>({ base: valor, v: valor });
  const actual = local.base === valor ? local.v : valor;
  const setActual = (v: string) => setLocal({ base: valor, v });
  const [abierto, setAbierto] = useState(false);
  // false en el servidor y durante la hidratación; true ya en el navegador (sin setState en efectos).
  const listo = useSyncExternalStore(() => () => {}, () => true, () => false);
  const ancla = useRef<HTMLButtonElement>(null);
  const oculto = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const idLista = useId();

  const elegida = opciones.find((o) => o.valor === actual);
  const activo = actual !== porDefecto;
  const rotuloValor = elegida?.rotulo ?? actual;
  const cerrar = () => setAbierto(false);

  const elegir = (o: OpcionFiltro) => {
    setAbierto(false);
    if (o.valor === actual) { ancla.current?.focus(); return; }
    setActual(o.valor);
    onCambio?.(o.valor);
    if (nombre && oculto.current) { oculto.current.value = o.valor; enviarForma(oculto.current); }
  };

  // Sin JavaScript (o antes de hidratar): <select> nativo con el mismo alto y las mismas opciones.
  if (!listo && nombre && !opciones.some((o) => o.href)) {
    return (
      <label className={cx('rv-fl rv-fl--nativo', className)} data-activo={activo ? '' : undefined}>
        <span className="rv-fl__etq">{etiqueta}</span>
        <select name={nombre} defaultValue={valor} aria-label={ariaLabel ?? etiqueta} disabled={deshabilitado}>
          {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
        </select>
      </label>
    );
  }

  const alTeclearAncla = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setAbierto(true); }
  };
  const alTeclearLista = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const ir = (k: number) => { e.preventDefault(); items[(k + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') ir(i + 1);
    else if (e.key === 'ArrowUp') ir(i < 0 ? items.length - 1 : i - 1);
    else if (e.key === 'Home') ir(0);
    else if (e.key === 'End') ir(items.length - 1);
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      // Búsqueda por la inicial: salta a la siguiente opción cuyo rótulo empieza con la letra.
      const letra = e.key.toLocaleLowerCase('es');
      const orden = [...items.slice(i + 1), ...items.slice(0, i + 1)];
      const hit = orden.find((el) => (el.textContent ?? '').trim().toLocaleLowerCase('es').startsWith(letra));
      if (hit) { e.preventDefault(); hit.focus(); }
    }
  };

  return (
    <>
      {nombre ? <input ref={oculto} type="hidden" name={nombre} defaultValue={valor} /> : null}
      <button
        ref={ancla}
        type="button"
        className={cx('rv-fl', className)}
        data-activo={activo ? '' : undefined}
        aria-label={ariaLabel ?? `${etiqueta}${activo ? `: ${rotuloValor}` : ''}`}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-controls={abierto ? idLista : undefined}
        disabled={deshabilitado}
        onClick={() => setAbierto((v) => !v)}
        onKeyDown={alTeclearAncla}
      >
        <span className="rv-fl__etq">{etiqueta}</span>
        {activo ? <span className="rv-fl__val">{rotuloValor}</span> : null}
        <ChevronDown className="rv-fl__flecha" aria-hidden="true" />
      </button>
      <Popover abierto={abierto} onCerrar={cerrar} ancla={ancla} etiqueta={etiqueta} alineacion="inicio" className="rv-fl__pop">
        <div ref={lista} id={idLista} role="listbox" aria-label={etiqueta} className="rv-fl__lista" onKeyDown={alTeclearLista}>
          {opciones.map((o, i) => {
            const sel = o.valor === actual;
            const comun = {
              role: 'option' as const,
              'aria-selected': sel,
              tabIndex: sel || (!elegida && i === 0) ? 0 : -1,
              'data-autofocus': sel || (!elegida && i === 0) ? '' : undefined,
              className: 'rv-fl__op',
            };
            const cuerpo = (
              <>
                <span className="rv-fl__marca">{sel ? <Check aria-hidden="true" /> : null}</span>
                <span className="rv-fl__rotulo">{o.rotulo}</span>
              </>
            );
            // Con `href` la opción es un enlace real (el estado vive en la URL que arma la pantalla); sin él, un botón.
            return o.href ? (
              <Link key={o.valor === '' ? `vacio-${i}` : o.valor} href={o.href} prefetch={false} {...comun} onClick={() => setAbierto(false)}>{cuerpo}</Link>
            ) : (
              <button key={o.valor === '' ? `vacio-${i}` : o.valor} type="button" {...comun} onClick={() => elegir(o)}>{cuerpo}</button>
            );
          })}
        </div>
      </Popover>
    </>
  );
}

/** Chip de alternancia (pulsado / no pulsado). Con `href` es un enlace (el estado vive en la URL de la pantalla). */
export function FiltroChip({ children, activo, onClick, href, className }: {
  children: ReactNode;
  activo: boolean;
  onClick?: () => void;
  href?: string;
  className?: string;
}) {
  if (href) {
    return <Link href={href} className={cx('rv-fl rv-fl--chip', className)} data-activo={activo ? '' : undefined} aria-current={activo ? 'true' : undefined} prefetch={false}>{children}</Link>;
  }
  return <button type="button" className={cx('rv-fl rv-fl--chip', className)} data-activo={activo ? '' : undefined} aria-pressed={activo} onClick={onClick}>{children}</button>;
}

/** Búsqueda de texto (campo `name` de la forma GET; Intro envía). */
export function FiltroBusqueda({ nombre, valor, placeholder = 'Buscar', etiqueta = 'Buscar', maxLength = 80, className }: {
  nombre: string;
  valor?: string;
  placeholder?: string;
  etiqueta?: string;
  maxLength?: number;
  className?: string;
}) {
  return (
    <label className={cx('rv-fl rv-fl--buscar', className)}>
      <Search aria-hidden="true" />
      <span className="rv-sr">{etiqueta}</span>
      <input type="search" name={nombre} defaultValue={valor ?? ''} placeholder={placeholder} maxLength={maxLength} />
    </label>
  );
}

/** Fecha (type=date) con su rótulo dentro del chip. Al elegir, envía la forma. */
export function FiltroFecha({ nombre, etiqueta, valor, min, max, autoEnvio = true, className }: {
  nombre: string;
  etiqueta: string;
  valor?: string | null;
  min?: string;
  max?: string;
  /** Elegir la fecha envía la forma (por omisión). Falso en formas que ACCIONAN algo (exportar). */
  autoEnvio?: boolean;
  className?: string;
}) {
  return (
    <label className={cx('rv-fl rv-fl--fecha', className)} data-activo={valor ? '' : undefined}>
      <span className="rv-fl__etq">{etiqueta}</span>
      <input type="date" name={nombre} defaultValue={valor ?? ''} min={min} max={max} data-auto={autoEnvio ? '' : undefined} />
    </label>
  );
}

/** Interruptor de filtro («Solo con excepciones»): casilla real dentro de un chip; al cambiar, envía la forma. */
export function FiltroInterruptor({ nombre, valor = 'on', etiqueta, marcado, className }: {
  nombre: string;
  /** Valor que viaja cuando está marcado. */
  valor?: string;
  etiqueta: string;
  marcado: boolean;
  className?: string;
}) {
  return (
    <label className={cx('rv-fl rv-fl--interruptor', className)}>
      <input type="checkbox" className="rv-sr" name={nombre} value={valor} defaultChecked={marcado} data-auto="" />
      <Check className="rv-fl__tilde" aria-hidden="true" />
      <span>{etiqueta}</span>
    </label>
  );
}

/** Rótulo + control propio (combos de catálogo, campos especiales) con la apariencia de un chip. */
export function FiltroCampo({ etiqueta, pista, children, className }: { etiqueta: string; pista?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('rv-fl rv-fl--campo', className)} title={pista}>
      <span className="rv-fl__etq">{etiqueta}</span>
      {children}
    </label>
  );
}

/** «Limpiar»: enlace discreto que vuelve a la pantalla sin filtros (conserva el contexto que arma la pantalla). */
export function FiltroLimpiar({ href, etiqueta = 'Limpiar', className }: { href: string; etiqueta?: string; className?: string }) {
  return <Link href={href} className={cx('rv-fl-limpiar', className)} prefetch={false} scroll={false}>{etiqueta}</Link>;
}
