'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Interpola de 0 (o del valor anterior) al valor final con ease-out, vía
 * requestAnimationFrame — el `setState` vive dentro del callback de rAF,
 * no síncrono en el cuerpo del efecto (mismo criterio que `use-in-view`).
 * `animar=false` (prefers-reduced-motion, o la primera carga en server)
 * muestra el valor final de una vez, sin animación.
 */
export function useCountUp(valorFinal: number, animar: boolean, duracionMs = 600): number {
  const [valorAnimado, setValorAnimado] = useState(0);
  const previoRef = useRef(0);

  useEffect(() => {
    // Sin animar: no hay nada que hacer en el efecto — el valor final se
    // devuelve directo abajo (bypasea el estado por completo, así no hace
    // falta un setState síncrono aquí). Solo se sincroniza el REF (no es
    // estado de React, no dispara el lint) para que si `animar` se
    // vuelve true más tarde, la animación arranque desde el valor real
    // mostrado y no desde 0.
    if (!animar) {
      previoRef.current = valorFinal;
      return;
    }
    const desde = previoRef.current;
    const delta = valorFinal - desde;
    let inicio: number | null = null;
    let raf = 0;
    function tick(t: number) {
      if (inicio === null) inicio = t;
      const p = Math.min(1, (t - inicio) / duracionMs);
      const suavizado = 1 - (1 - p) ** 3; // ease-out cúbico
      setValorAnimado(desde + delta * suavizado);
      if (p < 1) raf = requestAnimationFrame(tick);
      else previoRef.current = valorFinal;
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [valorFinal, animar, duracionMs]);

  return animar ? valorAnimado : valorFinal;
}
