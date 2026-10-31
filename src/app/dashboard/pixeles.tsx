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
 * oculta Y cuando el canvas sale de pantalla, devicePixelRatio ≤ 2, y con
 * `prefers-reduced-motion` pinta UN cuadro estático (también si la
 * preferencia cambia con la página abierta). El tiempo medio de pintado se
 * expone en `data-draw-ms` y los cuadros en `data-frames` para medirlo.
 *
 * `intensidad`: `suave` (el original: color `--g3`, alfa ≤ .5; lo usan el copiloto de /admin y el
 * onboarding) o `vexa` (L5: color de tinta por CLASE, alfa .22 + d·.4 con tope .65, las constantes del campo de Vexa).
 */
export function CampoPixeles({ intensidad = 'suave', pausado = false }: { intensidad?: 'suave' | 'vexa'; pausado?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // `pausado` (el chat ya tiene una conversación abierta): el campo deja de animar y queda UN cuadro quieto detrás del hilo.
  const pausadoRef = useRef(pausado);
  const control = useRef<{ aplicar: () => void }>({ aplicar: () => {} });
  useEffect(() => { pausadoRef.current = pausado; control.current.aplicar(); }, [pausado]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reducir = window.matchMedia('(prefers-reduced-motion: reduce)');

    const CELDA = 10;
    const PUNTO = 2.4;
    const MS_CUADRO = 50;
    const base = intensidad === 'vexa' ? 0.22 : 0.16;
    const peso = intensidad === 'vexa' ? 0.4 : 0.3;
    const tope = intensidad === 'vexa' ? 0.65 : 0.5;
    let raf = 0;
    let vivo = true;
    let visible = true;
    let ultimo = 0;
    let cuadros = 0;
    let total = 0;
    let anchoMedido = 0;
    let altoMedido = 0;

    // Umbral de dithering FIJO por celda: la animación es la nube pasando a
    // través de una trama quieta — así se ve la referencia, no como lluvia.
    const umbral = (x: number, y: number) => {
      const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return n - Math.floor(n);
    };

    function medir() {
      if (!canvas || !ctx) return;
      const r = canvas.getBoundingClientRect();
      anchoMedido = r.width;
      altoMedido = r.height;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function dibujar(t: number) {
      if (!canvas || !ctx) return;
      const r = canvas.getBoundingClientRect();
      const W = r.width, H = r.height;
      if (W === 0 || H === 0) return;
      const t0 = performance.now();
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
            ctx.globalAlpha = Math.min(tope, base + d * peso);
            ctx.fillRect(gx, gy, PUNTO, PUNTO);
          }
        }
      }
      ctx.globalAlpha = 1;
      total += performance.now() - t0;
      cuadros += 1;
      canvas.dataset.drawMs = (total / cuadros).toFixed(2);
      canvas.dataset.frames = String(cuadros);
    }

    const puedeAnimar = () => vivo && visible && !document.hidden && !reducir.matches && !pausadoRef.current;
    function loop(ts: number) {
      if (!puedeAnimar()) { raf = 0; return; }
      if (ts - ultimo >= MS_CUADRO) { ultimo = ts; dibujar(ts); }
      raf = requestAnimationFrame(loop);
    }
    const arrancar = () => { if (!raf && puedeAnimar()) raf = requestAnimationFrame(loop); };
    const parar = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };

    medir();
    dibujar(0);
    arrancar();
    control.current.aplicar = () => { if (pausadoRef.current) parar(); else arrancar(); };

    const alCambiarTamano = () => {
      // El ResizeObserver avisa una vez al empezar a observar: si el tamaño no cambió, no hay nada que repintar (y con movimiento
      // reducido el campo sigue siendo UN solo cuadro).
      const r = canvas.getBoundingClientRect();
      if (r.width === anchoMedido && r.height === altoMedido) return;
      medir();
      dibujar(reducir.matches ? 0 : performance.now());
    };
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(alCambiarTamano);
    ro?.observe(canvas);
    const io = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((es) => {
      visible = es.some((e) => e.isIntersecting);
      if (visible) arrancar(); else parar();
    });
    io?.observe(canvas);
    const alCambiarVisibilidad = () => { if (document.hidden) parar(); else arrancar(); };
    const alCambiarPreferencia = () => { if (reducir.matches) { parar(); dibujar(0); } else arrancar(); };
    if (!ro) window.addEventListener('resize', alCambiarTamano);
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    reducir.addEventListener('change', alCambiarPreferencia);
    return () => {
      vivo = false;
      parar();
      ro?.disconnect();
      io?.disconnect();
      window.removeEventListener('resize', alCambiarTamano);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
      reducir.removeEventListener('change', alCambiarPreferencia);
    };
  }, [intensidad]);

  return intensidad === 'vexa'
    ? <canvas ref={ref} aria-hidden className="rv-chat__pixeles" />
    : (
      <canvas ref={ref} aria-hidden
        className="absolute inset-0 h-full w-full pointer-events-none"
        style={{ color: 'var(--g3)' }} />
    );
}
