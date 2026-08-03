'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}
function getServerSnapshot() {
  return false;
}

/** Toda animación de entrada/hover de la librería de gráficas la consulta
 *  — si está activo, se salta el movimiento y muestra el estado final de
 *  una vez (§F-bis del complemento de diseño: "respetando
 *  prefers-reduced-motion"). `useSyncExternalStore`, no
 *  `useState`+`useEffect`, para no disparar el lint de
 *  `set-state-in-effect` (el mismo patrón ya usado en
 *  `notificaciones-leidas.ts`). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
