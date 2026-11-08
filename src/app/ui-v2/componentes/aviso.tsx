import { AlertTriangle, Check, Info, OctagonAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './clases';

export type TonoAviso = 'info' | 'warn' | 'error' | 'ok';

const ICONO = { info: Info, warn: AlertTriangle, error: OctagonAlert, ok: Check } as const;

/** Aviso en línea con tono. Icono + texto (nunca color solo). `error` usa
 *  role="alert"; el resto "status". Distinto del `Aviso` de admin/ui/forma.tsx
 *  (resultado de server actions), que no se toca. */
export function Aviso({ tono = 'info', titulo, children, acciones, className }: {
  tono?: TonoAviso;
  titulo?: string;
  children?: ReactNode;
  acciones?: ReactNode;
  className?: string;
}) {
  const Icono = ICONO[tono];
  return (
    <div className={cx('rv-aviso', className)} data-tono={tono} role={tono === 'error' ? 'alert' : 'status'}>
      <Icono className="rv-aviso__icono" width={14} height={14} strokeWidth={2} aria-hidden="true" />
      <div className="rv-aviso__cuerpo">
        {titulo ? <strong className="rv-aviso__titulo">{titulo}</strong> : null}
        {children ? <span>{children}</span> : null}
      </div>
      {acciones ? <div className="rv-aviso__acciones">{acciones}</div> : null}
    </div>
  );
}

/** Banner informativo COMPACTO: a lo más 2 líneas visibles del resumen (recorte con `line-clamp`) y, si hay más que decir, un
 *  «Ver más» que despliega el resto en un <details> nativo (sin JavaScript). Sustituye a los párrafos o banners largos antes del
 *  contenido: lo importante en dos líneas, lo legal o de contexto detrás del enlace. Mismo cromo y tonos que `Aviso`; `error` usa
 *  role="alert". Sin funciones como props: se puede pintar desde un componente de servidor. */
export function AvisoCompacto({ tono = 'info', resumen, mas, etiquetaMas = 'Ver más', className }: {
  tono?: TonoAviso;
  /** Lo esencial, en una o dos líneas (se recorta a dos). */
  resumen: ReactNode;
  /** El detalle completo; si no hay, no aparece «Ver más». */
  mas?: ReactNode;
  etiquetaMas?: string;
  className?: string;
}) {
  const Glifo = ICONO[tono];
  return (
    <div className={cx('rv-aviso', 'rv-aviso--compacto', className)} data-tono={tono} role={tono === 'error' ? 'alert' : 'status'}>
      <Glifo className="rv-aviso__icono" width={14} height={14} strokeWidth={2} aria-hidden="true" />
      <div className="rv-aviso__compacto">
        <p className="rv-aviso__resumen">{resumen}</p>
        {mas ? (
          <details className="rv-aviso__mas">
            <summary className="rv-aviso__mas-cab">{etiquetaMas}</summary>
            <div className="rv-aviso__mas-cuerpo">{mas}</div>
          </details>
        ) : null}
      </div>
    </div>
  );
}
