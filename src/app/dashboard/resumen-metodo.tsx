'use client';

import { useState } from 'react';

// Píldoras de método de la portada («Cómo se calculó», «Fuentes y publicaciones»): cada una abre su explicación debajo. El texto lo arma
// quien llama con cifras ya medidas; aquí no se inventa nada.
//
// Ronda 6: el esqueleto de portada pinta `metodo` DENTRO de un <p>. Un <details> (o cualquier bloque) dentro de un <p> hace que el navegador
// cierre el <p> al parsear y React lanza «Minified React error #418» en cada carga. Por eso las píldoras son <span> + <button> (contenido
// de frase válido dentro de un <p>), con el mismo comportamiento: aria-expanded, teclado y una sola abierta a la vez.
export function PildorasMetodo({ etiquetaComo, comoTexto, etiquetaFuentes, fuentesTexto }: {
  etiquetaComo: string; comoTexto: string; etiquetaFuentes: string; fuentesTexto: string;
}) {
  const [abierta, setAbierta] = useState<'como' | 'fuentes' | null>(null);
  const alternar = (k: 'como' | 'fuentes') => setAbierta((a) => (a === k ? null : k));
  return (
    <span className="rv-res__metodo">
      <span className="rv-res__pildora" data-abierta={abierta === 'como' || undefined}>
        <button type="button" aria-expanded={abierta === 'como'} onClick={() => alternar('como')}>{etiquetaComo}</button>
      </span>
      <span className="rv-res__pildora" data-abierta={abierta === 'fuentes' || undefined}>
        <button type="button" aria-expanded={abierta === 'fuentes'} onClick={() => alternar('fuentes')}>{etiquetaFuentes}</button>
      </span>
      {abierta ? <span className="rv-res__explica" role="note">{abierta === 'como' ? comoTexto : fuentesTexto}</span> : null}
    </span>
  );
}
