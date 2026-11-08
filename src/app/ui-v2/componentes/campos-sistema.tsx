import type { ReactNode } from 'react';
import { cx } from './clases';

/** Valores que fija el sistema y la persona no edita (topes de ley, estado del proveedor, totales calculados). Un `<dl>` compacto en
 *  rejilla: etiqueta apagada de 12 px arriba, valor de 13/600 con cifras tabulares y una nota opcional de 11 px. Sin caja de entrada
 *  (no parece editable), sin funciones como props (se pinta desde un componente de servidor). Sustituye a las pilas de tarjetas con
 *  una cifra suelta. */
export function CamposSistema({ campos, etiqueta, className }: {
  campos: ReadonlyArray<{ etiqueta: ReactNode; valor: ReactNode; nota?: ReactNode }>;
  /** Nombre accesible del grupo (p. ej. «Topes fiscales»). */
  etiqueta?: string;
  className?: string;
}) {
  return (
    <dl className={cx('rv-sis', className)} aria-label={etiqueta}>
      {campos.map((c, i) => (
        <div className="rv-sis__campo" key={i}>
          <dt className="rv-sis__etq">{c.etiqueta}</dt>
          <dd className="rv-sis__valor">{c.valor}</dd>
          {c.nota ? <dd className="rv-sis__nota">{c.nota}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
