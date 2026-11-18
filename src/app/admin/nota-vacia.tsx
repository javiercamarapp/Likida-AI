import type { ReactNode } from 'react';
import { Aviso } from '@/app/ui-v2/componentes';
import './aud16b.css';

export type TonoNota = 'info' | 'ok' | 'warn' | 'bad' | 'muted';

const TONO_AVISO = { info: 'info', ok: 'ok', warn: 'warn', bad: 'error', muted: 'info' } as const;

/** Nota de UNA línea de /admin: es el `Aviso` compartido de ui-v2 (la misma pieza que usa el dashboard), no una caja propia.
 *  Icono + tono semántico + título en negrita + línea de apoyo. El `sello` (rótulo corto: «Observado», «No disponible») ocupa el lugar
 *  del título cuando no hay otro. Nunca color solo: el texto siempre dice el estado. Se puede pintar desde un componente de servidor. */
export function NotaVacia({ tono = 'muted', sello, titulo, children, className }: {
  tono?: TonoNota;
  /** Rótulo corto en negrita («Observado», «No disponible»). */
  sello?: string;
  titulo?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Aviso tono={TONO_AVISO[tono]} titulo={sello ?? titulo} className={className}>
      {sello && titulo ? <strong>{titulo}</strong> : null}
      {children}
    </Aviso>
  );
}

/** Varias notas en una sola fila que se acomoda al ancho (2-3 columnas), en lugar de un recuadro alto por dato. */
export function NotasAgrupadas({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className ? `aud16b-notas ${className}` : 'aud16b-notas'}>{children}</div>;
}
