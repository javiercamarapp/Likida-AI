// Entrada del arnés: expone la MISMA función de dibujo del componente para pintar los canvas del HTML estático.
import { dibujarEsfera } from '../../src/app/ui-v2/svg/particulas';
(window as unknown as { __pintarParticulas: () => void }).__pintarParticulas = () => {
  document.querySelectorAll<HTMLCanvasElement>('canvas.rv-particulas').forEach((c) => {
    const ctx = c.getContext('2d');
    if (ctx) dibujarEsfera(ctx, c, 0.6, getComputedStyle(c).getPropertyValue('--senal').trim() || '#e9b06a');
  });
};
