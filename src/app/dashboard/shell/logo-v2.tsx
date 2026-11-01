import type { CSSProperties } from 'react';

// El logo de Likida VECTORIZADO desde `public/images/logo.png` (el mismo archivo de siempre; no se redibujó nada): contorno
// por interpolación sobre el canal alfa, suavizado de 1 px y simplificación a 0.3 px. Los mismos trazados viven como
// archivos en `public/images/logo*.svg`. Aquí van en línea con `fill="currentColor"` para que UN solo componente sirva
// en claro y oscuro (el color lo da `--ink`/`color` del contenedor): sin variante negativa que mantener ni máscara de PNG.
const D_TEXTO = 'M212.0 41.8 210.7 43.0 210.5 45.0 210.4 123.0 211.0 125.0 214.0 125.5 264.0 125.5 265.9 125.0 266.5 123.0 266.4 118.0 266.0 117.1 265.0 116.6 223.0 116.5 221.0 115.9 220.5 114.0 220.5 44.0 220.0 42.6 219.0 41.8ZM308.0 42.0 307.2 44.0 307.0 52.0 306.8 123.0 307.0 124.1 308.0 125.2 316.0 125.4 317.0 124.9 317.5 123.0 317.5 44.0 317.0 42.6 315.0 41.6 310.0 41.5ZM369.0 41.6 368.0 42.2 367.5 44.0 367.5 123.0 368.0 124.9 371.0 125.5 376.0 125.4 377.0 124.9 377.5 123.0 377.7 100.0 379.0 98.2 390.0 87.5 392.0 86.4 397.0 91.6 424.8 125.0 428.0 125.5 435.0 125.5 436.5 125.0 436.7 124.0 435.4 122.0 400.0 81.4 399.0 79.0 400.0 77.5 433.6 44.0 434.3 43.0 434.1 42.0 432.0 41.5 425.0 41.5 422.0 42.7 380.0 84.5 379.0 85.3 378.0 85.3 377.5 83.0 377.3 43.0 376.0 41.7ZM480.0 41.6 478.6 43.0 478.5 45.0 478.6 124.0 479.0 124.9 480.0 125.4 487.0 125.4 488.0 124.9 488.5 123.0 488.5 44.0 488.0 42.4 487.0 41.7ZM541.0 41.6 540.0 42.1 539.6 43.0 539.2 57.0 539.1 117.0 539.4 123.0 540.0 125.0 542.0 125.5 574.0 125.4 584.0 123.0 594.0 118.3 598.4 115.0 602.0 111.5 606.1 106.0 609.1 100.0 611.3 93.0 612.5 84.0 611.4 74.0 609.2 67.0 606.3 61.0 604.3 58.0 597.0 50.6 593.0 47.8 589.0 45.8 580.0 42.7 571.0 41.5ZM681.0 41.9 679.9 43.0 643.8 123.0 644.0 124.9 646.0 125.5 653.0 125.4 654.0 125.0 654.7 124.0 678.9 68.0 683.8 57.0 685.0 55.6 686.0 56.1 688.2 61.0 714.4 124.0 715.0 125.0 716.0 125.4 725.0 125.5 725.5 124.0 725.0 121.6 691.3 44.0 690.0 42.2 689.0 41.6ZM551.0 50.6 550.0 51.1 549.5 53.0 549.5 114.0 550.0 115.9 552.0 116.5 571.0 116.5 581.0 114.2 587.0 111.2 591.0 108.4 595.2 104.0 599.2 97.0 601.3 90.0 601.2 77.0 599.2 70.0 596.3 64.0 593.0 60.0 589.0 56.6 584.0 53.8 578.0 51.6 572.0 50.5Z';
const D_SIMBOLO = 'M27.0 -0.0 19.0 3.0 16.0 4.6 13.0 6.6 7.5 12.0 4.7 16.0 2.7 20.0 -0.4 29.0 -0.5 130.0 1.7 137.0 3.0 139.4 6.0 143.1 10.0 146.1 16.0 148.4 87.0 148.5 94.0 146.2 98.3 144.0 102.9 140.0 107.3 135.0 109.1 132.0 111.2 127.0 112.4 122.0 112.5 114.0 111.2 108.0 106.4 99.0 99.0 91.8 95.0 89.5 90.0 87.7 83.0 86.6 75.0 87.7 69.1 90.0 63.0 93.7 57.6 99.0 33.4 130.0 27.0 136.0 23.0 137.5 17.0 137.2 14.0 135.5 11.0 132.0 9.5 128.0 9.7 122.0 10.8 118.0 13.8 112.0 22.0 100.7 26.0 96.4 60.1 55.0 65.2 47.0 67.4 40.0 68.0 33.0 67.2 25.0 64.0 17.0 62.0 13.7 57.9 9.0 53.4 5.0 50.0 3.0 41.0 -0.3 30.0 -0.5Z';

/** Proporciones del viewBox (ancho/alto) de cada variante. */
export const PROPORCION_LOGO = { horizontal: 726 / 149, simbolo: 114 / 149 } as const;

/**
 * El logo de Likida en SVG. Se dimensiona por ALTURA (ESTILO-LIKIDA §4/§9: sidebar 30, riel 28, cabecera móvil 28, carga 40):
 * con 112 px de ancho el logo (4.9:1) mediría 23 px de alto y se vería tímido. `decorativo` lo saca del árbol de accesibilidad.
 */
export default function LogoV2({ alto, variante = 'horizontal', decorativo = false, className, style }: {
  alto: number; variante?: 'horizontal' | 'simbolo'; decorativo?: boolean; className?: string; style?: CSSProperties;
}) {
  const ancho = Math.round(alto * PROPORCION_LOGO[variante] * 100) / 100;
  const vb = variante === 'horizontal' ? '0 0 726 149' : '0 0 114 149';
  // El `role="img"` va en un contenedor (no en el <svg>): así lo ven igual los lectores de pantalla y el detector (c8/N5), y el
  // <svg> interior es decorativo. `display:block` en línea: el CSS del shell solo alterna visibilidad con wrappers propios.
  return (
    <span
      className={className} style={{ display: 'block', flex: 'none', lineHeight: 0, ...style }}
      {...(decorativo ? { 'aria-hidden': true } : { role: 'img', 'aria-label': 'Likida' })}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox={vb} width={ancho} height={alto} aria-hidden="true" focusable="false" style={{ display: 'block' }}>
        {/* Paleta negro/gris/blanco (31-oct): símbolo y nombre en la tinta del contenedor (`currentColor`). */}
      <path fill="currentColor" fillRule="evenodd" d={D_SIMBOLO} />
      {variante === 'horizontal' && <path fill="currentColor" fillRule="evenodd" d={D_TEXTO} />}
      </svg>
    </span>
  );
}
