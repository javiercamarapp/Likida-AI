import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Boton } from './boton';
import { BotonReintentar } from './boton-reintentar';

/** Estado de error BLANDO y único: dice qué no se pudo consultar, que NO es un cero y ofrece la salida (Reintentar). Nada de rojo
 *  a pantalla completa: un borde y un tinte suaves, `role="alert"` y UNA acción. */
export function EstadoError({ titulo = 'No disponible ahora', children, onReintentar, reintentar = false, accion, compacto }: {
  titulo?: string;
  /** Qué no se pudo consultar. Por omisión: «No es cero: la consulta no respondió a tiempo.» */
  children?: ReactNode;
  /** Reintentar en un componente de cliente. */
  onReintentar?: () => void;
  /** Reintentar en un componente de servidor: vuelve a pedir los datos de la página. */
  reintentar?: boolean;
  /** Otra acción propia (reemplaza al botón de Reintentar). */
  accion?: ReactNode;
  compacto?: boolean;
}) {
  return (
    <div className="rv-error" role="alert" data-compacto={compacto || undefined}>
      <AlertTriangle className="rv-error__icono" width={16} height={16} strokeWidth={1.75} aria-hidden="true" />
      <div className="rv-error__cuerpo">
        {/* Un solo texto («No disponible ahora. No es cero: …»): es la frase que el producto promete en todo estado de error. */}
        <span className="rv-error__texto">
          {typeof children === 'string' || children === undefined
            ? `${titulo}. ${children ?? 'No es cero: la consulta no respondió a tiempo.'}`
            : <>{titulo}. {children}</>}
        </span>
      </div>
      <div className="rv-error__accion">
        {accion ?? (onReintentar ? <Boton tamano="sm" onClick={onReintentar}>Reintentar</Boton> : reintentar ? <BotonReintentar /> : null)}
      </div>
    </div>
  );
}
