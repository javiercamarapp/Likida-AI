import { ArrowRight, MoveRight } from 'lucide-react';
import type { Ref } from 'react';
import { Boton } from '../../componentes/boton';
import type { Colocacion } from './geometria';
import type { Instantanea } from './tipos';

// El globo del recorrido: presentacional y sin estado (se prueba con
// renderToStaticMarkup). NO usa role="dialog": la página sigue siendo
// interactiva, es una región con nombre; los <dialog> viven solo en overlay.tsx.

export interface PropsGlobo {
  snap: Instantanea;
  col: Colocacion;
  refGlobo?: Ref<HTMLElement>;
  onSiguiente: () => void;
  onAtras: () => void;
  onSaltar: () => void;
  onMasTarde: () => void;
  onIrAlElemento?: () => void;
}

export function GloboTour({ snap, col, refGlobo, onSiguiente, onAtras, onSaltar, onMasTarde, onIrAlElemento }: PropsGlobo) {
  const paso = snap.paso;
  if (!paso) return null;
  const n = snap.indice + 1;
  const accion = paso.avance?.tipo === 'accion';
  const estilo = { '--rv-gx': `${col.x}px`, '--rv-gy': `${col.y}px`, transform: `translate(${col.x}px, ${col.y}px)` } as React.CSSProperties;
  const flecha =
    col.flecha === null ? undefined
      : col.lado === 'arriba' || col.lado === 'abajo' ? { left: col.flecha } : { top: col.flecha };

  return (
    <section
      ref={refGlobo}
      className="rv-tour__globo"
      role="region"
      aria-label={`Recorrido guiado, paso ${n} de ${snap.total}`}
      data-lado={col.lado}
      data-reducido={snap.reducirMovimiento || undefined}
      tabIndex={-1}
      style={estilo}
    >
      {flecha ? <span className="rv-tour__flecha" style={flecha} aria-hidden="true" /> : null}
      <div className="rv-sr" aria-live="polite">{`Paso ${n} de ${snap.total}: ${paso.titulo}`}</div>

      <div className="rv-tour__cab">
        <span className="rv-tour__paso etiqueta-mono">Paso {n} de {snap.total}</span>
        <ol className="rv-tour__marcas" aria-hidden="true">
          {[...Array(snap.total).keys()].map((i) => (
            <li key={i} data-estado={i < snap.indice ? 'hecho' : i === snap.indice ? 'actual' : 'pendiente'} />
          ))}
        </ol>
      </div>

      <h2 className="rv-tour__titulo">{paso.titulo}</h2>
      <p className="rv-tour__texto">{paso.texto}</p>

      {paso.accion ? (
        <p className="rv-tour__accion">
          <span>{paso.accion.verbo} aquí</span>
          <MoveRight width={14} height={14} strokeWidth={2} aria-hidden="true" />
          <strong>{paso.accion.objetivo}</strong>
        </p>
      ) : null}

      {snap.navegando ? <p className="rv-tour__nota" role="status">Te llevamos a la página de este paso…</p> : null}
      {snap.anclaLista === false ? (
        <p className="rv-tour__nota" role="status">No vemos ese elemento en pantalla ahora. Sigue las indicaciones de arriba y avanza cuando quieras.</p>
      ) : null}
      {accion && snap.anclaLista ? (
        <p className="rv-tour__nota">
          Avanzamos solos cuando lo hagas, o aprieta «Siguiente».
          {onIrAlElemento ? <> <button type="button" className="rv-tour__enlace" onClick={onIrAlElemento}>Ir al elemento</button></> : null}
        </p>
      ) : null}

      <div className="rv-tour__pie">
        <div className="rv-tour__izq">
          <Boton variante="ghost" tamano="sm" onClick={onSaltar}>Saltar</Boton>
          <Boton variante="ghost" tamano="sm" onClick={onMasTarde}>Más tarde</Boton>
        </div>
        <div className="rv-tour__der">
          {!snap.esPrimero ? <Boton variante="secondary" tamano="sm" onClick={onAtras}>Atrás</Boton> : null}
          <Boton variante="primary" tamano="sm" onClick={onSiguiente} icono={snap.esUltimo ? undefined : <ArrowRight width={14} height={14} aria-hidden="true" />}>
            {snap.esUltimo ? 'Terminar' : 'Siguiente'}
          </Boton>
        </div>
      </div>
    </section>
  );
}
