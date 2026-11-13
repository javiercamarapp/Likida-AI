'use client';

import { useState } from 'react';
import { solicitarCambioIdioma } from '@/lib/i18n/cambiar';
import { IDIOMAS, idiomaElegible, type Idioma } from '@/lib/i18n/idioma';

/** `.login-locales` de Rovaq: ES · EN en la fila de la marca. Elegir un idioma lo guarda (cookie) y recarga la pantalla; el inglés
 *  se ve apagado mientras `IDIOMA_EN_DISPONIBLE` sea falso (no se ofrece una traducción a medias). */
export function SelectorIdiomaLogin({ activo, etiqueta, noDisponible }: { activo: Idioma; etiqueta: string; noDisponible: string }) {
  const [pendiente, setPendiente] = useState(false);
  async function elegir(nuevo: Idioma) {
    if (nuevo === activo || pendiente || !idiomaElegible(nuevo)) return;
    setPendiente(true);
    if (await solicitarCambioIdioma(nuevo)) {
      window.location.reload();
      return;
    }
    setPendiente(false);
  }
  return (
    <div className="login-locales" role="group" aria-label={etiqueta}>
      {IDIOMAS.map((idioma) => {
        const bloqueado = !idiomaElegible(idioma);
        return (
          <button
            key={idioma} type="button" className="login-locale"
            aria-pressed={idioma === activo} disabled={bloqueado || pendiente}
            title={bloqueado ? noDisponible : undefined} onClick={() => void elegir(idioma)}
          >
            {idioma.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
