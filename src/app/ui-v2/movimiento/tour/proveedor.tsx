'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { crearEstadoLocal, debeInvitar, debeMostrarPista, ESTADO_VACIO, escribirMarcaSesion, leerMarcaSesion, onboardingDesactivado, type AlmacenEstado, type EstadoOnboarding } from '@/app/ui-v2/onboarding/estado';
import { pistaDeRuta } from '@/app/ui-v2/onboarding/pista';
import { pantallasDeRecorrido } from '@/app/ui-v2/onboarding/recorrido-util';
import type { Modo, PistaContextual as PistaDatos } from '@/app/ui-v2/onboarding/tipos';
import { CapaTour } from './capa';
import { ControladorTour, rutaCoincide } from './controlador';
import { crearAnfitrionDom } from './anfitrion-dom';
import { InvitacionRecorrido } from './invitacion';
import { PistaContextual } from './pista';
import { leerGuardado, type EstadoGuardado } from './persistencia';
import type { Anfitrion, Recorrido } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// TourProvider: el layout lo monta UNA vez dentro del chrome v2.
//  · `recorridos` y `rutasPermitidas` son datos serializables (el layout es un Server Component): los pasos de rutas fuera de
//    la lista se quitan.
//  · Un recorrido solo empieza porque la persona lo pide (Guía, la invitación del primer ingreso o un botón); nunca de fondo.
//  · `ambito` = tenant y usuario, para no cruzar progreso en un mismo navegador; `soloLectura` = superadmin «viendo como»:
//    no escribe progreso, no invita y no muestra pistas (sí puede abrir el recorrido a mano).
//  · `principal` = la pista de la persona (`dueno`, `encargado`…): sus recorridos son `<principal>.corto` y `<principal>.completo`.
// ═══════════════════════════════════════════════════════════════════════════

/** Lo que cuenta como «algo abierto encima»: diálogo nativo, menú/popover, avisos (alert y status de la región de avisos). */
const SUPERPUESTO = 'dialog[open], .rv-pop, .pointer-events-none.fixed [role="alert"] > *, .pointer-events-none.fixed [role="status"] > *';

export interface ProgresoTour { estado: EstadoGuardado; indice: number; total: number }
export interface MetaRecorrido { id: string; titulo: string }

interface Api {
  iniciar: (id: string) => void;
  reanudar: (id: string) => void;
  reiniciar: (id: string) => void;
  /** Abre el recorrido en el primer paso de esa pantalla. */
  irAPantalla: (id: string, href: string) => void;
  existe: (id: string) => boolean;
  pantallas: (id: string) => Array<{ href: string; nombre: string }>;
  /** Recorridos por agente (`agente.<id>`), en el orden recibido. */
  agentes: MetaRecorrido[];
  principal: string | null;
  asistente: { href: string; nombre: string } | null;
  /** «No volver a mostrar»: apaga la invitación y las pistas; el recorrido sigue en la Guía. */
  noVolver: () => void;
  /** ¿Todavía no se le ha ofrecido el recorrido? (punto en el botón Guía). */
  nuevo: boolean;
  suscribirProgreso: (fn: () => void) => () => void;
  claveProgreso: (id: string) => string;
}
const Contexto = createContext<Api | null>(null);

