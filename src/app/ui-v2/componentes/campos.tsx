'use client';

import { AlertCircle, Paperclip } from 'lucide-react';
import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
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
          aria-describedby={[resto['aria-describedby'], ayuda ? idAyuda : null].filter(Boolean).join(' ') || undefined}
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
  const propio = isValidElement(children) ? children.props['aria-describedby'] : undefined;
  const ids = [propio, ayuda ? `${idCampo}-ayuda` : null, error ? `${idCampo}-error` : null].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, { id: idCampo, 'aria-describedby': ids, 'aria-invalid': error ? true : undefined, required: obligatorio || children.props.required })
    : children;
  return (
    <div className={cx('rv-campo', className)}>
      <label htmlFor={idCampo} className="rv-campo__etq">{etiqueta}{obligatorio ? <span className="rv-campo__obl" aria-hidden="true"> *</span> : null}</label>
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

/** Props comunes de los campos con etiqueta (CampoTexto, CampoFecha, CampoSelect, CampoTextarea, CampoArchivo). Todas serializables:
 *  ninguna es una función ni un componente, así que un componente de SERVIDOR puede pintarlos sin cruzar nada prohibido al cliente
 *  (salvo `onChange` y similares, que solo existen en hosts de cliente). */
interface PropsCampoBase {
  etiqueta: ReactNode;
  /** Línea de apoyo bajo el control (queda enlazada con aria-describedby). */
  ayuda?: ReactNode;
  /** Error de validación: se anuncia con role="alert" y marca el control con aria-invalid. */
  error?: ReactNode;
  /** Pone `required` al control y un asterisco discreto en la etiqueta (12/400, color apagado, aria-hidden). */
  obligatorio?: boolean;
  /** Clase del contenedor (grid de etiqueta + control + ayuda + error). */
  className?: string;
  /** Clase del control (input/select/textarea) en sí. */
  claseControl?: string;
  /** `id` del control; por omisión se genera uno. Pásalo cuando el `id` ya es contrato (pruebas, enlaces, un combo hermano). */
  id?: string;
}

/** Campo de texto del sistema (alto 32, radio 8, borde de control, 13/400). `tipo` por omisión «text»; sirve para number, email, tel, search… */
export function CampoTexto({ etiqueta, ayuda, error, obligatorio, className, claseControl, id, tipo = 'text', ...input }: PropsCampoBase & Omit<PropsInput, 'id' | 'className'> & { tipo?: 'text' | 'number' | 'email' | 'tel' | 'search' | 'url' | 'password' }) {
  return (
    <Campo etiqueta={etiqueta} ayuda={ayuda} error={error} obligatorio={obligatorio} className={className} id={id}>
      <input {...input} type={tipo} className={cx('rv-ctl', claseControl)} />
    </Campo>
  );
}

/** Campo de fecha del sistema: <input type="date"> con el mismo cromo que el texto (el selector de calendario nativo se conserva por
 *  accesibilidad y teclado). Viaja «aaaa-mm-dd» en el FormData, como siempre. */
export function CampoFecha({ etiqueta, ayuda, error, obligatorio, className, claseControl, id, ...input }: PropsCampoBase & Omit<PropsInput, 'id' | 'className'>) {
  return (
    <Campo etiqueta={etiqueta} ayuda={ayuda} error={error} obligatorio={obligatorio} className={className} id={id}>
      <input {...input} type="date" className={cx('rv-ctl', 'rv-ctl--fecha', claseControl)} />
    </Campo>
  );
}

/** Selector nativo del sistema (una sola flecha propia). Recibe sus <option> como hijos. */
export function CampoSelect({ etiqueta, ayuda, error, obligatorio, className, claseControl, id, children, ...select }: PropsCampoBase & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'className'>) {
  return (
    <Campo etiqueta={etiqueta} ayuda={ayuda} error={error} obligatorio={obligatorio} className={className} id={id}>
      <select {...select} className={cx('rv-ctl', claseControl)}>{children}</select>
    </Campo>
  );
}

/** Área de texto del sistema (13/400, mínimo 64 px, se redimensiona solo en vertical). */
export function CampoTextarea({ etiqueta, ayuda, error, obligatorio, className, claseControl, id, ...area }: PropsCampoBase & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'className'>) {
  return (
    <Campo etiqueta={etiqueta} ayuda={ayuda} error={error} obligatorio={obligatorio} className={className} id={id}>
      <textarea {...area} className={cx('rv-ctl', 'rv-ctl--area', claseControl)} />
    </Campo>
  );
}

/** Campo de archivo del sistema: el <input type="file"> REAL queda en el formulario (viaja en el FormData, `name`, `accept`,
 *  `required` y `multiple` funcionan igual) pero oculto de forma accesible (sigue en el orden de tabulación y lo anuncian los lectores
 *  de pantalla); lo que se ve es un botón del sistema de 32 px («Seleccionar archivo») y el nombre elegido, truncado con elipsis
 *  («Sin archivo seleccionado» mientras no haya). El foco del input se pinta en el botón. `textoBoton` cambia solo el rótulo. */
export function CampoArchivo({ etiqueta, ayuda, error, obligatorio, className, textoBoton = 'Seleccionar archivo', onChange, claseControl, id, ...input }: Omit<PropsInput, 'id' | 'type' | 'value' | 'className'> & PropsCampoBase & { textoBoton?: string }) {
  const [nombre, setNombre] = useState('');
  const auto = useId();
  const idNombre = `${auto}-nombre`;
  return (
    <Campo etiqueta={etiqueta} ayuda={ayuda} error={error} obligatorio={obligatorio} className={className} id={id}>
      <ControlArchivo {...input} className={claseControl} idNombre={idNombre} nombre={nombre} textoBoton={textoBoton}
        onChange={(e) => {
          const f = e.currentTarget.files;
          setNombre(!f || f.length === 0 ? '' : f.length === 1 ? f[0].name : `${f.length} archivos`);
          onChange?.(e);
        }} />
    </Campo>
  );
}

/** El control interno de CampoArchivo. `Campo` le inyecta `id`, `aria-describedby`, `aria-invalid` y `required` por cloneElement. */
function ControlArchivo({ idNombre, nombre, textoBoton, id, className, 'aria-describedby': describe, ...input }: PropsInput & { idNombre: string; nombre: string; textoBoton: string; id?: string }) {
  const ids = [describe, idNombre].filter(Boolean).join(' ');
  return (
    <div className={cx('rv-archivo', className)}>
      <input {...input} id={id} type="file" className="rv-archivo__input" aria-describedby={ids} />
      <label htmlFor={id} className="rv-archivo__boton"><Icono icono={Paperclip} tam={14} />{textoBoton}</label>
      <span id={idNombre} className="rv-archivo__nombre" data-vacio={nombre ? undefined : ''} title={nombre || undefined}>{nombre || 'Sin archivo seleccionado'}</span>
    </div>
  );
}
