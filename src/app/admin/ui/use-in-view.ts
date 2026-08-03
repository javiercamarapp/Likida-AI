'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Detecta cuándo un elemento entra al viewport, para disparar la animación
 * de entrada de una gráfica UNA sola vez (§F-bis: "gráficas que se dibujan
 * al entrar en viewport"). El `setState` vive DENTRO del callback del
 * IntersectionObserver — async de verdad, dispara cuando el navegador de
 * verdad cruza el umbral, no síncrono al montar — así que no choca con la
 * regla `set-state-in-effect` (el efecto de abajo solo suscribe/desconecta
 * el observer, no llama setState él mismo). */
export function useInView<T extends HTMLElement>(umbral = 0.25) {
  const ref = useRef<T | null>(null);
  const [enVista, setEnVista] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || enVista) return;
    const obs = new IntersectionObserver(
      ([entrada]) => {
        if (entrada.isIntersecting) {
          setEnVista(true);
          obs.disconnect();
        }
      },
      { threshold: umbral },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [umbral, enVista]);

  return [ref, enVista] as const;
}
