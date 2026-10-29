'use client';

import { useEffect, useRef, type ElementType, type ReactNode } from 'react';

// Revelado al hacer scroll con IntersectionObserver. El HTML servido NUNCA está
// oculto (sin JS, impresión y lectores ven todo): el ocultamiento ocurre en el
// cliente, solo para lo que está bajo el pliegue, y solo sin reduced-motion.

/** Decisión pura (probada): ¿hay que ocultar este bloque hasta que entre a la vista? */
export function debeOcultar(p: { arriba: number; altoVentana: number; reducido: boolean; hayObservador: boolean }): boolean {
  if (p.reducido || !p.hayObservador) return false;
  return p.arriba > p.altoVentana * 0.92; // ya visible al cargar = se queda como está
}

export function Revelar({ children, como: Tag = 'div', retardoMs = 0, className }: {
  children: ReactNode;
  como?: ElementType;
  /** Escalona hermanos (0, 60, 120…). Máximo 240. */
  retardoMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hayObservador = typeof IntersectionObserver !== 'undefined';
    if (!debeOcultar({ arriba: el.getBoundingClientRect().top, altoVentana: window.innerHeight, reducido, hayObservador })) return;
    el.dataset.rvRevelar = 'oculto';
    const obs = new IntersectionObserver((entradas) => {
      if (entradas.some((e) => e.isIntersecting)) {
        // Un frame con el estado oculto ya pintado, luego «visto» dispara la transición.
        requestAnimationFrame(() => { el.dataset.rvRevelar = 'visto'; });
        obs.disconnect();
      }
    }, { threshold: 0.15 });
    obs.observe(el);
    return () => { obs.disconnect(); delete el.dataset.rvRevelar; };
  }, []);

  return (
    <Tag ref={ref} className={className} style={retardoMs ? { transitionDelay: `${Math.min(retardoMs, 240)}ms` } : undefined}>
      {children}
    </Tag>
  );
}
