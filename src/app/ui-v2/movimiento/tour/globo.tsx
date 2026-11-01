import { ArrowRight, MoveRight } from 'lucide-react';
import type { Ref } from 'react';
import { Boton, BotonEnlace } from '../../componentes/boton';
import { Ilustracion } from './ilustraciones';
import type { Instantanea } from './tipos';

// La tarjeta del recorrido (medidas y orden de la guía de Vexa): fija abajo a la derecha, 380 px, ilustración, dos contadores
// (PASO n DE N y PANTALLA n DE N), barra de avance, título, cuerpo, nota, ruta de pantallas y tres botones. Presentacional y
// sin estado (se prueba con renderToStaticMarkup). NO usa role="dialog": la página sigue siendo operable; es una región con
// nombre (los diálogos viven solo en overlay.tsx). Resalte en tinta: este recorrido no tiene color de acento propio.

export interface PropsGlobo {
  snap: Instantanea;
  /** Lado de la pantalla donde se ancla la tarjeta (el contrario al elemento resaltado, para no taparlo). */
  lado?: 'der' | 'izq';
  /** Sin elemento que resaltar (paso informativo o ancla ausente): la tarjeta va centrada. */
  centrada?: boolean;
  refGlobo?: Ref<HTMLElement>;
  onSiguiente: () => void;
  onAtras: () => void;
  onSaltar: () => void;
  /** Cierra conservando el paso (el enlace del cierre usa esta; Esc también). */
  onMasTarde?: () => void;
  onIrAlElemento?: () => void;
}

/** Ventana de a lo más 5 nombres alrededor de la pantalla actual. */
export function ventanaDeRuta(nombres: readonly string[], actual: number, tam = 5): Array<{ nombre: string; actual: boolean }> {
  if (nombres.length === 0) return [];
  const ini = Math.max(0, Math.min(actual - Math.floor(tam / 2), nombres.length - tam));
  return nombres.slice(ini, ini + tam).map((nombre, i) => ({ nombre, actual: ini + i === actual }));
}

export function GloboTour({ snap, lado = 'der', centrada = false, refGlobo, onSiguiente, onAtras, onSaltar, onIrAlElemento }: PropsGlobo) {
  const paso = snap.paso;
  if (!paso) return null;
  const n = snap.pasoN ?? snap.indice + 1;
  const total = snap.pasoTotal ?? snap.total;
  const cierre = paso.tipo === 'cierre';
  const esIr = paso.tipo === 'ir';
  const accion = paso.avance?.tipo === 'accion';
  const nombres = (snap.pantallas ?? []).map((p) => p.nombre);
  const grupoN = Math.min((snap.grupo ?? 0) + 1, Math.max(nombres.length, 1));
  const ruta = cierre ? [] : ventanaDeRuta(nombres, snap.grupo ?? 0);

  return (
    <section
      ref={refGlobo}
      className="rv-onb"
      role="region"
      aria-label={`Recorrido guiado, paso ${n} de ${total}`}
      data-tipo={paso.tipo ?? 'info'}
      data-lado={lado}
      data-centrada={centrada || undefined}
      data-reducido={snap.reducirMovimiento || undefined}
      tabIndex={-1}
    >
      <div className="rv-sr" aria-live="polite">{`Paso ${n} de ${total}: ${paso.titulo}`}</div>
      <div className="rv-onb__marco" aria-hidden="true"><Ilustracion nombre={paso.ilu} /></div>

      <div className="rv-onb__cab">
        <p className="rv-onb__contador">Paso {n} de {total}</p>
        {!cierre && nombres.length > 0 ? <p className="rv-onb__contador">Pantalla {grupoN} de {nombres.length}</p> : null}
      </div>
      <progress className="rv-onb__avance" value={n} max={total} aria-label={`Avance del recorrido: paso ${n} de ${total}`} />

      <h2 className="rv-onb__titulo">{paso.titulo}</h2>
      <p className="rv-onb__texto">{paso.texto}</p>

      {paso.accion && !esIr ? (
        <p className="rv-onb__accion">
          <span>{paso.accion.verbo} aquí</span>
          <MoveRight width={14} height={14} strokeWidth={2} aria-hidden="true" />
          <strong>{paso.accion.objetivo}</strong>
        </p>
      ) : null}

      {snap.navegando ? <p className="rv-onb__nota" role="status">Te llevo a la página de este paso…</p> : null}
      {snap.anclaLista === false ? (
        <p className="rv-onb__nota" role="status">No veo este elemento en la pantalla ahora; sigue la explicación de aquí.</p>
      ) : null}
      {accion && !esIr && snap.anclaLista ? (
        <p className="rv-onb__nota">
          Avanzo solo cuando lo hagas, o aprieta «Siguiente».
          {onIrAlElemento ? <> <button type="button" className="rv-onb__enlace" onClick={onIrAlElemento}>Ir al elemento</button></> : null}
        </p>
      ) : null}

      {ruta.length > 0 ? (
        <ol className="rv-onb__ruta" aria-label="Pantallas del recorrido">
          {ruta.map((r) => <li key={r.nombre} data-actual={r.actual || undefined} aria-current={r.actual ? 'step' : undefined}>{r.nombre}</li>)}
        </ol>
      ) : null}

      <div className="rv-onb__pie">
        {!cierre ? <Boton variante="ghost" onClick={onSaltar}>Omitir recorrido</Boton> : <span />}
        <div className="rv-onb__der">
          {!snap.esPrimero ? <Boton variante="secondary" onClick={onAtras}>Anterior</Boton> : null}
          {cierre && paso.cta ? <BotonEnlace variante="secondary" href={paso.cta.ruta} onClick={onSiguiente}>{paso.cta.etiqueta}</BotonEnlace> : null}
          <Boton variante="primary" onClick={onSiguiente} data-onb-primario icono={snap.esUltimo ? undefined : <ArrowRight width={14} height={14} aria-hidden="true" />}>
            {snap.esUltimo ? 'Terminar' : esIr ? 'Llévame' : 'Siguiente'}
          </Boton>
        </div>
      </div>
    </section>
  );
}
