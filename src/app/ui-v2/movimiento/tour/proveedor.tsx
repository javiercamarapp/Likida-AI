'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { crearEstadoLocal, debeInvitar, debeMostrarPista, ESTADO_VACIO, escribirMarcaSesion, leerMarcaSesion, onboardingDesactivado, type AlmacenEstado, type EstadoOnboarding } from '@/app/ui-v2/onboarding/estado';
import { cosmeticoDeServidor, fusionarParches, hayEstadoLocal, parcheDeImportacion } from '@/app/ui-v2/onboarding/estado_remoto';
import { pistaDeRuta } from '@/app/ui-v2/onboarding/pista';
import type { EstadoGuia, EventoGuiaEntrante, InvitacionGuia, ParcheEstadoGuia } from '@/lib/likida/guia/tipos';
import { pantallasDeRecorrido } from '@/app/ui-v2/onboarding/recorrido-util';
import type { Modo, PistaContextual as PistaDatos } from '@/app/ui-v2/onboarding/tipos';
import { CapaTour } from './capa';
import { ControladorTour, rutaCoincide } from './controlador';
import { crearAnfitrionDom } from './anfitrion-dom';
import { InvitacionRecorrido } from './invitacion';
import { PistaContextual } from './pista';
import { leerGuardado, type EstadoGuardado } from './persistencia';
import type { Anfitrion, EventoControlador, LecturaSenal, Recorrido } from './tipos';

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

/** Lo que el proveedor necesita de la respuesta de `guardarEstadoGuia` (las demás llaves se ignoran). */
export interface RespuestaGuardarRemoto { ok: boolean; version?: number; actual?: { version: number } }
const SIN_DATO: LecturaSenal = { estado: 'sin_dato' };

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

