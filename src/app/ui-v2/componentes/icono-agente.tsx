import { TRAZO_ICONO } from './icono';
import { cx } from './clases';
import '../icono-agente.css';

/** Las claves de los cinco agentes del perfil `cinco_agentes` (las mismas de `FICHAS_CINCO_AGENTES`). */
export type ClaveIconoAgente = 'liquidacion' | 'peajes' | 'carta_porte' | 'vigia' | 'conductor';
export const CLAVES_ICONO_AGENTE: readonly ClaveIconoAgente[] = ['liquidacion', 'peajes', 'carta_porte', 'vigia', 'conductor'];

/** `corriendo`: micro-movimiento breve (3 repeticiones, nunca infinito). Cualquier otro valor: el icono está quieto. */
export type TamanoIconoAgente = 16 | 20 | 24;

const P = { pathLength: 1 } as const; // el trazo se mide en 1 para dibujarlo con stroke-dasharray sin conocer su longitud

/**
 * Los cinco iconos de agente, dibujados a mano en la rejilla de 24 con el MISMO trazo (1.75, extremos y uniones redondeados) y la
 * misma silueta que los de lucide de la captura del dueño (ruta, balanza, rollo, personas, conversación). Son SVG con CSS:
 *   · al entrar, el trazo se DIBUJA una vez (600 ms);
 *   · con `vivo` (el agente está corriendo) una pieza propia de cada icono se mueve 3 veces (700 ms);
 *   · parado, queda quieto y completo. Con `prefers-reduced-motion: reduce` NUNCA se anima (todo vive bajo `no-preference`).
 * Decorativo por omisión (`aria-hidden`); con `etiqueta` es una imagen con nombre. Hereda el color (`currentColor`).
 */
export function IconoAgente({ agente, vivo = false, tam = 16, etiqueta, className }: {
  agente: ClaveIconoAgente;
  vivo?: boolean;
  tam?: TamanoIconoAgente;
  etiqueta?: string;
  className?: string;
}) {
  return (
    <svg
      className={cx('rv-ia', className)}
      data-agente={agente}
      data-vivo={vivo || undefined}
      width={tam}
      height={tam}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={TRAZO_ICONO}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(etiqueta ? { role: 'img', 'aria-label': etiqueta } : { 'aria-hidden': true })}
    >
      {agente === 'liquidacion' && (
        <>
          <circle className="rv-ia__t" cx="6" cy="19" r="3" {...P} />
          <circle className="rv-ia__t" cx="18" cy="5" r="3" {...P} />
          <path className="rv-ia__t rv-ia__base" d="M12 19h4.5a3.5 3.5 0 0 0 0-7h-8a3.5 3.5 0 0 1 0-7H12" {...P} />
          {/* un tramo brillante recorre la ruta mientras el agente liquida */}
          <path className="rv-ia__vivo rv-ia__viaja" d="M12 19h4.5a3.5 3.5 0 0 0 0-7h-8a3.5 3.5 0 0 1 0-7H12" {...P} />
        </>
      )}
      {agente === 'peajes' && (
        <>
          <path className="rv-ia__t" d="M12 3v18" {...P} />
          <path className="rv-ia__t" d="M7 21h10" {...P} />
          <g className="rv-ia__balanza">
            <path className="rv-ia__t" d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" {...P} />
            <path className="rv-ia__t" d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" {...P} />
            <path className="rv-ia__t" d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" {...P} />
          </g>
        </>
      )}
      {agente === 'carta_porte' && (
        <>
          <path className="rv-ia__t" d="M19 17V5a2 2 0 0 0-2-2H4" {...P} />
          <path className="rv-ia__t" d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" {...P} />
          <path className="rv-ia__t rv-ia__linea rv-ia__linea--1" d="M15 8h-5" {...P} />
          <path className="rv-ia__t rv-ia__linea rv-ia__linea--2" d="M15 12h-5" {...P} />
        </>
      )}
      {agente === 'vigia' && (
        <>
          <path className="rv-ia__t" d="M18 21a8 8 0 0 0-16 0" {...P} />
          <circle className="rv-ia__t" cx="10" cy="8" r="5" {...P} />
          <path className="rv-ia__t rv-ia__otro" d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" {...P} />
        </>
      )}
      {agente === 'conductor' && (
        <>
          <path className="rv-ia__t" d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" {...P} />
          <path className="rv-ia__t" d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" {...P} />
          {/* tres puntos de «escribiendo»: solo existen mientras el agente corre */}
          <circle className="rv-ia__vivo rv-ia__punto rv-ia__punto--1" cx="5.5" cy="6.5" r=".6" fill="currentColor" />
          <circle className="rv-ia__vivo rv-ia__punto rv-ia__punto--2" cx="8.5" cy="6.5" r=".6" fill="currentColor" />
          <circle className="rv-ia__vivo rv-ia__punto rv-ia__punto--3" cx="11.5" cy="6.5" r=".6" fill="currentColor" />
        </>
      )}
    </svg>
  );
}
