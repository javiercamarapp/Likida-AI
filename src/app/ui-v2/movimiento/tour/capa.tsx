'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ControladorTour } from './controlador';
import { colocarGlobo, mezclarRect, rectFoco, rectsIguales, trazoVelo } from './geometria';
import { GloboTour } from './globo';
import type { Rect, Tam } from './tipos';

// La capa visual del recorrido: velo con agujero (SVG), halo y globo. Mide el
// elemento REAL, lo sigue al hacer scroll/resize y desliza el foco con una
// interpolación de 250 ms (easeOutQuint). Con reduced-motion el foco salta y no
// hay desplazamiento animado; el recorrido sigue igual de guiado.

const DURACION_DESLIZ = 250;
const TAM_INICIAL: Tam = { w: 340, h: 240 };

export function CapaTour({ controlador }: { controlador: ControladorTour }) {
  const snap = useSyncExternalStore(controlador.suscribir.bind(controlador), () => controlador.instantanea(), () => controlador.instantanea());
  const [vp, setVp] = useState<Tam>({ w: 0, h: 0 });
  const [objetivo, setObjetivo] = useState<Rect | null>(null);
  const [foco, setFoco] = useState<Rect | null>(null);
  const [tam, setTam] = useState<Tam>(TAM_INICIAL);
  const globo = useRef<HTMLElement | null>(null);
  const focoRef = useRef<Rect | null>(null);
  const previo = useRef<Element | null>(null);
  const activo = snap.fase === 'activo';
  const reducido = snap.reducirMovimiento;

  // Foco previo: se devuelve al cerrar.
  useEffect(() => {
    if (!activo) return;
    previo.current = document.activeElement;
    return () => {
      if (previo.current instanceof HTMLElement && previo.current.isConnected) previo.current.focus({ preventScroll: true });
    };
  }, [activo]);

  // Medición con asentamiento: sigue midiendo hasta que el rect quede quieto 3 cuadros.
  const medir = useCallback(() => {
    const el = controlador.elementoActual;
    setVp({ w: window.innerWidth, h: window.innerHeight });
    setObjetivo(el && el.visible() ? el.rect() : null);
  }, [controlador]);

  useEffect(() => {
    if (!activo) return;
    let raf = 0;
    let quietos = 0;
    let ultimo: Rect | null = null;
    let cuadros = 0;
    const ciclo = () => {
      medir();
      const el = controlador.elementoActual;
      const r = el && el.visible() ? el.rect() : null;
      if (r && ultimo && rectsIguales(r, ultimo, 0.5)) quietos++; else quietos = 0;
      ultimo = r;
      cuadros++;
      if (quietos < 3 && cuadros < 120) raf = requestAnimationFrame(ciclo);
    };
    const reiniciar = () => { cancelAnimationFrame(raf); quietos = 0; cuadros = 0; raf = requestAnimationFrame(ciclo); };
    reiniciar();
    window.addEventListener('scroll', reiniciar, { capture: true, passive: true });
    window.addEventListener('resize', reiniciar);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', reiniciar, true);
      window.removeEventListener('resize', reiniciar);
    };
  }, [activo, snap.indice, snap.anclaLista, controlador, medir]);

  // Desliz del foco (JS puro: la curva es la única del sistema). Todo setState
  // ocurre en un cuadro de animación, nunca síncrono dentro del efecto.
  useEffect(() => {
    if (!objetivo) { focoRef.current = null; return; }
    const meta = rectFoco(objetivo, vp.w ? vp : { w: window.innerWidth, h: window.innerHeight });
    const desde = focoRef.current;
    const lejos = desde && (Math.abs(desde.x - meta.x) > 24 || Math.abs(desde.y - meta.y) > 24 || Math.abs(desde.w - meta.w) > 24 || Math.abs(desde.h - meta.h) > 24);
    const instantaneo = !desde || !lejos || reducido;
    let raf = 0;
    const t0 = performance.now();
    const paso = (t: number) => {
      const k = instantaneo ? 1 : Math.min(1, (t - t0) / DURACION_DESLIZ);
      const r = desde && !instantaneo ? mezclarRect(desde, meta, k) : meta;
      focoRef.current = r;
      setFoco(r);
      if (k < 1) raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [objetivo, vp, reducido]);

  // Tamaño real del globo (se re-mide cuando cambia su contenido).
  useEffect(() => {
    const g = globo.current;
    if (!g || !activo || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(() => {
      const r = g.getBoundingClientRect();
      setTam((t) => (Math.abs(r.width - t.w) > 1 || Math.abs(r.height - t.h) > 1 ? { w: r.width, h: r.height } : t));
    });
    obs.observe(g);
    return () => obs.disconnect();
  }, [activo, snap.indice]);
  useEffect(() => {
    if (activo) globo.current?.focus({ preventScroll: true });
  }, [activo, snap.indice]);

  // Teclado: Esc salta; ←/→ solo si el foco está dentro del globo.
  useEffect(() => {
    if (!activo) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); controlador.saltar(); return; }
      if (!globo.current?.contains(document.activeElement)) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); controlador.siguiente(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); controlador.atras(); }
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [activo, controlador]);

  if (!activo || !snap.paso) return null;
  const tamVp = vp.w ? vp : { w: 1280, h: 800 };
  const col = colocarGlobo(objetivo ? foco : null, tam, tamVp, snap.paso.lado ?? 'auto');
  const accion = snap.paso.avance?.tipo === 'accion';

  return (
    <div className="rv-tour" data-ui="v2" data-reducido={reducido || undefined}>
      <svg className="rv-tour__velo" width={tamVp.w} height={tamVp.h} viewBox={`0 0 ${tamVp.w} ${tamVp.h}`} aria-hidden="true">
        <path d={trazoVelo(tamVp, foco)} fillRule="evenodd" />
      </svg>
      {objetivo && foco ? (
        <>
          <div key={snap.indice} className="rv-tour__halo" data-espera={accion || undefined}
            style={{ transform: `translate(${foco.x}px, ${foco.y}px)`, width: foco.w, height: foco.h }} aria-hidden="true" />
          {/* Paso informativo: el elemento se ve pero no se activa por accidente. */}
          {!accion ? <div className="rv-tour__bloqueo" style={{ left: foco.x, top: foco.y, width: foco.w, height: foco.h }} aria-hidden="true" /> : null}
        </>
      ) : null}
      <GloboTour
        snap={snap}
        col={col}
        refGlobo={globo}
        onSiguiente={() => controlador.siguiente()}
        onAtras={() => controlador.atras()}
        onSaltar={() => controlador.saltar()}
        onMasTarde={() => controlador.masTarde()}
        onIrAlElemento={() => controlador.elementoActual?.enfocar()}
      />
    </div>
  );
}
