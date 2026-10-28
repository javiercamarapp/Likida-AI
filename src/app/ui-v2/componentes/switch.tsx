import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from './clases';

/** Interruptor accesible: un <input type="checkbox" role="switch"> real dentro de
 *  su <label>, así viaja en el FormData igual que una casilla (`value="1"`
 *  explícito por la misma razón que `Casilla` de forma.tsx: sin marcar no viaja).
 *  La pista se pinta por CSS con tokens; el estado nunca depende solo del color
 *  (la perilla cambia de lado). */
export function Switch({ nombre, etiqueta, ayuda, className, ...resto }: {
  nombre: string;
  etiqueta: ReactNode;
  ayuda?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'name' | 'id' | 'role'>) {
  return (
    <div className={cx('rv-switch', className)}>
      <label htmlFor={nombre} className="rv-switch__fila">
        <input id={nombre} name={nombre} type="checkbox" role="switch" value="1" className="rv-switch__input" {...resto} />
        <span className="rv-switch__pista" aria-hidden="true"><span className="rv-switch__perilla" /></span>
        <span className="rv-switch__etq">{etiqueta}</span>
      </label>
      {ayuda ? <span className="rv-switch__ayuda">{ayuda}</span> : null}
    </div>
  );
}
