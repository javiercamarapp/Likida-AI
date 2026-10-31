import { AlertTriangle, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from '@/app/logo';

export type EstadoGrafica = 'cargando' | 'error' | 'vacio' | 'ok';

/** Envoltorio de estados de una gráfica o bloque de datos: cargando (logo que
 *  respira, sin texto visible ni esqueleto), error (con causa y reintento
 *  cuando el padre da `accionReintentar`) y vacío (dice qué falta). Con `ok`
 *  devuelve los hijos tal cual. El alto mínimo evita el salto de layout. */
export function ChartState({ estado, children, mensaje, accion, alto = 200 }: {
  estado: EstadoGrafica;
  children?: ReactNode;
  /** Error: causa. Vacío: qué falta y cómo se llena. */
  mensaje?: string;
  /** Reintentar o siguiente paso (un botón o enlace de verdad). */
  accion?: ReactNode;
  alto?: number;
}) {
  if (estado === 'ok') return <>{children}</>;
  if (estado === 'cargando') {
    return (
      <div className="rv-chartstate" style={{ minHeight: alto }} role="status" aria-busy="true" aria-label={mensaje ?? 'Cargando'}>
        <Logo alto="h-[26px]" className="likida-respira" />
      </div>
    );
  }
  const error = estado === 'error';
  const Icono = error ? AlertTriangle : Inbox;
  return (
    <div className="rv-chartstate" data-estado={estado} style={{ minHeight: alto }} role={error ? 'alert' : 'status'}>
      <Icono width={18} height={18} strokeWidth={1.75} aria-hidden="true" />
      <p className="rv-chartstate__msg">{mensaje ?? (error ? 'No se pudo cargar.' : 'Sin datos todavía.')}</p>
      {accion ? <div className="rv-chartstate__accion">{accion}</div> : null}
    </div>
  );
}
