'use client';

import { useSyncExternalStore } from 'react';

// ¿La persona pidió reducir el movimiento? Se lee en vivo (si cambia la preferencia con la página abierta, el chat lo respeta al
// instante). En el servidor y en la hidratación vale `true`: el primer pintado nunca anima, así que no hay salto ni desajuste.
const CONSULTA = '(prefers-reduced-motion: reduce)';

export function useMovimientoReducido(): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const m = window.matchMedia(CONSULTA);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => (typeof window === 'undefined' || !window.matchMedia ? true : window.matchMedia(CONSULTA).matches),
    () => true,
  );
}

/** Comportamiento del scroll: suave salvo que se haya pedido reducir el movimiento (entonces salta, `auto`). */
export function comportamientoScroll(reducido: boolean): ScrollBehavior {
  return reducido ? 'auto' : 'smooth';
}
