'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

const LLAVE = 'likida-sidebar';

// useSyncExternalStore y no useState+useEffect: leer localStorage en un
// efecto y hacer setState síncrono lo prohíbe `react-hooks/set-state-in-
// effect` (regla del repo, ver rail.tsx), y el initializer directo daría
// mismatch de hidratación — el server no tiene localStorage. Este hook
// existe exactamente para "estado que vive fuera de React": snapshot del
// servidor fijo en `false`, y el cliente se corrige solo al hidratar.
const oyentes = new Set<() => void>();
function suscribir(cb: () => void): () => void {
  oyentes.add(cb);
  return () => { oyentes.delete(cb); };
}
function leerColapsado(): boolean {
  return window.localStorage.getItem(LLAVE) === 'min';
}

/**
 * El colapsador del sidebar de la referencia Handle (12-ago-2026) — alterna
 * `data-sidebar='min'` en la raíz (el CSS de globals.css esconde lo textual
 * con .sb-texto y angosta la lámina .sb-aside) y lo recuerda en
 * localStorage. Vive como atributo en la raíz por la misma razón que la
 * expansión del asistente: el botón y lo que colapsa son primos lejanos en
 * el árbol, y levantar el estado volvería cliente todo el marco.
 */
export function BotonSidebar() {
  const min = useSyncExternalStore(suscribir, leerColapsado, () => false);

  // Reaplica la marca al montar (el atributo del DOM no sobrevive a la
  // navegación dura). Sin setState: solo toca el DOM.
  useEffect(() => {
    if (leerColapsado()) document.documentElement.dataset.sidebar = 'min';
  }, []);

  function alternar() {
    const nuevo = !min;
    window.localStorage.setItem(LLAVE, nuevo ? 'min' : 'max');
    if (nuevo) document.documentElement.dataset.sidebar = 'min';
    else delete document.documentElement.dataset.sidebar;
    oyentes.forEach((cb) => cb());
  }

  return (
    <button type="button" onClick={alternar}
      aria-label={min ? 'Expandir menú' : 'Contraer menú'}
      title={min ? 'Expandir menú' : 'Contraer menú'}
      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors hover:bg-[var(--canvas)]"
      style={{ color: 'var(--muted)' }}>
      {min ? <PanelLeftOpen width={15} height={15} strokeWidth={1.75} /> : <PanelLeftClose width={15} height={15} strokeWidth={1.75} />}
    </button>
  );
}
