'use client';

import { ArrowDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { DashboardKpis, Acreditables } from '@/lib/likida/analytics';
import LogoV2 from '../shell/logo-v2';
import { CampoPixeles } from '../pixeles';
import Composer, { MAX_PREGUNTA } from './composer';
import PanelHistorial, { BotonHistorial } from './historial';
import { BurbujaUsuario, RespuestaVista } from './mensajes';
import { comportamientoScroll, useMovimientoReducido } from './movimiento';
import TemasRapidos from './sugerencias';
import { useAnalista } from './use-analista';

// ¿Bajo `lg` (1024 px)? Ahí el historial es un Drawer (hoja inferior en <820, cajón en 820–1023); sobre `lg`, una columna.
const CONSULTA_LG = '(max-width: 1023.98px)';
function useBajoLg(): boolean {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(CONSULTA_LG); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); },
    () => window.matchMedia(CONSULTA_LG).matches,
    () => false,
  );
}

/** A cuántos px del fondo ya cuenta como «estoy al final» (por debajo de eso no se ofrece el botón de bajar). */
const UMBRAL_FONDO_PX = 96;

/**
 * «Pregunta a tus datos» — la pantalla del agente (L5: clon del agente de Vexa con la paleta de Likida). Una sola pantalla sin
 * scroll de página: la portada (marca, título, frase, recuadro y sugerencias) es UN grupo centrado sobre el campo de puntos; al
 * primer mensaje la portada se retira, el hilo scrollea por dentro y el recuadro queda anclado abajo. La lógica de datos, los
 * permisos y las rutas son las de siempre (`use-analista.ts`); esto es solo la interfaz.
 *
 * Mismo criterio que admin/chat.tsx: coincidencia de palabras clave contra datos YA calculados en el servidor (`kpis`/`acred`) como
 * paracaídas, nunca lenguaje natural a SQL con permisos de servicio.
 */
