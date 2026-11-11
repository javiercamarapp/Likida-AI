'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { horaMx } from '@/lib/formato';
import { PANTALLA_UI } from './etiquetas-copiloto';
import { respuestaDeBloques, type PasoTraza, type Respuesta } from './respuestas';
import { PERFIL_SUPERADMIN } from './perfiles';
import { cerrarPaso, leerRespuestaAgente } from './transporte';
import type { Motor } from './motor';
import type { Conversacion, Turno } from './use-analista';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTADOR SUPERADMIN del agente de conversación: el estado y el transporte del Copiloto del fundador (/api/admin/copiloto).
// Misma forma (`Motor`) que el adaptador del cliente; lo propio de este modo sigue aquí y no en la interfaz:
//   · la confirmación de una acción NO es del modelo ni del cliente: el servidor crea un AdminActionIntent al proponer y el botón
//     (tarjeta-accion.tsx) manda un POST aparte con ESA llave; aquí solo se pinta la propuesta (`accion`), jamás se ejecuta.
//   · un turno reabierto del historial trae su acción ARCHIVADA (sin botón): la previsualización vieja no ejecuta.
//   · las fuentes clicables salen de qué tools corrieron (dato del servidor), nunca de lo que diga el modelo.
// El AbortController se cancela al desmontar (FE-24): cerrar el panel no deja un stream gastando tokens para nadie.
// ═══════════════════════════════════════════════════════════════════════════

const TIEMPO_MAXIMO_MS = 75_000;
const mensajeFallo = (tx: TResto = T_RESTO_ES) => (tx('ch.el_copiloto_no_pudo_responder_en'));
let contador = 0;
const nuevoId = () => `c-${Date.now().toString(36)}-${++contador}`;

