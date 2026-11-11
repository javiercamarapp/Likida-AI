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
import type { Motor, ModoAgente } from './motor';
import { PERFILES, type TemaAgente, type TextosAgente } from './perfiles';
import TemasRapidos from './sugerencias';
import BriefingDecideHoy from './briefing-decide-hoy';
import { useAnalista } from './use-analista';
import { useCopiloto } from './use-copiloto';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';

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
 * LA CONVERSACIÓN CON EL AGENTE — un solo componente para «Pregunta a tus datos» (/dashboard/chat, `modo="cliente"`) y el Copiloto del
 * fundador (/admin, `modo="superadmin"`). Misma portada, mismo recuadro, mismas animaciones, misma traza viva y mismos bloques: lo que
 * distingue a cada modo vive en un ADAPTADOR (`use-analista.ts` / `use-copiloto.ts`, ambos devuelven un `Motor`) y en su perfil
 * (`perfiles.ts`), nunca en una copia de la interfaz.
 *
 * PROPS SERIALIZABLES: todo lo que cruza de un componente de servidor a este es dato (cadenas, listas, booleanos, `kpis`/`acred` ya
 * calculados) — NUNCA funciones (caída real de producción por eso; guarda: ui-v2/graficas/formato_frontera_guarda.test.ts). Los
 * adaptadores se importan AQUÍ, dentro del cliente.
 *
 * Una sola pantalla sin scroll de página en `variante="pagina"`; en `variante="panel"` (el lateral de 400 px del chrome de /admin) es
 * la misma pantalla compacta y el historial siempre se abre como hoja del motor de overlays.
 */
export interface PropsAgente {
  modo: ModoAgente;
  variante?: 'pagina' | 'panel';
  /** POST del chat. Por omisión, el de su modo. */
  endpoint?: string;
  /** Temas de la portada. Por omisión, el catálogo de su modo. */
  temas?: TemaAgente[];
  textos?: Partial<TextosAgente>;
  /** El logo de la portada: completo o solo el símbolo. */
  marca?: 'horizontal' | 'simbolo';
  /** Previsualiza y confirma acciones (solo superadmin; el servidor es quien crea la llave de ejecución). */
  acciones?: boolean;
  /** El clip de adjuntar. Por omisión, el de su modo (el copiloto no tiene adjuntos). */
  adjuntos?: boolean;
  /** Solo `modo="cliente"`: lo que el respondedor de reserva usa si el analista falla. */
  kpis?: DashboardKpis | null;
  acred?: Acreditables | null;
  /** Lo que va a la izquierda de «Historial» en su misma fila (la cinta de «viendo como superadmin»). */
  cabecera?: ReactNode;
}

export default function AgenteConversacion(p: PropsAgente) {
  return p.modo === 'cliente' ? <ConMotorCliente {...p} /> : <ConMotorSuperadmin {...p} />;
}

function ConMotorCliente(p: PropsAgente) {
  const motor = useAnalista({ kpis: p.kpis ?? null, acred: p.acred ?? null, endpoint: p.endpoint });
  return <VistaAgente {...p} motor={motor} />;
}

function ConMotorSuperadmin(p: PropsAgente) {
  const motor = useCopiloto({ endpoint: p.endpoint, listaAlMontar: p.variante !== 'panel' });
  return <VistaAgente {...p} motor={motor} />;
}

