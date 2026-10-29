'use client';

import { useEffect, useRef } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// PARTÍCULAS — una esfera de puntos finos (canvas 2D, sin librerías) que gira despacio, con dos órbitas. Lee el color del
// acento en el CSS (`--senal`) y se repinta al cambiar el tema. Quieta (un solo cuadro) con movimiento reducido; se pausa
// fuera de pantalla y en pestañas ocultas. Decorativa: aria-hidden. En pruebas (sin canvas) no pinta nada.
// ═══════════════════════════════════════════════════════════════════════════

const N = 520;
const PUNTOS = Array.from({ length: N }, (_, i) => {
  // Distribución de Fibonacci sobre la esfera: pareja, sin polos amontonados.
  const y = 1 - (i / (N - 1)) * 2;
  const r = Math.sqrt(1 - y * y);
  const a = i * 2.399963229728653;
  return { x: Math.cos(a) * r, y, z: Math.sin(a) * r };
});

/** Un cuadro de la esfera (pura: la usa el componente y el arnés de capturas). */
export function dibujarEsfera(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, ang: number, color: string) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth; const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const R = Math.min(w, h) * 0.42; const cx = w / 2; const cy = h / 2;
  const ca = Math.cos(ang); const sa = Math.sin(ang);
  const inc = 0.38; const ci = Math.cos(inc); const si = Math.sin(inc);
  ctx.fillStyle = color;
  for (const p of PUNTOS) {
    const x1 = p.x * ca + p.z * sa; const z1 = -p.x * sa + p.z * ca;
    const y2 = p.y * ci - z1 * si; const z2 = p.y * si + z1 * ci;
    const prof = (z2 + 1) / 2; // 0 atrás, 1 al frente
    ctx.globalAlpha = 0.12 + prof * 0.78;
    ctx.beginPath();
    ctx.arc(cx + x1 * R, cy + y2 * R, 0.5 + prof * 1.15, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.35; ctx.strokeStyle = color; ctx.lineWidth = 0.75;
  for (const [rx, ry, rot] of [[1.38, 0.34, -0.42], [1.62, 0.5, 0.3]] as const) {
    ctx.beginPath(); ctx.ellipse(cx, cy, R * rx, R * ry, rot, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function Particulas({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext?.('2d');
    if (!canvas || !ctx) return;
    const reducido = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let ang = 0.6;
    let visible = true;
    let raf = 0;
    let color = '#e9b06a';
    const leerColor = () => { color = getComputedStyle(canvas).getPropertyValue('--senal').trim() || color; };

    const dibujar = () => dibujarEsfera(ctx, canvas, ang, color);
    const paso = () => { ang += 0.0035; dibujar(); raf = visible && !document.hidden ? requestAnimationFrame(paso) : 0; };
    const arrancar = () => { if (!raf && !reducido) raf = requestAnimationFrame(paso); };

    leerColor(); dibujar();
    const io = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((e) => { visible = e.some((x) => x.isIntersecting); if (visible) arrancar(); });
    io?.observe(canvas);
    const mo = new MutationObserver(() => { leerColor(); dibujar(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const alRedimensionar = () => dibujar();
    window.addEventListener('resize', alRedimensionar);
    document.addEventListener('visibilitychange', arrancar);
    arrancar();
    return () => { cancelAnimationFrame(raf); io?.disconnect(); mo.disconnect(); window.removeEventListener('resize', alRedimensionar); document.removeEventListener('visibilitychange', arrancar); };
  }, []);

  return <canvas ref={ref} className={`rv-particulas${className ? ` ${className}` : ''}`} aria-hidden="true" />;
}
