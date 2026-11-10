'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Info, OctagonAlert, X } from 'lucide-react';
import { leerResultado, type ResultadoUI } from './aviso-resultado';

// ═══════════════════════════════════════════════════════════════════════════
// EL SISTEMA ÚNICO DE NOTIFICACIONES (toasts) — W2 «producto», 1-oct-2026.
//
// Antes no había ninguno: cada acción de fila pintaba su propio recuadro y, tras
// un `revalidatePath`, el mensaje se iba con la fila que lo mostraba. Ahora hay
// UN proveedor montado en el marco del panel (`chrome.tsx`) y UN hook.
//
// REGLAS (las mismas que se aplican en todas las pantallas):
//  · éxito / info / aviso → región `role="status"` (educada) y se van solos;
//  · ERROR → región `role="alert"` y NO se va solo: un error que desaparece a
//    los 5 s lo pierde quien estaba mirando otra cosa (WCAG 2.2.1). Se cierra
//    con la X o con Esc;
//  · se pausa con el cursor encima o con el foco adentro;
//  · como máximo 4 a la vez (los más viejos salen), y el mismo mensaje repetido
//    no se apila: renueva el que ya está;
//  · sin movimiento si el sistema pide `prefers-reduced-motion`;
//  · CAPA SUPERIOR (identidad Rovaq, 10-nov-2026): el contenedor es un `popover="manual"` siempre abierto y se re-eleva con cada aviso
//    nuevo, así un toast se ve y se cierra ENCIMA de un <dialog> modal (Drawer, Modal, Confirmar); un `z-index` no pasa la capa superior;
//  · la piel es la de `Aviso` (`.rv-aviso`, tono por `data-tono`), sin Tailwind ni `style`.
// ═══════════════════════════════════════════════════════════════════════════

export type TonoNotificacion = 'ok' | 'error' | 'aviso' | 'info';

export interface NuevaNotificacion {
  tono: TonoNotificacion;
  mensaje: string;
  titulo?: string;
  /** Milisegundos hasta que se va sola; `null` = hasta que la cierren. Por omisión:
   *  ok 5 s, info 6 s, aviso 9 s y error `null`. */
  duracionMs?: number | null;
}

interface Notificacion extends NuevaNotificacion { id: number }

export const MAX_NOTIFICACIONES = 4;

const DURACION_POR_TONO: Record<TonoNotificacion, number | null> = { ok: 5_000, info: 6_000, aviso: 9_000, error: null };

/** La política de la cola, PURA (se prueba sin navegador): renueva el mensaje
 *  repetido y recorta a `MAX_NOTIFICACIONES` dejando salir las más viejas. */
export function agregarNotificacion(cola: readonly Notificacion[], nueva: Notificacion): Notificacion[] {
  const sinRepetida = cola.filter((n) => !(n.tono === nueva.tono && n.mensaje === nueva.mensaje && n.titulo === nueva.titulo));
  return [...sinRepetida, nueva].slice(-MAX_NOTIFICACIONES);
}

export function duracionDe(n: NuevaNotificacion): number | null {
  return n.duracionMs === undefined ? DURACION_POR_TONO[n.tono] : n.duracionMs;
}

interface Contexto {
  notificar: (n: NuevaNotificacion) => number;
  descartar: (id: number) => void;
}

const NotificacionesContexto = createContext<Contexto | null>(null);

/** Sin proveedor (una prueba, un preview) NO truena: `notificar` es un no-op.
 *  Un toast perdido es mejor que una pantalla caída por un aviso. */
const SIN_PROVEEDOR: Contexto = { notificar: () => -1, descartar: () => {} };

export function useNotificar(): Contexto {
  return useContext(NotificacionesContexto) ?? SIN_PROVEEDOR;
}

/**
 * Dispara UN toast cada vez que llega un resultado NUEVO de un server action.
 * Pensado para acciones de fila (dar de baja, invitar, borrar un patio): lo que
 * el formulario del renglón no tiene dónde enseñar. El identificador de objeto
 * del `estado` manda: el mismo objeto no vuelve a notificar en un re-render.
 */
export function useNotificarResultado(estado: ResultadoUI): void {
  const { notificar } = useNotificar();
  const visto = useRef<unknown>(null);
  useEffect(() => {
    if (!estado || visto.current === estado) return;
    visto.current = estado;
    const r = leerResultado(estado);
    if (r) notificar({ tono: r.tono, mensaje: r.texto });
  }, [estado, notificar]);
}