function VistaAgente({ modo, variante = 'pagina', endpoint, temas, textos, marca = 'horizontal', acciones, adjuntos, cabecera, motor: a }: PropsAgente & { motor: Motor }) {
  const { t: tl } = useT('resto', restoEs);
  const perfil = PERFILES[modo];
  const tx: TextosAgente = { ...perfil.textos, ...textos };
  const listaTemas = temas ?? perfil.temas;
  const conAcciones = acciones ?? perfil.acciones;
  const conAdjuntos = (adjuntos ?? perfil.adjuntos) && Boolean(a.leerArchivo);
  const endpointAccion = endpoint ?? perfil.endpoint;
  const panel = variante === 'panel';
  /** El título de la portada: encabezado de nivel 1 en la página y de nivel 2 en el panel lateral (ver la nota donde se pinta). */
  const Titulo = panel ? 'h2' : 'h1';
  const [texto, setTexto] = useState('');
  const [histAbierto, setHistAbierto] = useState(false);
  const [lejosDelFondo, setLejosDelFondo] = useState(false);
  const movil = useBajoLg() || panel; // el panel de 400 px no tiene sitio para la columna: su historial es la hoja del motor de overlays
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
    if (!vv || panel) return;
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
  }, [panel]);

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
  const abrirHistorial = () => {
    if (a.convs === null || a.convs === 'error') a.cargarLista?.();
    setHistAbierto(true);
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
      onArchivo={(f, limpiar) => void a.leerArchivo?.(f, limpiar)}
      adjuntos={conAdjuntos} placeholder={tx.placeholder} etiquetaFormulario={tx.etiquetaFormulario} etiquetaCampo={tx.etiquetaCampo} />
  );

  return (
    <div className="rv-chat" data-modo={modo} data-variante={variante} data-has={hay} data-ocupado={a.ocupado || undefined} data-hist={histAbierto && !movil ? 'abierto' : undefined}>
      <div className="rv-chat__principal">
        <CampoPixeles intensidad="vexa" pausado={hay} />
        <div className="rv-chat__fila">
          {cabecera}
          <BotonHistorial convs={a.convs} expandido={histAbierto} oculto={histAbierto && !movil} boton={botonHist} onClick={() => (histAbierto ? cerrarHistorial() : abrirHistorial())} />
        </div>
        <div className="rv-chat__agente" data-has={hay}>
          {!hay && (
            <header className="rv-chat__hero" data-onboarding="pantalla.titulo">
              <LogoV2 variante={marca === 'simbolo' ? 'simbolo' : 'horizontal'} alto={28} className="rv-chat__logo" />
              {/* UN solo encabezado de nivel 1 por página: el panel lateral del Copiloto vive en el chrome de /admin junto al título de cada pantalla, así que ahí baja a nivel 2. */}
              <Titulo>{tx.titulo}</Titulo>
              <p className="rv-chat__sub">{tx.subtitulo}</p>
            </header>
          )}
          {hay && <Titulo className="rv-sr">{tx.titulo}</Titulo>}
          {hay && (
            <div className="rv-chat__hilo-caja">
              <div ref={hilo} className="rv-chat__hilo" role="log" aria-live="polite" tabIndex={0} aria-label={tl('cfg.conversacion')} onScroll={medirFondo}>
                <div ref={hiloIn} className="rv-chat__hilo-in">
                  {a.historial.map((t, i) => (
                    <div key={t.id} data-turno-id={t.id} className="rv-chat__turno">
                      {t.q.trim() && <BurbujaUsuario turno={t} />}
                      <RespuestaVista turno={t} ultimo={i === a.historial.length - 1} ocupado={a.ocupado}
                        fase={a.fasePensando} pasosVivos={a.pasosVivos} onRepetir={a.repetir}
                        acciones={conAcciones} endpointAccion={endpointAccion} onEjecutada={a.anexarResultado} />
                    </div>
                  ))}
                </div>
              </div>
              {lejosDelFondo && (
                <button type="button" className="rv-btn rv-btn--secondary rv-chat__redondo rv-chat__bajar" aria-label={tl('ch.ir_al_final_de_la_conversacion')} onClick={bajar}>
                  <ArrowDown aria-hidden="true" />
                </button>
              )}
            </div>
          )}
          <div className="rv-chat__dock">{composer}</div>
          {!hay && (
            <>
              {modo === 'superadmin' && !panel && <BriefingDecideHoy onPreguntar={preguntar} deshabilitado={a.ocupado} endpoint={endpointAccion} />}
              <TemasRapidos temas={listaTemas} onPreguntar={preguntar} deshabilitado={a.ocupado} />
              <p className="rv-chat__meta">
                {tx.chips.map((c) => <span key={c.texto} className="rv-chip" title={c.ayuda}>{c.texto}</span>)}
              </p>
              <p className="rv-chat__pie">{tx.pie}</p>
            </>
          )}
        </div>
      </div>
      <PanelHistorial movil={movil} abierto={histAbierto} onCerrar={cerrarHistorial} convs={a.convs} activa={a.conversacionId}
        errorCarga={a.errorCarga} onNuevo={nuevoChat} onAbrir={(id) => void abrirConversacion(id)} />
    </div>
  );
}
