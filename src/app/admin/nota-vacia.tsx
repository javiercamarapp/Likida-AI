import type { ReactNode } from 'react';
import { AlertTriangle, Check, Info, OctagonAlert } from 'lucide-react';
import './aud16b.css';

export type TonoNota = 'info' | 'ok' | 'warn' | 'bad' | 'muted';

const ICONO = { info: Info, ok: Check, warn: AlertTriangle, bad: OctagonAlert, muted: Info } as const;

/** Nota de UNA línea (lote B, auditoría visual 16-nov): sustituye al recuadro alto y punteado de «sin dato / qué no se sabe».
 *  Icono pequeño + sello opcional con el color semántico + título en negrita + línea de apoyo, sobre su propia superficie con borde.
 *  Nunca color solo: el texto siempre dice el estado. Se puede pintar desde un componente de servidor. */
export function NotaVacia({ tono = 'muted', sello, titulo, children, className }: {
  tono?: TonoNota;
  /** Rótulo corto en píldora («Observado», «No disponible»). */
  sello?: string;
  titulo?: string;
  children?: ReactNode;
  className?: string;
}) {
  const Glifo = ICONO[tono];
  return (
    <p className={className ? `aud16b-nota ${className}` : 'aud16b-nota'} data-tono={tono} role="status">
      <Glifo className="aud16b-nota__icono" width={14} height={14} strokeWidth={2} aria-hidden="true" />
      {sello ? <span className="aud16b-nota__sello">{sello}</span> : null}
      {titulo ? <strong className="aud16b-nota__titulo">{titulo}</strong> : null}
      {children ? <span className={titulo ? 'aud16b-nota__texto' : 'aud16b-nota__titulo aud16b-nota__solo'}>{children}</span> : null}
    </p>
  );
}

/** Varias notas en una sola fila que se acomoda al ancho (2-3 columnas), en lugar de un recuadro alto por dato. */
export function NotasAgrupadas({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className ? `aud16b-notas ${className}` : 'aud16b-notas'}>{children}</div>;
}
