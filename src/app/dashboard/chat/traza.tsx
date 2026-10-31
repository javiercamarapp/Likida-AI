'use client';

import { useId, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import MarcaLikida from './marca';
import { rotuloTool, type PasoTraza } from './respuestas';

/** «850 ms» / «3.2 s»: solo lo que MIDIÓ el navegador entre el inicio y el fin del paso; nunca texto del modelo. */
export function textoMs(ms?: number | null): string {
  if (ms === null || ms === undefined) return '';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

function ListaPasos({ pasos }: { pasos: PasoTraza[] }) {
  return (
    <ol className="rv-traza__lista">
      {pasos.map((p, i) => (
        <li key={i} className="rv-traza__paso" data-listo={p.listo}>
          <span className="rv-traza__icono" aria-hidden="true">
            {p.listo ? <Check width={12} height={12} strokeWidth={2} /> : <span className="rv-traza__punto" />}
          </span>
          <span className="rv-traza__titulo">
            {rotuloTool(p.tool)}{p.listo ? '' : '…'}
            {p.listo && p.ms !== undefined && <span className="rv-traza__meta">{textoMs(p.ms)}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** El «pensando» en vivo: la marca que respira, la fase con tiempo y la lista colapsable de pasos REALES del agente (llegan por streaming). */
export function TrazaViva({ fase, pasos }: { fase: string; pasos: PasoTraza[] }) {
  const [abierta, setAbierta] = useState(true);
  const id = useId();
  return (
    <div className="rv-traza" role="status" aria-live="polite" data-testid="chat-pensando">
      <MarcaLikida pensando />
      <div className="rv-traza__cuerpo">
        <p className="rv-traza__fase">{fase}</p>
        {pasos.length > 0 && (
          <>
            <button type="button" className="rv-traza__alternar" aria-expanded={abierta} aria-controls={id} onClick={() => setAbierta((v) => !v)}>
              <ChevronRight width={12} height={12} aria-hidden="true" />
              {pasos.length === 1 ? '1 paso en vivo' : `${pasos.length} pasos en vivo`}
            </button>
            {abierta && <div id={id}><ListaPasos pasos={pasos} /></div>}
          </>
        )}
      </div>
    </div>
  );
}

/** El desglose guardado bajo una respuesta terminada: colapsado, con el tiempo total medido. */
export function TrazaFinal({ pasos, ms }: { pasos: PasoTraza[]; ms?: number }) {
  if (pasos.length === 0) return null;
  const total = ms !== undefined ? ` · ${textoMs(ms)}` : '';
  return (
    <details className="rv-traza__final">
      <summary className="rv-btn rv-btn--secondary rv-chat__resumen">
        Cómo llegué a esto ({pasos.length === 1 ? '1 paso' : `${pasos.length} pasos`}{total})
      </summary>
      <ListaPasos pasos={pasos} />
      <p className="rv-chat__nota">Los pasos y los tiempos son los que midió tu navegador mientras el agente consultaba; no incluyen texto del modelo.</p>
    </details>
  );
}