export function TourProvider({ recorridos, ambito, soloLectura = false, rutasPermitidas, principal = null, asistente = null, pistas = {}, invitacion = false, children }: {
  recorridos: Recorrido[];
  ambito: string;
  soloLectura?: boolean;
  rutasPermitidas?: readonly string[];
  principal?: string | null;
  asistente?: { href: string; nombre: string } | null;
  pistas?: Record<string, PistaDatos>;
  /** Interruptor de servidor (`ONBOARDING_INVITACION=1`): sin él la invitación de primer ingreso NO se muestra; Guía, recorridos y pistas siguen. */
  invitacion?: boolean;
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
  // Estado cosmético (visto, descartado, pistas). null hasta montar en el navegador: el HTML del servidor nunca invita.
  const [est, setEst] = useState<EstadoOnboarding | null>(null);
  const almacenEstado = useRef<AlmacenEstado | null>(null);
  const [apagado, setApagado] = useState(false);

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

  // Estado: se lee ya montado (localStorage no existe en el servidor).
  useEffect(() => {
    const alm = host().almacen;
    setApagado(onboardingDesactivado(alm));
    almacenEstado.current = crearEstadoLocal(ambito, alm);
    const leido = almacenEstado.current.leer();
    setEst(!leido.visto && leerMarcaSesion() ? { ...leido, visto: true } : leido);
  }, [ambito, host]);

  const guardarEst = useCallback((parche: Partial<EstadoOnboarding>) => {
    if (soloLectura || !almacenEstado.current) return;
    setEst(almacenEstado.current.guardar(parche));
    if (parche.visto || parche.descartado) escribirMarcaSesion();
  }, [soloLectura]);

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

  const abrir = useCallback((id: string, como: 'iniciar' | 'reanudar' | 'reiniciar' | { pantalla: string }) => {
    const c = controlador(id);
    if (!c) return;
    if (activoRef.current && activoRef.current !== c) activoRef.current.masTarde();
    activoRef.current = c;
    setActivo(c);
    if (como === 'reanudar') c.reanudar();
    else if (como === 'reiniciar') c.reiniciar();
    else if (como === 'iniciar') c.iniciar();
    else c.irAPantalla(como.pantalla);
    // Elegir cualquier recorrido cuenta como «ya se le ofreció»: la invitación no vuelve.
    guardarEst({ visto: true, ...(id.endsWith('.corto') ? { modo: 'corto' as Modo } : id.endsWith('.completo') ? { modo: 'completo' as Modo } : {}) });
  }, [controlador, guardarEst]);

  // Al cerrarse el recorrido activo, se suelta la capa y se avisa a los lanzadores.
  useEffect(() => {
    if (!activo) return;
    return activo.suscribir(() => {
      if (activo.instantanea().fase !== 'activo') { activoRef.current = null; setActivo(null); }
      avisar();
    });
  }, [activo, avisar]);

  useEffect(() => () => { for (const c of controladores.current.values()) c.destruir(); controladores.current.clear(); }, []);

  const agentes = useMemo<MetaRecorrido[]>(
    () => recorridos.filter((r) => r.id.startsWith('agente.')).map((r) => ({ id: r.id, titulo: r.titulo })),
    [recorridos],
  );

  const api = useMemo<Api>(() => ({
    iniciar: (id) => abrir(id, 'iniciar'),
    reanudar: (id) => abrir(id, 'reanudar'),
    reiniciar: (id) => abrir(id, 'reiniciar'),
    irAPantalla: (id, href) => abrir(id, { pantalla: href }),
    existe: (id) => recorridos.some((r) => r.id === id),
    pantallas: (id) => {
      const r = recorridos.find((x) => x.id === id);
      return r ? pantallasDeRecorrido(r).map(({ href, nombre }) => ({ href, nombre })) : [];
    },
    agentes,
    principal,
    asistente,
    noVolver: () => guardarEst({ descartado: true, visto: true }),
    nuevo: est !== null && !est.visto && !est.descartado && !soloLectura,
    suscribirProgreso: (fn) => { oyentes.current.add(fn); return () => { oyentes.current.delete(fn); }; },
    claveProgreso: (id) => {
      const r = recorridos.find((x) => x.id === id);
      if (!r || typeof window === 'undefined') return '';
      const c = controlador(id);
      const g = c ? c.progreso() : leerGuardado(host().almacen, ambito, r);
      return g ? `${g.estado}:${g.indice}:${c ? c.total : r.pasos.length}` : '';
    },
  }), [abrir, recorridos, controlador, host, ambito, agentes, principal, asistente, guardarEst, est, soloLectura]);

  // Nunca se invita ni se muestra una pista mientras haya un diálogo, un menú, un cajón o un aviso abiertos: se espera a que se cierren.
  const [superpuesto, setSuperpuesto] = useState(false);
  const pendiente = est !== null && !activo;
  useEffect(() => {
    if (!pendiente) return;
    const medir = () => setSuperpuesto(Boolean(document.querySelector(SUPERPUESTO)) || document.documentElement.hasAttribute('data-overlay-abierto'));
    medir();
    const id = window.setInterval(medir, 400);
    return () => window.clearInterval(id);
  }, [pendiente, pathname]);

  const opciones = { soloLectura, desactivado: apagado };
  const invitar = invitacion && !superpuesto && !activo && est !== null && principal !== null && recorridos.some((r) => r.id === `${principal}.corto`) && debeInvitar(est, opciones);
  const pista = !activo && !invitar && !superpuesto && est !== null ? pistaDeRuta(pathname ?? '', pistas) : null;
  const mostrarPista = pista !== null && debeMostrarPista(est ?? ESTADO_VACIO, pista.ruta, opciones);
  // Si la persona se va a otra pantalla con la invitación abierta, la ignoró: cuenta como «ahora no» y no sigue tapando las demás pantallas.
  const rutaInvitacion = useRef<string | null>(null);
  useEffect(() => {
    if (invitar && rutaInvitacion.current === null) rutaInvitacion.current = pathname ?? '';
    else if (rutaInvitacion.current !== null && (pathname ?? '') !== rutaInvitacion.current) { rutaInvitacion.current = null; guardarEst({ visto: true }); }
  }, [invitar, pathname, guardarEst]);
  const principalCompleto = recorridos.find((r) => r.id === `${principal}.completo`);

  return (
    <Contexto.Provider value={api}>
      {children}
      {activo ? <CapaTour controlador={activo} /> : null}
      {/* La invitación y la pista llevan SU PROPIA piel v2 (`data-ui`) y el z-index del recorrido (55, `.rv-tour`): fuera del chrome v2
          no heredan los tokens y saldrían con la piel de v1. */}
      {invitar || mostrarPista ? (
        <div className="rv-tour" data-ui="v2">
          {invitar ? (
            <InvitacionRecorrido
              titulo={(principalCompleto?.titulo ?? 'Recorrido').replace(/^Recorrido: /, '')}
              asistente={asistente?.nombre ?? null}
              onElegir={(modo) => abrir(`${principal}.${modo}`, 'reiniciar')}
              onAhoraNo={() => guardarEst({ visto: true })}
              onNoVolver={() => guardarEst({ descartado: true, visto: true })}
            />
          ) : null}
          {mostrarPista && pista ? (
            <PistaContextual
              titulo={pista.titulo} texto={pista.texto} ilu={pista.ilu} desde={pista.desde}
              onEntendido={() => guardarEst({ pistas: [...(est?.pistas ?? []), pista.ruta] })}
              onNoVolver={() => guardarEst({ descartado: true })}
            />
          ) : null}
        </div>
      ) : null}
    </Contexto.Provider>
  );
}

export function useTour() {
  const api = useContext(Contexto);
  if (!api) throw new Error('useTour: falta <TourProvider> en el layout.');
  return api;
}

/** Como `useTour`, pero devuelve null cuando no hay `<TourProvider>` (v2 sin perfil: el layout no lo monta). */
export function useTourOpcional() {
  return useContext(Contexto);
}

/** Progreso guardado de un recorrido (null en servidor y sin progreso): sin desajuste de hidratación. */
export function useProgresoTour(id: string): ProgresoTour | null {
  const api = useTour();
  const clave = useSyncExternalStore(api.suscribirProgreso, () => api.claveProgreso(id), () => '');
  if (!clave) return null;
  const [estado, indice, total] = clave.split(':');
  return { estado: estado as EstadoGuardado, indice: Number(indice), total: Number(total) };
}
