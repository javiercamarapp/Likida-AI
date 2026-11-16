import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Boton } from './boton';
import { BotonReintentar } from './boton-reintentar';
import { textoUi } from './texto-ui';
import type { Idioma } from '@/lib/i18n/idioma';

/** Estado de error BLANDO y único: dice qué no se pudo consultar, que NO es un cero y ofrece la salida (Reintentar). Nada de rojo
 *  a pantalla completa: un borde y un tinte suaves, `role="alert"` y UNA acción. */
export function EstadoError({ titulo: tituloProp, children, onReintentar, reintentar = false, accion, compacto, idioma }: {
  titulo?: string;
  /** Idioma de los textos por omisión (servidor sin proveedor); por omisión, es. */
  idioma?: Idioma;
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
  const t = textoUi(idioma);
  const titulo = tituloProp ?? t('comun.no_disponible');
  return (
    <div className="rv-error" role="alert" data-compacto={compacto || undefined}>
      <AlertTriangle className="rv-error__icono" width={16} height={16} strokeWidth={1.75} aria-hidden="true" />
      <div className="rv-error__cuerpo">
        {/* Un solo texto («No disponible ahora. No es cero: …»): es la frase que el producto promete en todo estado de error. */}
        <span className="rv-error__texto">
          {typeof children === 'string' || children === undefined
            ? `${titulo}. ${children ?? t('comun.no_es_cero_consulta')}`
            : <>{titulo}. {children}</>}
        </span>
      </div>
      <div className="rv-error__accion">
        {accion ?? (onReintentar ? <Boton tamano="sm" onClick={onReintentar}>Reintentar</Boton> : reintentar ? <BotonReintentar /> : null)}
      </div>
    </div>
  );
}
