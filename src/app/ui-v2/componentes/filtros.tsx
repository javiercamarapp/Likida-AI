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
//   · sin JavaScript cada FiltroOpciones ofrece un <select> nativo (noscript) y la barra un «Aplicar»; las opciones-enlace salen como enlaces.
// Los nombres de los parámetros (`name`) los pone la pantalla: este módulo no inventa ninguno.
// ═══════════════════════════════════════════════════════════════════════════

export interface OpcionFiltro {
  valor: string;
  rotulo: string;
  /** Solo modo enlace: a dónde va esta opción (el estado vive en la URL que arma la pantalla). */
  href?: string;
}

/** Más opciones que esto: el popover trae un buscador adentro (choferes, operadores, clientes de 100+). */
const UMBRAL_BUSCADOR = 12;

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
  const [consulta, setConsulta] = useState('');
  const teclas = useRef<{ texto: string; t: number }>({ texto: '', t: 0 });

  const elegida = opciones.find((o) => o.valor === actual);
  const activo = actual !== porDefecto;
  // B1: un valor de la URL que no está entre las opciones NO se pinta como id crudo.
  const rotuloValor = elegida?.rotulo ?? 'Valor no válido';
  const cerrar = () => { setAbierto(false); setConsulta(''); };
  const conBuscador = opciones.length > UMBRAL_BUSCADOR;
  const visibles = conBuscador && consulta.trim() !== ''
    ? opciones.filter((o) => o.rotulo.toLocaleLowerCase('es').includes(consulta.trim().toLocaleLowerCase('es')))
    : opciones;
  // Sin JavaScript el chip no hace nada: se oculta y queda el respaldo de <noscript> (select o enlaces).
  const ocultarChip = !listo && Boolean(nombre || opciones.some((o) => o.href));

  const elegir = (o: OpcionFiltro) => {
    cerrar();
    if (o.valor === actual) { ancla.current?.focus(); return; }
    setActual(o.valor);
    onCambio?.(o.valor);
    if (nombre && oculto.current) { oculto.current.value = o.valor; enviarForma(oculto.current); }
  };

  const alTeclearAncla = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setAbierto(true); }
  };
  const alTeclearLista = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')];
    const enBuscador = (e.target as HTMLElement).tagName === 'INPUT';
    const i = items.indexOf(document.activeElement as HTMLElement);
    const ir = (k: number) => { e.preventDefault(); items[(k + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') ir(enBuscador ? 0 : i + 1);
    else if (e.key === 'ArrowUp') ir(i < 0 ? items.length - 1 : i - 1);
    else if (enBuscador) return; // dentro del buscador las demás teclas escriben
    else if (e.key === 'Home') ir(0);
    else if (e.key === 'End') ir(items.length - 1);
    else if (e.key === ' ' && (e.target as HTMLElement).tagName === 'A') { e.preventDefault(); (e.target as HTMLElement).click(); } // Espacio activa también el enlace
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      // Type-ahead acumulado: «Pa» + «t» = «Pat…» (el texto se olvida tras 700 ms).
      const ahora = Date.now();
      const base = ahora - teclas.current.t > 700 ? '' : teclas.current.texto;
      const texto = base + e.key.toLocaleLowerCase('es');
      teclas.current = { texto, t: ahora };
      const orden = base === '' ? [...items.slice(i + 1), ...items.slice(0, i + 1)] : items;
      const hit = orden.find((el) => (el.textContent ?? '').trim().toLocaleLowerCase('es').startsWith(texto));
      if (hit) { e.preventDefault(); hit.focus(); }
    }
  };

  return (
    <>
      {/* El campo viaja solo con JavaScript (listo): sin él, el <select> de noscript es el campo y no se duplica el parámetro. */}
      {nombre && listo ? <input ref={oculto} type="hidden" name={nombre} defaultValue={valor} /> : null}
      {nombre && !opciones.some((o) => o.href) ? (
        <noscript>
          <label className="rv-fl rv-fl--nativo" data-activo={activo ? '' : undefined}>
            <span className="rv-fl__etq">{etiqueta}</span>
            <select name={nombre} defaultValue={valor} aria-label={ariaLabel ?? etiqueta} disabled={deshabilitado} className="border-0 bg-transparent">
              {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
            </select>
          </label>
        </noscript>
      ) : null}
      <button
        ref={ancla}
        type="button"
        className={cx('rv-fl', className)}
        hidden={ocultarChip}
        data-activo={activo ? '' : undefined}
        aria-label={ariaLabel ?? `${etiqueta}${activo ? `: ${rotuloValor}` : ''}`}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-controls={abierto ? idLista : undefined}
        disabled={deshabilitado}
        onClick={() => (abierto ? cerrar() : setAbierto(true))}
        onKeyDown={alTeclearAncla}
      >
        <span className="rv-fl__etq">{etiqueta}</span>
        {activo ? <span className="rv-fl__val">{rotuloValor}</span> : null}
        <ChevronDown className="rv-fl__flecha" aria-hidden="true" />
      </button>
      {opciones.some((o) => o.href) ? (
        // Sin JavaScript el chip no abre nada: las opciones-enlace salen como enlaces simples (el estado vive en la URL).
        <noscript>
          <span className="rv-fl__ns">
            {opciones.filter((o) => o.href).map((o, i) => <Link key={`${o.valor}-${i}`} href={o.href!} prefetch={false} aria-current={o.valor === actual ? 'true' : undefined}>{o.rotulo}</Link>)}
          </span>
        </noscript>
      ) : null}
      <Popover abierto={abierto} onCerrar={cerrar} ancla={ancla} etiqueta={etiqueta} alineacion="inicio" className="rv-fl__pop">
        <div className="rv-fl__lista" onKeyDown={alTeclearLista}>
          {conBuscador ? (
            <input type="search" className="rv-fl__buscar border-0 bg-transparent" value={consulta} onChange={(e) => setConsulta(e.target.value)}
              placeholder="Buscar…" aria-label={`Buscar en ${etiqueta}`} data-autofocus="" autoComplete="off" />
          ) : null}
          <div ref={lista} id={idLista} role="listbox" aria-label={etiqueta} className="rv-fl__opciones">
          {visibles.length === 0 ? <p className="rv-fl__nada">Sin coincidencias</p> : null}
          {visibles.map((o, i) => {
            const sel = o.valor === actual;
            const comun = {
              role: 'option' as const,
              'aria-selected': sel,
              tabIndex: sel || (!elegida && i === 0) ? 0 : -1,
              'data-autofocus': !conBuscador && (sel || (!elegida && i === 0)) ? '' : undefined,
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
              <Link key={o.valor === '' ? `vacio-${i}` : o.valor} href={o.href} prefetch={false} {...comun} onClick={cerrar}>{cuerpo}</Link>
            ) : (
              <button key={o.valor === '' ? `vacio-${i}` : o.valor} type="button" {...comun} onClick={() => elegir(o)}>{cuerpo}</button>
            );
          })}
          </div>
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
      <input type="search" name={nombre} defaultValue={valor ?? ''} placeholder={placeholder} maxLength={maxLength} className="border-0 bg-transparent" />
    </label>
  );
}

/** ¿Fecha completa y razonable? (Chrome va dando 0002-…, 0020-… mientras se teclea el año.) */
function fechaValida(v: string, min?: string, max?: string): boolean {
  if (v === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const anio = Number(v.slice(0, 4));
  return anio >= 1900 && anio <= 2200 && (!min || v >= min) && (!max || v <= max);
}

/** Fecha (type=date) con su rótulo dentro del chip. Envía la forma SOLO al elegir del calendario (cambio sin teclear), al salir del campo
 *  o con Intro, y siempre con una fecha completa y válida: teclear el año dígito a dígito NO recarga la página. */
export function FiltroFecha({ nombre, etiqueta, valor, min, max, autoEnvio = true, className }: {
  nombre: string;
  etiqueta: string;
  valor?: string | null;
  min?: string;
  max?: string;
  /** Envía la forma al terminar de elegir (por omisión). Falso en formas que ACCIONAN algo (exportar). */
  autoEnvio?: boolean;
  className?: string;
}) {
  const tecleando = useRef(false);
  const inicial = valor ?? '';
  const ultimo = useRef(inicial); // lo último que se envió: Intro + blur no duplican el envío
  const enviar = (el: HTMLInputElement) => {
    tecleando.current = false;
    if (autoEnvio && el.value !== ultimo.current && fechaValida(el.value, min, max)) { ultimo.current = el.value; enviarForma(el); }
  };
  return (
    <label className={cx('rv-fl rv-fl--fecha', className)} data-activo={valor ? '' : undefined}>
      <span className="rv-fl__etq">{etiqueta}</span>
      <input
        type="date" name={nombre} defaultValue={inicial} min={min} max={max} className="border-0 bg-transparent"
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); enviar(e.currentTarget); }
          else if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') tecleando.current = true;
        }}
        onChange={(e) => { if (!tecleando.current) enviar(e.currentTarget); }}
        onBlur={(e) => enviar(e.currentTarget)}
      />
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
