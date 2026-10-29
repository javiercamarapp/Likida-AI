'use client';

import { useEffect, useRef, type CSSProperties } from 'react';

// Texto que se REVELA palabra por palabra al hacer scroll (gris → tinta). El texto completo está siempre en el HTML y en
// `aria-label`; las palabras son `aria-hidden`. Sin JS, con movimiento reducido o ya a la vista, todo se lee de inmediato.
export function TextoRevelado({ texto, className }: { texto: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const palabras = texto.split(/\s+/).filter(Boolean);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { el.style.setProperty('--p', '1'); return; }
    let raf = 0;
    const medir = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 800;
      // 0 cuando el bloque asoma por abajo; 1 cuando ya subió un 45 % de la ventana.
      const p = Math.min(1, Math.max(0, (vh * 0.95 - r.top) / (vh * 0.45)));
      el.style.setProperty('--p', p.toFixed(3));
    };
    const pedir = () => { if (!raf) raf = requestAnimationFrame(medir); };
    medir();
    document.addEventListener('scroll', pedir, { capture: true, passive: true });
    window.addEventListener('resize', pedir);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('scroll', pedir, { capture: true }); window.removeEventListener('resize', pedir); };
  }, []);

  return (
    <p ref={ref} className={`rv-revelado${className ? ` ${className}` : ''}`} aria-label={texto} style={{ '--p': 1, '--n': palabras.length } as CSSProperties}>
      {palabras.map((w, i) => (
        <span key={i} aria-hidden="true" className="rv-revelado__w" style={{ '--i': (i / palabras.length).toFixed(3) } as CSSProperties}>{w}{' '}</span>
      ))}
    </p>
  );
}
