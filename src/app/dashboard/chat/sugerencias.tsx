'use client';

import { useState } from 'react';
import { CATALOGO_CONSULTA } from './respuestas';

/**
 * Sugerencias de la portada sin tarjetas grandes (como Vexa): UNA fila de temas (chips con el punto de su matiz de datos, fijo por
 * orden) y, debajo, las preguntas del tema elegido como chips compactos con entrada escalonada (0 / 50 / 100 ms). Los temas SON el
 * catálogo de Consulta de siempre — cada frase conserva la palabra clave que el respondedor entiende —, ya no un menú aparte.
 */
export default function TemasRapidos({ onPreguntar, deshabilitado }: { onPreguntar: (q: string) => void; deshabilitado: boolean }) {
  const [i, setI] = useState(0);
  const tema = CATALOGO_CONSULTA[Math.min(i, CATALOGO_CONSULTA.length - 1)];
  return (
    <section className="rv-chat__sug" aria-label="Temas para preguntar">
      <div className="rv-chat__temas" role="group" aria-label="Temas">
        {CATALOGO_CONSULTA.map((t, k) => (
          <button type="button" key={t.categoria} className="rv-chat__tema" data-tema={(k % 8) + 1} aria-pressed={k === i} onClick={() => setI(k)}>
            <i aria-hidden="true" /><span>{t.categoria}</span>
          </button>
        ))}
      </div>
      <div className="rv-chat__preguntas" role="group" aria-label={tema.categoria} key={tema.categoria}>
        {tema.preguntas.slice(0, 3).map((q) => (
          <button type="button" key={q} className="rv-chat__q" title={q} disabled={deshabilitado} onClick={() => onPreguntar(q)}>
            <span>{q}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
