import type { ReactNode } from 'react';
import { cx } from './clases';

// ESQUELETOS por tarjeta: cada uno con la FORMA y la ALTURA de lo que va a ocupar su lugar, así no hay salto de diseño al llegar los
// datos. Respiran con la misma curva del logo (opacidad 1 ↔ .5, 1.6 s) y quedan quietos con `prefers-reduced-motion`. Usan la
// clase `.skeleton` de siempre (v1 y v2 comparten marcado); el CSS de v2 la sustituye por la respiración.
// El telón con el logo es SOLO de la primera carga de la sesión (`dashboard/shell/capa-carga.tsx`); aquí, en cada navegación y en
// cada tarjeta que espera sus datos, se ve este esqueleto.

export type AltoBarra = 12 | 14 | 16 | 24 | 26;
export type AnchoBarra = 'xs' | 's' | 'm' | 'l' | 'titulo' | 'lectura' | 'full';

/** El ladrillo: una barra del alto y ancho que se le pidan. Las medidas son valores fijos del CSS por `data-*` (cero `style=`: CSP con nonce). */
export function EsqBarra({ alto = 14, ancho = 'full', className }: { alto?: AltoBarra; ancho?: AnchoBarra; className?: string }) {
  return <span className={cx('skeleton rv-esq-barra', className)} data-alto={alto} data-ancho={ancho} aria-hidden="true" />;
}

function Esperando({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className} role="status" aria-busy="true" aria-label="Cargando">{children}</div>;
}

/** Una tarjeta: título + cuerpo del alto del contenido real. */
export function EsqTarjetaV2({ alto = 120, className, plana }: { alto?: 60 | 84 | 120 | 160 | 240 | 320; className?: string; plana?: boolean }) {
  // `plana`: solo el cuerpo (para el interior de una `Tarjeta` que ya trae su propio marco y título).
  if (plana) return <Esperando className={className}><span className="skeleton rv-esq-cuerpo" data-alto={alto} aria-hidden="true" /></Esperando>;
  return (
    <Esperando className={cx('rv-tarjeta rv-esq', className)}>
      <EsqBarra alto={16} ancho="s" />
      <span className="skeleton rv-esq-cuerpo" data-alto={alto} aria-hidden="true" />
    </Esperando>
  );
}

/** Una tira de n indicadores con la forma de `TiraCifras` (112 px). */
export function EsqCifrasV2({ n = 4 }: { n?: 2 | 3 | 4 | 5 }) {
  return (
    <Esperando className="rv-kpis rv-esq-cifras">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="rv-kpi">
          <EsqBarra alto={12} ancho="m" />
          <EsqBarra alto={26} ancho="s" />
          <EsqBarra alto={12} ancho="l" />
        </div>
      ))}
    </Esperando>
  );
}

/** Una tabla: encabezado de 36 px y filas de 40. */
export function EsqTablaV2({ filas = 6, plana }: { filas?: number; plana?: boolean }) {
  const cuerpo = (
    <div className="rv-esq-tabla">
      <span className="skeleton rv-esq-fila rv-esq-fila--cab" aria-hidden="true" />
      {Array.from({ length: filas }).map((_, i) => <span key={i} className="skeleton rv-esq-fila" aria-hidden="true" />)}
    </div>
  );
  if (plana) return <Esperando>{cuerpo}</Esperando>;
  return (
    <Esperando className="rv-tarjeta rv-esq">
      <EsqBarra alto={16} ancho="s" />
      {cuerpo}
    </Esperando>
  );
}

/** La pantalla entera mientras llega: encabezado, tira de cifras y dos tarjetas. Es lo que muestra `loading.tsx`. */
export function EsqPagina() {
  return (
    <div className="rv-marco rv-esq-pagina" data-carga="pagina" role="status" aria-busy="true" aria-label="Cargando">
      <div className="rv-encabezado">
        <div className="rv-encabezado__texto rv-esq-encabezado">
          <EsqBarra alto={12} ancho="xs" />
          <EsqBarra alto={24} ancho="titulo" />
          <EsqBarra alto={14} ancho="lectura" />
        </div>
      </div>
      <div className="rv-kpis rv-esq-cifras">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rv-kpi">
            <EsqBarra alto={12} ancho="m" />
            <EsqBarra alto={26} ancho="s" />
            <EsqBarra alto={12} ancho="l" />
          </div>
        ))}
      </div>
      <div className="rv-esq-dos">
        <div className="rv-tarjeta rv-esq"><EsqBarra alto={16} ancho="s" /><span className="skeleton rv-esq-cuerpo" data-alto="240" aria-hidden="true" /></div>
        <div className="rv-tarjeta rv-esq"><EsqBarra alto={16} ancho="s" /><span className="skeleton rv-esq-cuerpo" data-alto="240" aria-hidden="true" /></div>
      </div>
    </div>
  );
}
