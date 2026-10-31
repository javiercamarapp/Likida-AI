'use client';

import { useEffect, useRef } from 'react';
import { numero } from '@/lib/formato';

/** Cifra de KPI con conteo corto (420 ms) al montar. NUNCA pasa por 0 ni por un valor falso: arranca en el 85 % del
 *  valor real (el HTML servido ya trae el valor final). Con `prefers-reduced-motion: reduce` no anima. */
/** El formato es el único del producto (`numero`, es-MX): no se recibe como prop porque una función no cruza de un componente de servidor a uno de cliente. */
export function ConteoKpi({ valor }: { valor: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const nodo = ref.current?.firstChild;
    if (!nodo || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !Number.isFinite(valor)) return;
    const desde = valor - Math.abs(valor) * 0.15;
    const t0 = performance.now();
    let raf = 0;
    const paso = (t: number) => {
      const k = Math.min(1, (t - t0) / 420);
      const e = 1 - Math.pow(1 - k, 4); // easeOutQuart: la misma familia de la curva del sistema
      nodo.nodeValue = numero(k >= 1 ? valor : Number.isInteger(valor) ? Math.round(desde + (valor - desde) * e) : desde + (valor - desde) * e);
      if (k < 1) raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [valor]);
  return <span ref={ref} suppressHydrationWarning>{numero(valor)}</span>;
}
