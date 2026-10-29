import { useSyncExternalStore } from 'react';

// El sidebar v2 se puede plegar a riel (72 px). La preferencia vive en localStorage (por navegador) y se comparte entre el
// botón de la marca (sidebar) y el de la topbar con un store mínimo fuera de React, como `selector-tema.tsx`. El snapshot del
// servidor es «expandido»: el HTML del servidor es siempre el sidebar de 232 y el cliente se corrige al hidratar. Entre 768 y
// 1023 px el riel es obligatorio por CSS y esta preferencia no aplica (los botones se ocultan ahí).

const LLAVE = 'likida-sb-riel';
const oyentes = new Set<() => void>();

function suscribir(cb: () => void): () => void {
  oyentes.add(cb);
  return () => { oyentes.delete(cb); };
}
function leer(): boolean {
  try { return window.localStorage.getItem(LLAVE) === '1'; } catch { return false; }
}
function alternar(): void {
  try { window.localStorage.setItem(LLAVE, leer() ? '0' : '1'); } catch { /* sin almacenamiento: no se recuerda */ }
  oyentes.forEach((cb) => cb());
}

/** ¿Está el sidebar plegado a riel por elección del usuario? y cómo alternarlo. */
export function useRiel(): { riel: boolean; alternar: () => void } {
  const riel = useSyncExternalStore(suscribir, leer, () => false);
  return { riel, alternar };
}