export default function ChatFlota({ kpis, acred, cabecera }: {
  kpis: DashboardKpis | null;
  acred: Acreditables | null;
  /** Lo que va a la izquierda de «Historial» en su misma fila (la cinta de «viendo como superadmin»). */
  cabecera?: ReactNode;
}) {
  const a = useAnalista({ kpis, acred });
  const [texto, setTexto] = useState('');
  const [histAbierto, setHistAbierto] = useState(false);
  const [lejosDelFondo, setLejosDelFondo] = useState(false);
  const movil = useBajoLg();
  const reducido = useMovimientoReducido();
  const botonHist = useRef<HTMLButtonElement>(null);
  const hilo = useRef<HTMLDivElement>(null);
  const hiloIn = useRef<HTMLDivElement>(null);
  const hay = a.historial.length > 0;
  const ultimo = a.historial.at(-1);

  const medirFondo = useCallback(() => {
    const el = hilo.current;
    if (!el) return;
    setLejosDelFondo(el.scrollHeight - el.scrollTop - el.clientHeight > UMBRAL_FONDO_PX);
  }, []);

  // Cada turno nuevo se abre por el principio de SU pregunta: su crecimiento nunca arrastra al lector (como Vexa). Un historial
  // reabierto arranca arriba. Con movimiento reducido el scroll salta (`auto`).
  useEffect(() => {
    const c = hilo.current;
    if (!c || !ultimo) return;
    if (!ultimo.nuevo) { c.scrollTop = 0; return; }
    const el = c.querySelector<HTMLElement>(`[data-turno-id="${ultimo.id}"]`);
    if (!el) return;
    const top = Math.max(0, c.scrollTop + el.getBoundingClientRect().top - c.getBoundingClientRect().top - 12);
    if (typeof c.scrollTo === 'function') c.scrollTo({ top, behavior: comportamientoScroll(reducido) });
    else c.scrollTop = top;
  }, [ultimo?.id, ultimo?.nuevo, reducido]); // eslint-disable-line react-hooks/exhaustive-deps -- el aviso es por `ultimo` entero; solo importa cuál turno es

  // El botón de bajar depende de lo que mide el hilo: se recalcula al crecer el contenido (streaming, bloques que entran).
  useEffect(() => {
    const dentro = hiloIn.current;
    if (!dentro || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medirFondo);
    ro.observe(dentro);
    return () => ro.disconnect();
  }, [hay, medirFondo]);

  // Teclado en pantalla (celular): el alto útil se reduce con `--teclado` y la barra inferior cede, así el recuadro nunca queda tapado.
  // Solo CSSOM (`setProperty` / `dataset`): no es un `style=` ni se bloquea con la CSP.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const raiz = document.documentElement;
    const quitar = () => { raiz.style.removeProperty('--teclado'); delete raiz.dataset.teclado; };
    const medir = () => {
      const alto = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      if (alto > 120) { raiz.style.setProperty('--teclado', `${alto}px`); raiz.dataset.teclado = 'abierto'; } else quitar();
    };
    vv.addEventListener('resize', medir);
    vv.addEventListener('scroll', medir);
    medir();
    return () => { vv.removeEventListener('resize', medir); vv.removeEventListener('scroll', medir); quitar(); };
  }, []);

  const bajar = () => {
    const c = hilo.current;
    if (!c) return;
    if (typeof c.scrollTo === 'function') c.scrollTo({ top: c.scrollHeight, behavior: comportamientoScroll(reducido) });
    else c.scrollTop = c.scrollHeight;
  };

  const preguntar = (q: string) => {
    const t = q.trim().slice(0, MAX_PREGUNTA);
    if (!t || a.ocupado) return;
    setTexto('');
    a.preguntar(t);
  };
  const cerrarHistorial = () => {
    setHistAbierto(false);
    setTimeout(() => botonHist.current?.focus(), 0);
  };
  const abrirConversacion = async (id: string) => {
    if (await a.cargarConversacion(id)) cerrarHistorial();
  };
  const nuevoChat = () => { a.nuevoChat(); setTexto(''); cerrarHistorial(); };

  const composer = (
    <Composer valor={texto} onCambio={setTexto} onEnviar={() => preguntar(texto)} onDetener={a.detener}
      generando={a.generando} ocupado={a.ocupado} documento={a.documento} onQuitarDocumento={() => a.setDocumento(null)}
      onArchivo={(f, limpiar) => void a.leerArchivo(f, limpiar)} />
  );

  return (
    <div className="rv-chat" data-has={hay} data-ocupado={a.ocupado || undefined} data-hist={histAbierto && !movil ? 'abierto' : undefined}>
      <div className="rv-chat__principal">
        <CampoPixeles intensidad="vexa" pausado={hay} />
        <div className="rv-chat__fila">
          {cabecera}
          <BotonHistorial convs={a.convs} expandido={histAbierto} oculto={histAbierto && !movil} boton={botonHist} onClick={() => (histAbierto ? cerrarHistorial() : setHistAbierto(true))} />
        </div>
        <div className="rv-chat__agente" data-has={hay}>
          {!hay && (
            <header className="rv-chat__hero" data-onboarding="pantalla.titulo">
              <LogoV2 alto={28} className="rv-chat__logo" />
              <h1>Pregunta a tus datos</h1>
              <p className="rv-chat__sub">
                Tu operación, con la cifra que ya calculó el motor — y adjunta un PDF, un Excel o la foto de un comprobante para analizarlo aquí mismo.
              </p>
            </header>
          )}
          {hay && <h1 className="rv-sr">Pregunta a tus datos</h1>}
          {hay && (
            <div className="rv-chat__hilo-caja">
              <div ref={hilo} className="rv-chat__hilo" role="log" aria-live="polite" tabIndex={0} aria-label="Conversación" onScroll={medirFondo}>
                <div ref={hiloIn} className="rv-chat__hilo-in">
                  {a.historial.map((t, i) => (
                    <div key={t.id} data-turno-id={t.id} className="rv-chat__turno">
                      {t.q.trim() && <BurbujaUsuario turno={t} />}
                      <RespuestaVista turno={t} ultimo={i === a.historial.length - 1} ocupado={a.ocupado}
                        fase={a.fasePensando} pasosVivos={a.pasosVivos} onRepetir={a.repetir} />
                    </div>
                  ))}
                </div>
              </div>
              {lejosDelFondo && (
                <button type="button" className="rv-btn rv-btn--secondary rv-chat__redondo rv-chat__bajar" aria-label="Ir al final de la conversación" onClick={bajar}>
                  <ArrowDown aria-hidden="true" />
                </button>
              )}
            </div>
          )}
          <div className="rv-chat__dock">{composer}</div>
          {!hay && (
            <>
              <TemasRapidos onPreguntar={preguntar} deshabilitado={a.ocupado} />
              <p className="rv-chat__meta">
                <span className="rv-chip" title="Las cifras salen del motor de Likida, ya calculadas en el servidor.">Cifras calculadas por el motor</span>
                <span className="rv-chip" title="La IA lee tus cifras con herramientas de consulta; no escribe consultas libres a la base de datos.">Sin consultas libres a la base</span>
              </p>
              <p className="rv-chat__pie">
                Responde con cifras ya calculadas en el servidor — en texto, tabla o gráfica según la pregunta. No traduce preguntas libres a consultas de base de datos, a propósito.
              </p>
            </>
          )}
        </div>
      </div>
      <PanelHistorial movil={movil} abierto={histAbierto} onCerrar={cerrarHistorial} convs={a.convs} activa={a.conversacionId}
        errorCarga={a.errorCarga} onNuevo={nuevoChat} onAbrir={(id) => void abrirConversacion(id)} />
    </div>
  );
}
