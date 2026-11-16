import { AlertTriangle, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from '@/app/logo';
import { textoUi } from '../componentes/texto-ui';
import type { Idioma } from '@/lib/i18n/idioma';

export type EstadoGrafica = 'cargando' | 'error' | 'vacio' | 'ok';

/** Envoltorio de estados de una gráfica o bloque de datos: cargando (logo que
 *  respira, sin texto visible ni esqueleto), error (con causa y reintento
 *  cuando el padre da `accionReintentar`) y vacío (dice qué falta). Con `ok`
 *  devuelve los hijos tal cual. El alto mínimo evita el salto de layout. */
export function ChartState({ estado, children, mensaje, accion, alto = 200, idioma }: {
  /** Idioma de los mensajes por omisión (servidor sin proveedor); por omisión, es. */
  idioma?: Idioma;
  estado: EstadoGrafica;
  children?: ReactNode;
  /** Error: causa. Vacío: qué falta y cómo se llena. */
  mensaje?: string;
  /** Reintentar o siguiente paso (un botón o enlace de verdad). */
  accion?: ReactNode;
  alto?: number;
}) {
  if (estado === 'ok') return <>{children}</>;
  const t = textoUi(idioma);
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
      <p className="rv-chartstate__msg">{mensaje ?? t(error ? 'comun.no_se_pudo_cargar' : 'comun.sin_datos_todavia')}</p>
      {accion ? <div className="rv-chartstate__accion">{accion}</div> : null}
    </div>
  );
}