export function TourProvider({ recorridos, ambito, soloLectura = false, rutasPermitidas, principal = null, asistente = null, pistas = {}, invitacion = false, estadoServidor = null, guardarRemoto, leerSenales, registrarEventos, children }: {
  recorridos: Recorrido[];
  ambito: string;
  soloLectura?: boolean;
  rutasPermitidas?: readonly string[];
  principal?: string | null;
  asistente?: { href: string; nombre: string } | null;
  pistas?: Record<string, PistaDatos>;
  /** Interruptor de servidor (`ONBOARDING_INVITACION=1`): sin él la invitación de primer ingreso NO se muestra; Guía, recorridos y pistas siguen. */
  invitacion?: boolean;
  /** Estado de la guía leído en el servidor para ESTA persona y flota (`version` 0 = todavía sin fila). `null` = no disponible: la guía sigue con su respaldo local. */
  estadoServidor?: { estado: EstadoGuia; version: number } | null;
  /** Escribe el estado en servidor (server action `guardarEstadoGuia`). Con «ver como» no se usa. */
  guardarRemoto?: (parche: ParcheEstadoGuia, versionEsperada: number) => Promise<RespuestaGuardarRemoto>;
  /** Lee señales medidas por el servidor (server action `leerSenalesDeLaGuia`). Sin ella los pasos «hacer» quedan en «sin dato». */
  leerSenales?: (ids: string[]) => Promise<Record<string, LecturaSenal>>;
  /** Envía eventos de aprendizaje sin PII (server action `registrarEventosGuia`; el servidor decide si los guarda). */
  registrarEventos?: (lote: EventoGuiaEntrante[]) => Promise<unknown>;
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

  const leerSenalesRef = useRef(leerSenales);
  useEffect(() => { leerSenalesRef.current = leerSenales; }, [leerSenales]);

  const host = useCallback((): Anfitrion => {
    hostRef.current ??= crearAnfitrionDom({
      navegar: (r) => routerRef.current.push(r),
      rutaActual: () => rutaRef.current ?? window.location.pathname,
      leerSenal: async (id) => {
        try { return (await leerSenalesRef.current?.([id]))?.[id] ?? SIN_DATO; } catch { return SIN_DATO; }
      },
    });
    return hostRef.current;
  }, []);

  // ── Estado en servidor (SPEC 2.4): escritura con debounce de 800 ms, control optimista por versión (un reintento) y sin bloquear nunca.
  // `localStorage` queda como caché y para el caso sin red. Con «ver como» o sin estado de servidor no se escribe nada.
  const versionRef = useRef(estadoServidor?.version ?? 0);
  const ofertasRef = useRef(estadoServidor?.estado.ofertas ?? 0);
  const invitacionRef = useRef<InvitacionGuia>(estadoServidor?.estado.invitacion ?? 'pendiente');
  const pendienteRef = useRef<ParcheEstadoGuia | null>(null);
  const temporizadorRef = useRef<number | null>(null);
  const inicios = useRef(new Map<string, string>());
  const remotoActivo = !soloLectura && Boolean(guardarRemoto) && estadoServidor !== null;

  const enviarRemoto = useCallback(async () => {
    const parche = pendienteRef.current;
    pendienteRef.current = null;
    temporizadorRef.current = null;
    if (!parche || !guardarRemoto) return;
    try {
      for (let intento = 0; intento < 2; intento++) {
        const r = await guardarRemoto(parche, versionRef.current);
        if (r.ok) { if (typeof r.version === 'number') versionRef.current = r.version; return; }
        if (r.actual) versionRef.current = r.actual.version; else return; // solo el choque de versión se reintenta
      }
    } catch { /* sin red: el avance sigue en este navegador */ }
  }, [guardarRemoto]);

  const encolarRemoto = useCallback((parche: ParcheEstadoGuia) => {
    if (!remotoActivo) return;
    pendienteRef.current = pendienteRef.current ? fusionarParches(pendienteRef.current, parche) : parche;
    if (temporizadorRef.current !== null) window.clearTimeout(temporizadorRef.current);
    temporizadorRef.current = window.setTimeout(() => { void enviarRemoto(); }, 800);
  }, [remotoActivo, enviarRemoto]);

  // Al ocultar la pestaña se envía lo pendiente al instante (mejor esfuerzo).
  useEffect(() => {
    const alOcultar = () => { if (document.visibilityState === 'hidden' && pendienteRef.current) { if (temporizadorRef.current !== null) window.clearTimeout(temporizadorRef.current); void enviarRemoto(); } };
    document.addEventListener('visibilitychange', alOcultar);
    return () => document.removeEventListener('visibilitychange', alOcultar);
  }, [enviarRemoto]);

  // Eventos de aprendizaje: lotes de hasta 20 cada 4 s. El servidor decide si los guarda (interruptor de código) y los limita.
  const eventosRef = useRef<EventoGuiaEntrante[]>([]);
  const temporizadorEventos = useRef<number | null>(null);
  const encolarEvento = useCallback((e: EventoGuiaEntrante) => {
    if (soloLectura || !registrarEventos) return;
    eventosRef.current.push(e);
    if (temporizadorEventos.current !== null) return;
    temporizadorEventos.current = window.setTimeout(() => {
      temporizadorEventos.current = null;
      const lote = eventosRef.current.splice(0, 20);
      if (lote.length > 0) void registrarEventos(lote).catch(() => undefined);
    }, 4000);
  }, [soloLectura, registrarEventos]);

  // Estado: se lee ya montado (localStorage no existe en el servidor).
  useEffect(() => {
    const alm = host().almacen;
    setApagado(onboardingDesactivado(alm));
    almacenEstado.current = crearEstadoLocal(ambito, alm);
    const leido = almacenEstado.current.leer();
    if (estadoServidor && estadoServidor.version > 0) {
      // El servidor manda; el navegador solo guarda una copia para la próxima vez sin red.
      const delServidor = cosmeticoDeServidor(estadoServidor.estado);
      setEst(almacenEstado.current.guardar(delServidor));
      return;
    }
    if (estadoServidor && hayEstadoLocal(leido) && !soloLectura) encolarRemoto(parcheDeImportacion(leido)); // migración única desde local
    setEst(!leido.visto && leerMarcaSesion() ? { ...leido, visto: true } : leido);
    // Solo al montar o al cambiar de persona: `estadoServidor` y `encolarRemoto` no deben reiniciar la lectura.
  }, [ambito, host]);

  const guardarEst = useCallback((parche: Partial<EstadoOnboarding>, remoto?: ParcheEstadoGuia) => {
    if (soloLectura || !almacenEstado.current) return;
    setEst(almacenEstado.current.guardar(parche));
    if (parche.visto || parche.descartado) escribirMarcaSesion();
    if (remoto) {
      if (remoto.invitacion) invitacionRef.current = remoto.invitacion;
      if (typeof remoto.ofertas === 'number') ofertasRef.current = remoto.ofertas;
      encolarRemoto(remoto);
    }
  }, [soloLectura, encolarRemoto]);

  // El avance de cada recorrido (paso, hechos, omitidos, confirmados) se guarda en servidor; el evento anónimo va aparte.
  const alEventoRef = useRef<(id: string, e: EventoControlador) => void>(() => undefined);
  const controlador = useCallback((id: string): ControladorTour | null => {
    const previo = controladores.current.get(id);
    if (previo) return previo;
    const r = recorridos.find((x) => x.id === id);
    if (!r) return null;
    const c = new ControladorTour(r, host(), {
      ambito,
      soloLectura,
      puedeVerRuta: rutasPermitidas ? (ruta) => rutasPermitidas.some((p) => rutaCoincide(ruta, p)) : undefined,
      alEvento: (e) => alEventoRef.current(id, e),
    });
    controladores.current.set(id, c);
    return c;
  }, [recorridos, host, ambito, soloLectura, rutasPermitidas]);

  useEffect(() => {
    alEventoRef.current = (id, e) => {
      const c = controladores.current.get(id);
      const r = recorridos.find((x) => x.id === id);
      if (!c || !r) return;
      const inicio = inicios.current.get(id) ?? estadoServidor?.estado.recorridos[id]?.inicio ?? new Date().toISOString();
      inicios.current.set(id, inicio);
      const { hechos, confirmados, omitidos } = c.resultados();
      encolarRemoto({ recorridos: { [id]: { paso: e.pasoId, hechos, omitidos, confirmados, inicio, fin: null, version: r.version } } });
      encolarEvento({ tipo: e.tipo, recorrido: id, pasoId: e.pasoId, canal: window.innerWidth < 768 ? 'movil' : 'escritorio', reducido: c.instantanea().reducirMovimiento });
    };
  }, [recorridos, encolarRemoto, encolarEvento, estadoServidor]);

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
    const modo: Modo | undefined = id.endsWith('.corto') ? 'corto' : id.endsWith('.completo') ? 'completo' : undefined;
    guardarEst({ visto: true, ...(modo ? { modo } : {}) }, { ...(invitacionRef.current === 'descartada' ? {} : { invitacion: 'vista' as const }), ...(modo ? { modo } : {}) });
    encolarEvento({ tipo: como === 'reanudar' ? 'retomar' : como === 'reiniciar' ? 'repeticion' : 'guia_inicio', recorrido: id, canal: window.innerWidth < 768 ? 'movil' : 'escritorio', reducido: c.instantanea().reducirMovimiento });
  }, [controlador, guardarEst, encolarEvento]);

  // Al cerrarse el recorrido activo, se suelta la capa y se avisa a los lanzadores.
  useEffect(() => {
    if (!activo) return;
    return activo.suscribir(() => {
      const fase = activo.instantanea().fase;
      if (fase !== 'activo') {
        if (fase === 'terminado') {
          const id = activo.recorrido.id;
          const { hechos, confirmados, omitidos } = activo.resultados();
          const inicio = inicios.current.get(id) ?? new Date().toISOString();
          const ultimo = activo.recorrido.pasos[activo.recorrido.pasos.length - 1]?.id ?? '';
          encolarRemoto({ recorridos: { [id]: { paso: ultimo, hechos, omitidos, confirmados, inicio, fin: new Date().toISOString(), version: activo.recorrido.version } } });
          encolarEvento({ tipo: 'guia_terminada', recorrido: id, canal: window.innerWidth < 768 ? 'movil' : 'escritorio', reducido: activo.instantanea().reducirMovimiento });
        }
        activoRef.current = null; setActivo(null);
      }
      avisar();
    });
  }, [activo, avisar, encolarRemoto, encolarEvento]);

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
    noVolver: () => guardarEst({ descartado: true, visto: true }, { invitacion: 'descartada' }),
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
    // Sin intervalo perpetuo (SPEC 2.5): se mide solo cuando el documento cambia, una vez por cuadro.
    let agendado = false;
    const agendar = () => { if (agendado) return; agendado = true; requestAnimationFrame(() => { agendado = false; medir(); }); };
    const observador = new MutationObserver(agendar);
    observador.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'class'] });
    observador.observe(document.documentElement, { attributes: true, attributeFilter: ['data-overlay-abierto'] });
    return () => observador.disconnect();
  }, [pendiente, pathname]);

  const opciones = { soloLectura, desactivado: apagado };
  const invitar = invitacion && !superpuesto && !activo && est !== null && principal !== null && recorridos.some((r) => r.id === `${principal}.corto`) && debeInvitar(est, opciones);
  const pista = !activo && !invitar && !superpuesto && est !== null ? pistaDeRuta(pathname ?? '', pistas) : null;
  const mostrarPista = pista !== null && debeMostrarPista(est ?? ESTADO_VACIO, pista.ruta, opciones);
  // Si la persona se va a otra pantalla con la invitación abierta, la ignoró: cuenta como «ahora no» y no sigue tapando las demás pantallas.
  const rutaInvitacion = useRef<string | null>(null);
  useEffect(() => {
    if (invitar && rutaInvitacion.current === null) rutaInvitacion.current = pathname ?? '';
    else if (rutaInvitacion.current !== null && (pathname ?? '') !== rutaInvitacion.current) { rutaInvitacion.current = null; guardarEst({ visto: true }, { invitacion: 'ahora_no', ofertas: ofertasRef.current + 1 }); }
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
              onAhoraNo={() => guardarEst({ visto: true }, { invitacion: 'ahora_no', ofertas: ofertasRef.current + 1 })}
              onNoVolver={() => guardarEst({ descartado: true, visto: true }, { invitacion: 'descartada' })}
            />
          ) : null}
          {mostrarPista && pista ? (
            <PistaContextual
              titulo={pista.titulo} texto={pista.texto} ilu={pista.ilu} desde={pista.desde}
              onEntendido={() => { const pistasNuevas = [...(est?.pistas ?? []), pista.ruta]; guardarEst({ pistas: pistasNuevas }, { pistas: pistasNuevas }); }}
              onNoVolver={() => guardarEst({ descartado: true }, { invitacion: 'descartada' })}
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
