'use client';

import { AlertCircle } from 'lucide-react';
import { cloneElement, isValidElement, useEffect, useId, useRef, type InputHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { cx } from './clases';
import { Icono } from './icono';

// ═══════════════════════════════════════════════════════════════════════════
// CAMPOS DE FORMULARIO v2 (L7): casilla, radio, campo (etiqueta + ayuda + error), fieldset/legend y campo de archivo.
// Todos son controles NATIVOS (viajan en el FormData, teclado y lectores de pantalla gratis); solo se pinta la caja por CSS
// (`appearance: none` + tokens), sin `style=`. El interruptor vive en `switch.tsx`. Catálogo de uso: CATALOGO-L7.md.
// ═══════════════════════════════════════════════════════════════════════════

type PropsInput = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'>;

interface PropsMarca extends PropsInput {
  etiqueta: ReactNode;
  /** Línea de apoyo bajo la etiqueta (queda enlazada con aria-describedby). */
  ayuda?: ReactNode;
}

function Marca({ tipo, etiqueta, ayuda, className, id, indeterminada, ...resto }: PropsMarca & { tipo: 'checkbox' | 'radio'; indeterminada?: boolean }) {
  const auto = useId();
  const idCampo = id ?? auto;
  const idAyuda = `${idCampo}-ayuda`;
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminada; }, [indeterminada]);
  return (
    <div className={cx('rv-marca', tipo === 'radio' && 'rv-marca--radio', className)}>
      <label htmlFor={idCampo} className="rv-marca__fila">
        <input
          {...resto}
          ref={ref}
          id={idCampo}
          type={tipo}
          className="rv-marca__input"
          aria-describedby={ayuda ? idAyuda : resto['aria-describedby']}
        />
        <span className="rv-marca__etq">{etiqueta}</span>
      </label>
      {ayuda ? <span id={idAyuda} className="rv-marca__ayuda">{ayuda}</span> : null}
    </div>
  );
}

/** Casilla: <input type="checkbox"> con caja propia 16 px. Sin `value` viaja "on" cuando está marcada, como la nativa. `indeterminada` pinta el guion. */
export function Casilla({ indeterminada, ...p }: PropsMarca & { indeterminada?: boolean }) {
  return <Marca tipo="checkbox" indeterminada={indeterminada} {...p} />;
}

/** Radio: <input type="radio"> con caja propia 16 px. Los radios de un grupo comparten `name` y van dentro de un <Fieldset>. */
export function Radio(p: PropsMarca) {
  return <Marca tipo="radio" {...p} />;
}

/** Campo = etiqueta + control + ayuda + error. Recibe UN elemento (input, select, textarea) y le da `id`, `aria-describedby` y
 *  `aria-invalid`; el error se anuncia con rol alert y lleva icono (nunca solo color). */
export function Campo({ etiqueta, ayuda, error, obligatorio, id, className, children }: {
  etiqueta: ReactNode;
  ayuda?: ReactNode;
  error?: ReactNode;
  obligatorio?: boolean;
  id?: string;
  className?: string;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean; required?: boolean }>;
}) {
  const auto = useId();
  const idCampo = id ?? auto;
  const ids = [ayuda ? `${idCampo}-ayuda` : null, error ? `${idCampo}-error` : null].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, { id: idCampo, 'aria-describedby': ids, 'aria-invalid': error ? true : undefined, required: obligatorio || children.props.required })
    : children;
  return (
    <div className={cx('rv-campo', className)}>
      <label htmlFor={idCampo} className="rv-campo__etq">{etiqueta}{obligatorio ? <span className="rv-campo__obl"> (obligatorio)</span> : null}</label>
      {control}
      {ayuda ? <span id={`${idCampo}-ayuda`} className="rv-campo__ayuda">{ayuda}</span> : null}
      {error ? <span id={`${idCampo}-error`} role="alert" className="rv-campo__error"><Icono icono={AlertCircle} tam={14} />{error}</span> : null}
    </div>
  );
}

/** Conjunto de campos con título: <fieldset> + <legend> (13/600). Para grupos de radios o casillas, y secciones de un formulario. */
export function Fieldset({ leyenda, ayuda, className, children }: { leyenda: ReactNode; ayuda?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <fieldset className={cx('rv-fieldset', className)}>
      <legend className="rv-fieldset__leyenda">{leyenda}</legend>
      {ayuda ? <p className="rv-fieldset__ayuda">{ayuda}</p> : null}
      {children}
    </fieldset>
  );
}

/** Campo de archivo: <input type="file"> real (el nombre elegido lo anuncia el navegador) con el botón interno de 32 px de Vexa. */
export function CampoArchivo({ etiqueta, ayuda, error, obligatorio, className, ...input }: Omit<PropsInput, 'id'> & {
  etiqueta: ReactNode;
  ayuda?: ReactNode;
  error?: ReactNode;
  obligatorio?: boolean;
}) {
  return (
    <Campo etiqueta={etiqueta} ayuda={ayuda} error={error} obligatorio={obligatorio} className={className}>
      <input {...input} type="file" className="rv-archivo" />
    </Campo>
  );
}
