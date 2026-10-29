'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { CapaTour } from './capa';
import { ControladorTour, rutaCoincide } from './controlador';
import { crearAnfitrionDom } from './anfitrion-dom';
import { leerGuardado, type EstadoGuardado } from './persistencia';
import type { Anfitrion, Recorrido } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// TourProvider: el layout (carril A) lo monta UNA vez dentro del chrome v2.
//  · `recorridos` y `rutasPermitidas` son datos serializables (el layout es un
//    Server Component): los pasos de rutas fuera de la lista se quitan.
//  · Nunca abre un recorrido por sí mismo: lo abre `iniciar()` (un botón).
//  · `ambito` = id de usuario (y tenant) para no cruzar progreso en un mismo
//    navegador; `soloLectura` = superadmin «viendo como»: no escribe progreso.
// ═══════════════════════════════════════════════════════════════════════════

export interface ProgresoTour { estado: EstadoGuardado; indice: number; total: number }

interface Api {
  iniciar: (id: string) => void;
  reanudar: (id: string) => void;
  reiniciar: (id: string) => void;
  existe: (id: string) => boolean;
  suscribirProgreso: (fn: () => void) => () => void;
  claveProgreso: (id: string) => string;
}
const Contexto = createContext<Api | null>(null);

export function TourProvider({ recorridos, ambito, soloLectura = false, rutasPermitidas, children }: {
  recorridos: Recorrido[];
  ambito: string;
  soloLectura?: boolean;
  rutasPermitidas?: readonly string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const rutaRef = useRef(pathname);
  const routerRef = useRef(router);
  const hostRef = useRef<Anfitrion | null>(null);
  const controladores = useRef(new Map<string, ControladorTour>());
  const oyentes = useRef(new Set<() => void>());
  const [activo, setActivo] = useState<ControladorTour | null>(null);
  const activoRef = useRef<ControladorTour | null>(null);

  useEffect(() => { routerRef.current = router; }, [router]);
  useEffect(() => {
    rutaRef.current = pathname;
    activo?.alCambiarRuta();
  }, [pathname, activo]);

  const avisar = useCallback(() => { for (const o of [...oyentes.current]) o(); }, []);

  const host = useCallback((): Anfitrion => {
    hostRef.current ??= crearAnfitrionDom({
      navegar: (r) => routerRef.current.push(r),
      rutaActual: () => rutaRef.current ?? window.location.pathname,
    });
    return hostRef.current;
  }, []);

  const controlador = useCallback((id: string): ControladorTour | null => {
    const previo = controladores.current.get(id);
    if (previo) return previo;
    const r = recorridos.find((x) => x.id === id);
    if (!r) return null;
    const c = new ControladorTour(r, host(), {
      ambito,
      soloLectura,
      puedeVerRuta: rutasPermitidas ? (ruta) => rutasPermitidas.some((p) => rutaCoincide(ruta, p)) : undefined,
    });
    controladores.current.set(id, c);
    return c;
  }, [recorridos, host, ambito, soloLectura, rutasPermitidas]);

  const abrir = useCallback((id: string, como: 'iniciar' | 'reanudar' | 'reiniciar') => {
    const c = controlador(id);
    if (!c) return;
    if (activoRef.current && activoRef.current !== c) activoRef.current.masTarde();
    activoRef.current = c;
    setActivo(c);
    if (como === 'reanudar') c.reanudar(); else if (como === 'reiniciar') c.reiniciar(); else c.iniciar();
  }, [controlador]);

  // Al cerrarse el recorrido activo, se suelta la capa y se avisa a los lanzadores.
  useEffect(() => {
    if (!activo) return;
    return activo.suscribir(() => {
      if (activo.instantanea().fase !== 'activo') { activoRef.current = null; setActivo(null); }
      avisar();
    });
  }, [activo, avisar]);

  useEffect(() => () => { for (const c of controladores.current.values()) c.destruir(); controladores.current.clear(); }, []);

  const api = useMemo<Api>(() => ({
    iniciar: (id) => abrir(id, 'iniciar'),
    reanudar: (id) => abrir(id, 'reanudar'),
    reiniciar: (id) => abrir(id, 'reiniciar'),
    existe: (id) => recorridos.some((r) => r.id === id),
    suscribirProgreso: (fn) => { oyentes.current.add(fn); return () => { oyentes.current.delete(fn); }; },
    claveProgreso: (id) => {
      const r = recorridos.find((x) => x.id === id);
      if (!r || typeof window === 'undefined') return '';
      const c = controlador(id);
      const g = c ? c.progreso() : leerGuardado(host().almacen, ambito, r);
      return g ? `${g.estado}:${g.indice}:${c ? c.total : r.pasos.length}` : '';
    },
  }), [abrir, recorridos, controlador, host, ambito]);

  return (
    <Contexto.Provider value={api}>
      {children}
      {activo ? <CapaTour controlador={activo} /> : null}
    </Contexto.Provider>
  );
}

export function useTour() {
  const api = useContext(Contexto);
  if (!api) throw new Error('useTour: falta <TourProvider> en el layout.');
  return api;
}

/** Progreso guardado de un recorrido (null en servidor y sin progreso): sin desajuste de hidratación. */
export function useProgresoTour(id: string): ProgresoTour | null {
  const api = useTour();
  const clave = useSyncExternalStore(api.suscribirProgreso, () => api.claveProgreso(id), () => '');
  if (!clave) return null;
  const [estado, indice, total] = clave.split(':');
  return { estado: estado as EstadoGuardado, indice: Number(indice), total: Number(total) };
}
