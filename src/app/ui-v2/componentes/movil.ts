'use client';

import { useSyncExternalStore } from 'react';

// ¿Viewport de móvil (<820 px)? Con useSyncExternalStore: sin estado en efectos, sin parpadeo de hidratación.
const CONSULTA = '(max-width: 819px)';
const suscribir = (cb: () => void) => {
  const m = window.matchMedia(CONSULTA);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};
export function useMovil(): boolean {
  return useSyncExternalStore(suscribir, () => window.matchMedia(CONSULTA).matches, () => false);
}
