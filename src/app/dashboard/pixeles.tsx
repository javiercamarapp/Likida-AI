'use client';

import { useEffect, useRef } from 'react';

/**
 * La nube de píxeles del hero del chat (13-ago-2026: "el efecto animado de
 * píxeles como el de usehandle"). Clonado del lenguaje visual de la
 * referencia — un canvas con puntitos monocromos en rejilla cuya densidad
 * la modulan nubes que derivan LENTO, con el centro limpio porque ahí vive
 * el contenido — no de su código.
 *
 * Honesto con la máquina y con el usuario: ~20 fps, se pausa con la pestaña
 * oculta, y con `prefers-reduced-motion` pinta UN cuadro estático. El color
 * es `--g3` del tema (por eso pivota solo entre claro y oscuro).
 */
export function CampoPixeles() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const CELDA = 10;
    const PUNTO = 2.4;
    let raf = 0;
    let vivo = true;
    let ultimo = 0;

    // Umbral de dithering FIJO por celda: la animación es la nube pasando a
    // través de una trama quieta — así se ve la referencia, no como lluvia.
    const umbral = (x: number, y: number) => {
      const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return n - Math.floor(n);
    };

    function medir() {
      if (!canvas || !ctx) return;
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * devicePixelRatio));
      canvas.height = Math.max(1, Math.round(r.height * devicePixelRatio));
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }

    function dibujar(t: number) {
      if (!canvas || !ctx) return;
      const r = canvas.getBoundingClientRect();
      const W = r.width, H = r.height;
      if (W === 0 || H === 0) return;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = getComputedStyle(canvas).color;

      const nubes = [
        { x: W * 0.84 + Math.sin(t * 0.00021) * W * 0.05, y: H * 0.14 + Math.cos(t * 0.00017) * H * 0.06, r: W * 0.26 },
        { x: W * 0.10 + Math.cos(t * 0.00019) * W * 0.05, y: H * 0.80 + Math.sin(t * 0.00023) * H * 0.06, r: W * 0.24 },
        { x: W * 0.30 + Math.sin(t * 0.00013) * W * 0.05, y: H * 0.08 + Math.cos(t * 0.00011) * H * 0.04, r: W * 0.15 },
      ];
      const cx = W / 2, cy = H * 0.45;

      for (let gx = 0; gx < W; gx += CELDA) {
        for (let gy = 0; gy < H; gy += CELDA) {
          let d = 0;
          for (const n of nubes) {
            const dx = (gx - n.x) / n.r, dy = (gy - n.y) / n.r;
            d += Math.max(0, 1 - (dx * dx + dy * dy));
          }
          // El centro queda limpio: logo, título y caja viven ahí.
          const dcx = (gx - cx) / (W * 0.42), dcy = (gy - cy) / (H * 0.5);
          d *= Math.min(1, Math.max(0, dcx * dcx + dcy * dcy - 0.15) * 2.2);
          if (d > umbral(gx, gy)) {
            ctx.globalAlpha = Math.min(0.5, 0.16 + d * 0.3);
            ctx.fillRect(gx, gy, PUNTO, PUNTO);
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    function loop(ts: number) {
      if (!vivo) return;
      if (ts - ultimo > 50) { ultimo = ts; dibujar(ts); }
      raf = requestAnimationFrame(loop);
    }

    medir();
    dibujar(0);
    if (!reducido) raf = requestAnimationFrame(loop);

    const alCambiarTamano = () => { medir(); dibujar(performance.now()); };
    const alCambiarVisibilidad = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reducido && vivo) raf = requestAnimationFrame(loop);
    };
    window.addEventListener('resize', alCambiarTamano);
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    return () => {
      vivo = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', alCambiarTamano);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    };
  }, []);

  return (
    <canvas ref={ref} aria-hidden
      className="absolute inset-0 h-full w-full pointer-events-none"
      style={{ color: 'var(--g3)' }} />
  );
}
