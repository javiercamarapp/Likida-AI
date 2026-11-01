'use client';
import { useEffect, useRef } from 'react';
import { mountLoginParticles } from './particle-engine';

/** Arte del panel de /login (mismo motor de partículas que la entrada de Vexa). Monta solo desde 1024 px y libera observadores y animación al navegar. */
export function LoginArtwork() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const media = matchMedia('(min-width: 1024px)');
    let dispose: (() => void) | undefined;
    let cancelled = false;
    const sync = () => {
      dispose?.();
      dispose = undefined;
      if (media.matches && canvas.current && !cancelled) {
        dispose = mountLoginParticles(canvas.current, 'sphere', true);
      }
    };
    // El atlas de glifos se arma con la fuente real, también en una visita en frío.
    void document.fonts.load('36px "Likida Login Mono"').then(sync, sync);
    media.addEventListener('change', sync);
    return () => {
      cancelled = true;
      media.removeEventListener('change', sync);
      dispose?.();
    };
  }, []);
  return (
    <div className="login-artwork" aria-hidden="true">
      <canvas ref={canvas} />
      <div className="login-artwork-floor" />
    </div>
  );
}
