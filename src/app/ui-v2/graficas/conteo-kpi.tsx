'use client';

import { useEffect, useRef } from 'react';
import { numero } from '@/lib/formato';

/** Duración del conteo: la de Rovaq (`count-up.tsx`), 650 ms. */
export const DURACION_CONTEO_MS = 650;
/** easeOutCubic, como Rovaq. */
export const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);
/** Valor mostrado en el avance `k` (0..1): parte de 0 y llega EXACTO al valor real en k = 1 (los enteros se redondean en el camino). */
export function valorEnConteo(valor: number, k: number): number {
  if (k >= 1) return valor;
  const v = valor * easeOutCubic(Math.max(0, k));
  return Number.isInteger(valor) ? Math.round(v) : v;
}

/** Cifra de KPI con conteo al montar: 650 ms, desde 0, easeOutCubic (identidad Rovaq, decisión del 10-nov-2026; antes 420 ms desde
 *  el 85 %). El HTML servido ya trae el valor FINAL (sin JS o con movimiento reducido es lo único que se ve) y el último fotograma
 *  vuelve a escribir ese mismo valor exacto: los intermedios son animación, no una medición. Con `prefers-reduced-motion: reduce` no anima. */
/** El formato es el único del producto (`numero`, es-MX): no se recibe como prop porque una función no cruza de un componente de servidor a uno de cliente. */
export function ConteoKpi({ valor }: { valor: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const nodo = ref.current?.firstChild;
    if (!nodo || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !Number.isFinite(valor)) return;
    const t0 = performance.now();
    let raf = 0;
    const paso = (t: number) => {
      const k = Math.min(1, (t - t0) / DURACION_CONTEO_MS);
      nodo.nodeValue = numero(valorEnConteo(valor, k));
      if (k < 1) raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [valor]);
  return <span ref={ref} suppressHydrationWarning>{numero(valor)}</span>;
}