export function ProveedorNotificaciones({ children }: { children: React.ReactNode }) {
  const [cola, setCola] = useState<Notificacion[]>([]);
  const siguiente = useRef(1);

  const descartar = useCallback((id: number) => setCola((c) => c.filter((n) => n.id !== id)), []);
  const notificar = useCallback((n: NuevaNotificacion) => {
    const id = siguiente.current++;
    setCola((c) => agregarNotificacion(c, { ...n, id }));
    return id;
  }, []);

  // Esc cierra la más reciente — salvo que haya un diálogo modal abierto, que
  // se queda con su propio Esc.
  useEffect(() => {
    if (cola.length === 0) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('dialog[open]')) return;
      setCola((c) => c.slice(0, -1));
    };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [cola.length]);

  const valor = useMemo(() => ({ notificar, descartar }), [notificar, descartar]);
  const errores = cola.filter((n) => n.tono === 'error');
  const demas = cola.filter((n) => n.tono !== 'error');

  // Capa superior: el popover manual se abre al montar y se vuelve a abrir (queda por ENCIMA de los <dialog> abiertos después) cuando llega
  // un aviso nuevo. Sin la API (navegador viejo, jsdom) queda el `position: fixed` normal del CSS.
  const capa = useRef<HTMLDivElement>(null);
  const ultimoId = cola.length ? cola[cola.length - 1].id : 0;
  useLayoutEffect(() => {
    const el = capa.current;
    if (!el || typeof el.showPopover !== 'function') return;
    try {
      if (el.matches(':popover-open')) el.hidePopover();
      el.showPopover();
    } catch { /* sin soporte: queda como capa fija normal */ }
  }, [ultimoId]);

  return (
    <NotificacionesContexto.Provider value={valor}>
      {children}
      {/* Dos regiones, SIEMPRE montadas: un `aria-live` que aparece junto con su
          texto no se anuncia (el lector necesita la región ya existente). */}
      <div ref={capa} popover="manual" className="rv-toasts">
        <div role="alert" aria-live="assertive" className="rv-toasts__region">
          {errores.map((n) => <Toast key={n.id} n={n} descartar={descartar} />)}
        </div>
        <div role="status" aria-live="polite" className="rv-toasts__region">
          {demas.map((n) => <Toast key={n.id} n={n} descartar={descartar} />)}
        </div>
      </div>
    </NotificacionesContexto.Provider>
  );
}

/** Tono del toast → tono de `Aviso` (`warn` se llama `aviso` aquí por historia) e icono del mismo juego. */
const PIEL: Record<TonoNotificacion, { tono: 'ok' | 'error' | 'warn' | 'info'; Icono: typeof Info }> = {
  ok: { tono: 'ok', Icono: Check },
  error: { tono: 'error', Icono: OctagonAlert },
  aviso: { tono: 'warn', Icono: AlertTriangle },
  info: { tono: 'info', Icono: Info },
};

function Toast({ n, descartar }: { n: Notificacion; descartar: (id: number) => void }) {
  const [pausado, setPausado] = useState(false);
  const ms = duracionDe(n);
  useEffect(() => {
    if (ms === null || pausado) return;
    const t = setTimeout(() => descartar(n.id), ms);
    return () => clearTimeout(t);
  }, [ms, pausado, n.id, descartar]);

  const { tono, Icono } = PIEL[n.tono];
  return (
    <div
      className="rv-aviso rv-toast"
      data-tono={tono}
      onMouseEnter={() => setPausado(true)} onMouseLeave={() => setPausado(false)}
      onFocus={() => setPausado(true)} onBlur={() => setPausado(false)}
    >
      <Icono className="rv-aviso__icono" width={14} height={14} strokeWidth={2} aria-hidden="true" />
      <div className="rv-aviso__cuerpo">
        {n.titulo ? <strong className="rv-aviso__titulo">{n.titulo}</strong> : null}
        <span>{n.mensaje}</span>
      </div>
      <button type="button" className="rv-toast__x" onClick={() => descartar(n.id)} aria-label="Cerrar aviso">
        <X aria-hidden="true" width={14} height={14} strokeWidth={2} />
      </button>
    </div>
  );
}