export function useCopiloto({ endpoint = '/api/admin/copiloto', listaAlMontar = true }: { endpoint?: string; listaAlMontar?: boolean } = {}): Motor {
  const { t: tx } = useT('resto', restoEs);
  const [historial, setHistorial] = useState<Turno[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [conversacionId, setConversacionId] = useState<string | null>(null);
  const [convs, setConvs] = useState<Conversacion[] | 'error' | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [fasePensando, setFasePensando] = useState('Pensando…');
  const [pasosVivos, setPasosVivos] = useState<PasoTraza[]>([]);
  const enVuelo = useRef<AbortController | null>(null);
  const detenido = useRef(false);

  // La lista del historial: null = cargando, 'error' = no se pudo leer (y se DICE: una lista vacía por error afirmaría «no has chateado»).
  const cargarLista = useCallback(() => {
    fetch(`${endpoint}/conversaciones`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setConvs(Array.isArray(d?.conversaciones) ? d.conversaciones : 'error'))
      .catch(() => setConvs('error'));
  }, [endpoint]);
  useEffect(() => { if (listaAlMontar) cargarLista(); }, [listaAlMontar, cargarLista]);
  useEffect(() => () => enVuelo.current?.abort(), []);

  // Atajos: el ⌘K (y cualquier otro punto de /admin) pide una pregunta con `likida:copiloto-preguntar`. Solo escucha el panel lateral
  // (que vive en todas las pantallas) para que una pregunta no se envíe dos veces cuando la página del Copiloto también está montada.
  const preguntarRef = useRef<(q: string) => void>(() => {});
  useEffect(() => {
    if (listaAlMontar) return;
    function alPreguntar(e: Event) {
      const q = (e as CustomEvent<{ pregunta?: unknown }>).detail?.pregunta;
      if (typeof q === 'string' && q.trim()) preguntarRef.current(q.trim().slice(0, 2000));
    }
    window.addEventListener('likida:copiloto-preguntar', alPreguntar);
    return () => window.removeEventListener('likida:copiloto-preguntar', alPreguntar);
  }, [listaAlMontar]);

  async function cargarConversacion(id: string): Promise<boolean> {
    if (ocupado) return false;
    setErrorCarga(null);
    try {
      const resp = await fetch(`${endpoint}/conversaciones/${id}`);
      const d = await resp.json().catch(() => null);
      if (!resp.ok || !d || !Array.isArray(d.mensajes)) throw new Error('respuesta inválida');
      const pares: Turno[] = [];
      for (const m of d.mensajes as Array<{ rol: string; texto: string; bloques: unknown }>) {
        if (m.rol === 'usuario') {
          pares.push({ id: nuevoId(), q: m.texto, r: { texto: '' }, nuevo: false });
        } else if (pares.length > 0) {
          const r = Array.isArray(m.bloques) && m.bloques.length > 0
            ? respuestaDeBloques(m.bloques as Array<Record<string, unknown>>)
            : { texto: m.texto };
          pares[pares.length - 1].r = { ...r, archivada: true };
        }
      }
      setHistorial(pares);
      setConversacionId(id);
      return true;
    } catch {
      setErrorCarga(tx('ch.no_se_pudo_abrir_esa_conversacion'));
      return false;
    }
  }

  function nuevoChat() {
    enVuelo.current?.abort();
    enVuelo.current = null;
    setOcupado(false);
    setGenerando(false);
    setPasosVivos([]);
    setHistorial([]);
    setConversacionId(null);
  }

  /** Detiene la generación en curso. LÍMITE CONOCIDO (igual que el modo cliente): solo aborta el fetch; el servidor no escucha `req.signal`. */
  function detener() {
    detenido.current = true;
    enVuelo.current?.abort();
  }

  function repetir(idTurno: string) {
    if (ocupado) return;
    const t = historial.find((x) => x.id === idTurno);
    if (t) void preguntarCopiloto(t.q, idTurno);
  }

  function anexarResultado(mensaje: string) {
    setHistorial((h) => [...h, { id: nuevoId(), q: '', r: { texto: mensaje, origen: 'copiloto', hora: horaMx(new Date().toISOString()) }, nuevo: true }]);
  }

  async function preguntarCopiloto(q: string, reemplazar: string | null) {
    // Una petición nueva cancela la anterior: `ocupado` ya lo impide, pero el candado es de estado y esto es de red.
    enVuelo.current?.abort();
    const control = new AbortController();
    enVuelo.current = control;
    detenido.current = false;
    setOcupado(true);
    setGenerando(true);
    setFasePensando('Pensando…');
    setPasosVivos([]);
    const idTurno = reemplazar ?? nuevoId();
    const pendiente: Turno = { id: idTurno, q, r: { texto: tx('op.pensando'), pendiente: true }, nuevo: true };
    const base = reemplazar ? historial.slice(0, historial.findIndex((x) => x.id === reemplazar)) : historial;
    setHistorial([...base, pendiente]);
    let ticks = 0;
    const relojFases = setInterval(() => {
      ticks += 1;
      const t = ticks * 700;
      const fase = [...PERFIL_SUPERADMIN.fases].reverse().find(([desde]) => t >= desde);
      if (fase) setFasePensando(fase[1]);
    }, 700);
    const t0 = performance.now();
    const inicios = new Map<string, number>();
    const pasosFinales: PasoTraza[] = [];
    const reemplazarTurno = (r: Respuesta) => setHistorial((h) => h.map((x) => (x.id === idTurno ? { ...x, r } : x)));
    try {
      const previos = base.filter((h) => h.q.trim()).flatMap((h) => [
        { rol: 'usuario' as const, texto: h.q },
        { rol: 'asistente' as const, texto: h.r.texto },
      ]);
      const resp = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // `contexto.ruta`: la pantalla de /admin que Javier tiene abierta AHORA (el panel persiste entre pantallas, así que se lee al enviar).
        body: JSON.stringify({ mensajes: [...previos, { rol: 'usuario', texto: q }], conversacionId, contexto: { ruta: window.location.pathname } }),
        // Las DOS razones para cortar: el techo de espera y el abort del usuario (detener / desmontar / preguntar otra cosa).
        signal: AbortSignal.any([control.signal, AbortSignal.timeout(TIEMPO_MAXIMO_MS)]),
      });
      const d = await leerRespuestaAgente(resp, (tool, fase) => {
        if (fase === 'inicio') {
          inicios.set(tool, performance.now());
          setPasosVivos((p) => [...p, { tool, listo: false }]);
        } else {
          const ini = inicios.get(tool);
          const ms = ini === undefined ? undefined : Math.round(performance.now() - ini);
          pasosFinales.push({ tool, listo: true, ms });
          setPasosVivos((p) => cerrarPaso(p, tool, { ms }));
        }
      });
      let r: Respuesta;
      if (resp.ok && d && Array.isArray(d.bloques)) {
        r = respuestaDeBloques(d.bloques as Array<Record<string, unknown>>);
        r.origen = 'copiloto';
        if (Array.isArray(d.toolsUsadas)) {
          const vistas = new Set<string>();
          r.fuentes = (d.toolsUsadas as string[])
            .map((t) => PANTALLA_UI[t])
            .filter((p): p is { ruta: string; etiqueta: string } => Boolean(p))
            .filter((p) => (vistas.has(p.ruta) ? false : (vistas.add(p.ruta), true)));
        }
        if (pasosFinales.length > 0) r.pasos = pasosFinales;
      } else {
        // No hay respondedor de reserva en este modo: se declara el fallo y se ofrece Reintentar.
        r = { texto: mensajeFallo(tx), fallo: true };
      }
      r.hora = horaMx(new Date().toISOString());
      r.ms = Math.round(performance.now() - t0);
      // El id que el servidor asignó al persistir (0121): anexar aquí los turnos siguientes y refrescar la lista del historial.
      if (resp.ok && d && typeof d.conversacionId === 'string') {
        const idConv = d.conversacionId;
        setConversacionId(idConv);
        setConvs((prev) => {
          if (!Array.isArray(prev)) return prev;
          const ya = prev.find((c) => c.id === idConv);
          const fila = ya ?? { id: idConv, titulo: q.replace(/\s+/g, ' ').trim().slice(0, 60), actualizadoEn: new Date().toISOString() };
          return [{ ...fila, actualizadoEn: new Date().toISOString() }, ...prev.filter((c) => c.id !== idConv)];
        });
      }
      reemplazarTurno(r);
    } catch {
      if (detenido.current) {
        reemplazarTurno({ texto: tx('ch.generacion_detenida_puedes_volver_a_preguntar'), cancelada: true, hora: horaMx(new Date().toISOString()) });
      } else if (!control.signal.aborted) {
        reemplazarTurno({ texto: mensajeFallo(tx), fallo: true, hora: horaMx(new Date().toISOString()), ms: Math.round(performance.now() - t0) });
      }
      // Un abort por desmontar/nuevo chat NO es un fallo del copiloto: nadie espera ya la respuesta; no se acusa al sistema.
    } finally {
      clearInterval(relojFases);
      // Solo la petición VIGENTE libera la caja: si «Nuevo chat» o una pregunta nueva ya tomó el relevo, no se pisa su estado.
      if (enVuelo.current === control) {
        enVuelo.current = null;
        setPasosVivos([]);
        setGenerando(false);
        setOcupado(false);
      }
    }
  }

  function preguntar(q: string) {
    if (!q.trim() || ocupado) return;
    void preguntarCopiloto(q, null);
  }

  useEffect(() => { preguntarRef.current = preguntar; });


  return {
    historial, ocupado, generando, documento: null, setDocumento: () => {}, conversacionId, convs, errorCarga, fasePensando, pasosVivos,
    preguntar, repetir, detener, nuevoChat, cargarConversacion, anexarResultado, cargarLista,
  };
}
