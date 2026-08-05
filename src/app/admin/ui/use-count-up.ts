'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Interpola del valor anterior al valor final con ease-out, vía
 * requestAnimationFrame — el `setState` vive dentro del callback de rAF,
 * no síncrono en el cuerpo del efecto (mismo criterio que `use-in-view`).
 * `animar=false` (prefers-reduced-motion) muestra el valor final de una vez,
 * sin animación.
 *
 * AUDITORÍA 10, ALTO — arrancaba en `useState(0)`: en el servidor no corre
 * NINGÚN `useEffect`, así que ese 0 inicial era literalmente lo que salía en
 * el HTML servido, sin importar la cifra real ("$0.00 Monto comprobado"
 * sobre una flota que comprobó $1.2M — el cero que CLAUDE.md prohíbe, uno
 * que se lee como medición). Y `usePrefersReducedMotion()` en el servidor
 * siempre devuelve su `getServerSnapshot()` (`false`, "no sé, asumo que
 * no"), NUNCA una medición real, así que `animar` tampoco servía para
 * distinguir servidor de cliente.
 *
 * El arreglo: el estado arranca en el valor REAL (`valorFinal`), no en 0 —
 * mismo valor en el servidor y en el primer render del cliente antes de
 * hidratar, así que no hay nada que journalear como mentira ni desajuste de
 * hidratación. La animación de conteo ya NO corre al montar (animar ahí
 * bajaría la cifra correcta a 0 para volver a subirla — el mismo parpadeo
 * que este arreglo existe para evitar); corre solo cuando `valorFinal`
 * CAMBIA después de montado (p. ej. el usuario mueve el filtro 7d → 30d y
 * las cifras suben/bajan a la vista), que es cuando animar sí tiene algo
 * real que mostrar.
 */
export function useCountUp(valorFinal: number, animar: boolean, duracionMs = 600): number {
  const [valorMostrado, setValorMostrado] = useState(valorFinal);
  const previoRef = useRef(valorFinal);
  const montadoRef = useRef(false);

  useEffect(() => {
    // Primer efecto tras hidratar: el HTML ya muestra el valor real (mismo
    // `useState` inicial), así que no hay nada que animar todavía — solo se
    // deja listo el punto de partida para el siguiente cambio.
    if (!montadoRef.current) {
      montadoRef.current = true;
      previoRef.current = valorFinal;
      return;
    }
    if (!animar || valorFinal === previoRef.current) {
      previoRef.current = valorFinal;
      setValorMostrado(valorFinal);
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
      setValorMostrado(desde + delta * suavizado);
      if (p < 1) raf = requestAnimationFrame(tick);
      else previoRef.current = valorFinal;
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [valorFinal, animar, duracionMs]);

  return valorMostrado;
}
