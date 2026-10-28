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
