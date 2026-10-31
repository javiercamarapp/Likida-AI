import type { ReactNode } from 'react';
import { cx } from './clases';
import { EstadoError } from './estado-error';
import { EstadoVacio } from './estado-vacio';
import { EsqTablaV2 } from './esqueleto';

// TABLA BASE v2 (L7): la tabla ESTÁTICA de Vexa (`ui-table-wrap`): región con scroll y foco por teclado (`role="region"`, tabIndex 0,
// alto máximo min(62dvh, 640px)), cabecera pegajosa de 36 px, filas de 40 (32 con `densa`), hover, y los tres estados integrados
// (cargando / error / vacío). Las medidas viven en componentes.css (`.card table`): esta pieza solo pone el marcado correcto.
//
// CONVIVENCIA CON TablaLista (L6, ui-v2/datos): TablaBase NO ordena ni pagina ni selecciona. Úsala para tablas de apoyo, fichas y
// listados cortos con las filas ya en memoria. En cuanto necesites orden, paginación por URL, selección masiva o tarjeta-fila con
// teclado, usa TablaLista: renderiza sobre las mismas medidas (cabecera 36 / fila 40) y los mismos estados. Nunca montes una tabla
// «a mano» con <table> dentro de una Tarjeta si alguna de las dos cubre el caso.

export interface ColumnaBase<T> {
  id: string;
  titulo: string;
  celda: (fila: T) => ReactNode;
  alinear?: 'der';
  /** Primera columna: el título de la FILA para lectores de pantalla (<th scope="row">). */
  principal?: boolean;
  /** Rótulo de la celda en la tarjeta-fila de móvil. Por omisión, el título. */
  etiquetaMovil?: string;
}

export function TablaBase<T>({ etiqueta, columnas, filas, idFila, estado = 'ok', mensajeError, vacio, densa, altoMaximo = true, tarjetaMovil, className }: {
  /** Nombre de la tabla (<caption> oculto y nombre de la región). */
  etiqueta: string;
  columnas: readonly ColumnaBase<T>[];
  filas: readonly T[];
  idFila: (fila: T) => string;
  estado?: 'ok' | 'cargando' | 'error';
  /** Error: qué no se pudo consultar. */
  mensajeError?: string;
  /** Sin filas: título (≤6 palabras) y una línea. */
  vacio?: { titulo: string; texto?: ReactNode; accion?: ReactNode };
  /** Filas de 32 px. */
  densa?: boolean;
  /** `false` quita el tope de alto (la tabla crece con la página). */
  altoMaximo?: boolean;
  /** Bajo 820 px cada fila se vuelve una tarjeta con «Rótulo — valor». */
  tarjetaMovil?: boolean;
  className?: string;
}) {
  if (estado === 'cargando') return <EsqTablaV2 plana />;
  if (estado === 'error') return <EstadoError compacto>{mensajeError}</EstadoError>;
  if (filas.length === 0) return <EstadoVacio titulo={vacio?.titulo ?? 'Sin filas'} accion={vacio?.accion}>{vacio?.texto}</EstadoVacio>;
  const idLeyenda = `tb-${etiqueta.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className={cx('card', 'rv-tb', className)}>
      <div className="rv-tb__region" role="region" aria-labelledby={idLeyenda} tabIndex={0} data-alto={altoMaximo ? 'max' : undefined}>
        <table data-densa={densa || undefined} data-tarjeta={tarjetaMovil || undefined}>
          <caption id={idLeyenda} className="rv-sr">{etiqueta}</caption>
          <thead>
            <tr>{columnas.map((c) => <th key={c.id} scope="col" className={c.alinear === 'der' ? 'num' : undefined}>{c.titulo}</th>)}</tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={idFila(f)}>
                {columnas.map((c) => c.principal
                  ? <th key={c.id} scope="row" data-label={c.etiquetaMovil ?? c.titulo}>{c.celda(f)}</th>
                  : <td key={c.id} className={c.alinear === 'der' ? 'num' : undefined} data-label={c.etiquetaMovil ?? c.titulo}>{c.celda(f)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
