import Link from 'next/link';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { numero } from '@/lib/formato';
import { cx } from '../componentes/clases';
import { EstadoError } from '../componentes/estado-error';
import { EstadoVacio } from '../componentes/estado-vacio';
import { EsqTablaV2 } from '../componentes/esqueleto';
import {
  ariaSort, clavesTabla, hrefConParams, leerEstadoTabla, ordenarFilas, paginarFilas, siguienteOrden, ventanaPaginas,
  type Dir, type ParamsURL, type ValorOrden,
} from './estado-tabla';
import { TablaTeclado } from './tabla-teclado';

export interface ColumnaTabla<T> {
  id: string;
  titulo: string;
  /** Lo que se pinta en la celda. */
  celda: (fila: T) => ReactNode;
  /** Con `valor` la columna se puede ordenar (cuando la tabla es `orden="local"`). Es el dato, no el texto formateado. */
  valor?: (fila: T) => ValorOrden;
  alinear?: 'der';
  /** Primera columna: el título de la FILA para lectores de pantalla (`<th scope="row">`). */
  principal?: boolean;
  /** Columna de acciones: el título se lee pero no se ve. */
  tituloOculto?: boolean;
  /** Rótulo de la celda en la tarjeta-fila de móvil. Por omisión, el título. */
  etiquetaMovil?: string;
  /** Contenido corto (fecha, unidad, importe, pastilla) que no debe partirse en dos renglones. Las columnas a la derecha ya van así. */
  corta?: boolean;
}

export interface SeleccionTabla<T> {
  /** `name` de cada casilla (se envían con el formulario `form`). */
  nombre: string;
  /** `id` del `<form>` al que pertenecen las casillas; la acción masiva vive en ese formulario. */
  form: string;
  idFila: (fila: T) => string;
  /** «Seleccionar V-1042». */
  etiquetaFila: (fila: T) => string;
  singular: string;
  plural: string;
}

export interface PropsTablaLista<T> {
  /** Nombre de la tabla para lectores de pantalla (`<caption>`): «Viajes», «Bandeja de facturas». */
  etiqueta: string;
  columnas: readonly ColumnaTabla<T>[];
  filas: readonly T[];
  idFila: (fila: T) => string;
  estado?: 'ok' | 'cargando' | 'error';
  /** Error: qué no se pudo consultar (se completa con «No es cero»). */
  mensajeError?: string;
  /** Error desde un componente de servidor: Reintentar vuelve a pedir los datos de la página. */
  reintentar?: boolean;
  /** Sin filas: título (≤6 palabras), una línea y, a lo sumo, UNA acción. */
  vacio?: { titulo: string; texto?: ReactNode; accion?: ReactNode };
  /** Ruta de esta pantalla (sin query) y los parámetros actuales: las cabeceras y la paginación los conservan. */
  base: string;
  params: ParamsURL;
  /** `local`: la tabla ordena `filas` por la columna elegida (todas las filas están en memoria). Sin esto el orden lo impone el
   *  servidor y NINGUNA cabecera ofrece ordenar (ordenar solo la página visible fingiría ordenar el total). */
  orden?: 'local' | { inicial: { orden: string; dir: Dir } };
  /** Páginas de `tamano` filas por URL (`pag`). Sin esto se pintan todas (la paginación es del servidor o no hay). */
  paginacion?: { tamano: number };
  /** Prefijo de los parámetros cuando hay dos tablas en la pantalla («cola_» → `cola_orden`). */
  prefijo?: string;
  seleccion?: SeleccionTabla<T>;
  /** Pie propio (paginación por cursor del servidor, aclaraciones). Va bajo la tabla. */
  pie?: ReactNode;
  /** Altas de 32 px (tablas de apoyo). */
  densa?: boolean;
  /** Atributos para la fila (p. ej. `data-estado`). Nada de `style`. */
  atributosFila?: (fila: T) => Record<`data-${string}`, string | undefined>;
  className?: string;
}

function Cabecera<T>({ col, estadoOrden, ordenable, hrefOrden, accion }: {
  col: ColumnaTabla<T>;
  estadoOrden: { orden: string | null; dir: Dir };
  ordenable: boolean;
  hrefOrden?: string;
  accion?: string;
}) {
  const clase = cx('rv-tl__th', col.alinear === 'der' && 'rv-tl__der');
  if (!ordenable || !hrefOrden) {
    return (
      <th scope="col" role="columnheader" className={clase}>
        {col.tituloOculto ? <span className="rv-sr">{col.titulo}</span> : col.titulo}
      </th>
    );
  }
  const dir = estadoOrden.orden === col.id ? estadoOrden.dir : null;
  const Icono = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ChevronsUpDown;
  return (
    <th scope="col" role="columnheader" className={clase} aria-sort={ariaSort(estadoOrden, col.id)}>
      <Link href={hrefOrden} className="rv-tl__orden" prefetch={false} scroll={false}>
        <span>{col.titulo}</span>
        <Icono className="rv-tl__icono" width={12} height={12} strokeWidth={2} aria-hidden="true" data-activo={dir ? '' : undefined} />
        <span className="rv-sr">. {accion}</span>
      </Link>
    </th>
  );
}

/** La tabla de volumen ÚNICA del producto: cabecera de 36 pegajosa, filas de 40, `<caption>` y `scope`, orden y paginación por URL,
 *  `aria-sort`, flechas ↑ ↓ entre filas, estados vacío / error / cargando con las mismas primitivas de todo el producto, selección
 *  opcional y, bajo 820 px, cada fila se vuelve una tarjeta (el lote de responsive afina el resto). No pone estado oculto: lo que
 *  se ve se reproduce con la dirección de la página. */
export function TablaLista<T>(p: PropsTablaLista<T>) {
  const idLeyenda = useId();
  const local = p.orden !== undefined;
  const inicial = typeof p.orden === 'object' ? p.orden.inicial : undefined;
  const ordenables = local ? p.columnas.filter((c) => c.valor).map((c) => c.id) : [];
  const estado = leerEstadoTabla(p.params, { ordenables, inicial, prefijo: p.prefijo });
  const k = clavesTabla(p.prefijo);

  if (p.estado === 'cargando') return <EsqTablaV2 plana />;
  if (p.estado === 'error') return <EstadoError reintentar={p.reintentar}>{p.mensajeError}</EstadoError>;
  if (p.filas.length === 0) {
    return <EstadoVacio titulo={p.vacio?.titulo ?? 'Sin registros'} accion={p.vacio?.accion}>{p.vacio?.texto}</EstadoVacio>;
  }

  const col = estado.orden ? p.columnas.find((c) => c.id === estado.orden) : undefined;
  const ordenadas = local && col?.valor ? ordenarFilas(p.filas, col.valor, estado.dir) : [...p.filas];
  const pag = p.paginacion ? paginarFilas(ordenadas, estado.pagina, p.paginacion.tamano) : null;
  const visibles = pag ? pag.filas : ordenadas;

  const hrefOrden = (id: string): string => {
    const sig = siguienteOrden(estado, id, inicial);
    return hrefConParams(p.base, p.params, { [k.orden]: sig?.orden ?? null, [k.dir]: sig ? sig.dir : null, [k.pagina]: null });
  };
  const textoAccion = (id: string): string => {
    const sig = siguienteOrden(estado, id, inicial);
    return !sig ? 'Quitar el orden' : sig.dir === 'asc' ? 'Ordenar de menor a mayor' : 'Ordenar de mayor a menor';
  };
  const hrefPagina = (n: number): string => hrefConParams(p.base, p.params, { [k.pagina]: n > 1 ? String(n) : null });

  const sel = p.seleccion;

  const tabla = (
    <div className="rv-tl__region" role="region" aria-labelledby={idLeyenda} tabIndex={0}>
      <table role="table" className="rv-tl" data-densa={p.densa || undefined}>
        <caption id={idLeyenda} className="rv-sr">
          {p.etiqueta}
          {pag ? `. Filas ${numero(pag.desde)} a ${numero(pag.hasta)} de ${numero(pag.total)}` : ''}
          {col ? `. Ordenada por ${col.titulo}, ${estado.dir === 'asc' ? 'de menor a mayor' : 'de mayor a menor'}` : ''}
        </caption>
        <thead role="rowgroup">
          <tr role="row">
            {sel ? (
              <th scope="col" role="columnheader" className="rv-tl__th rv-tl__sel">
                <input type="checkbox" data-sel-todas="" aria-label={`Seleccionar todas las filas visibles (${visibles.length})`} />
              </th>
            ) : null}
            {p.columnas.map((c) => (
              <Cabecera key={c.id} col={c} estadoOrden={estado} ordenable={Boolean(local && c.valor)}
                hrefOrden={local && c.valor ? hrefOrden(c.id) : undefined} accion={textoAccion(c.id)} />
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {visibles.map((f) => (
            <tr key={p.idFila(f)} role="row" {...(p.atributosFila?.(f) ?? {})}>
              {sel ? (
                <td role="cell" className="rv-tl__sel" data-etq="">
                  <input type="checkbox" name={sel.nombre} value={sel.idFila(f)} form={sel.form} data-sel-fila="" aria-label={sel.etiquetaFila(f)} />
                </td>
              ) : null}
              {p.columnas.map((c) => c.principal ? (
                <th key={c.id} scope="row" role="rowheader" className={cx('rv-tl__td', 'rv-tl__rowhead', (c.alinear === 'der' || c.corta) && 'rv-tl__nw', c.alinear === 'der' && 'rv-tl__der')} data-etq={c.tituloOculto ? '' : (c.etiquetaMovil ?? c.titulo)}><span className="rv-tl__v">{c.celda(f)}</span></th>
              ) : (
                <td key={c.id} role="cell" className={cx('rv-tl__td', (c.alinear === 'der' || c.corta) && 'rv-tl__nw', c.alinear === 'der' && 'rv-tl__der')} data-etq={c.tituloOculto ? '' : (c.etiquetaMovil ?? c.titulo)}><span className="rv-tl__v">{c.celda(f)}</span></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className={cx('rv-tl__caja', p.className)}>
      {sel ? <p className="rv-tl__conteo" data-sel-conteo="" role="status" aria-live="polite" /> : null}
      <TablaTeclado seleccion={sel ? { singular: sel.singular, plural: sel.plural } : undefined}>{tabla}</TablaTeclado>
      {pag && pag.paginas > 1 ? (
        <nav className="rv-tl__pie" aria-label={`Páginas de ${p.etiqueta}`}>
          <span className="rv-tl__rango">{numero(pag.desde)}–{numero(pag.hasta)} de {numero(pag.total)}</span>
          <ul className="rv-tl__paginas">
            {pag.pagina > 1 ? <li><Link className="rv-tl__pag" rel="prev" href={hrefPagina(pag.pagina - 1)} prefetch={false} scroll={false}>Anterior</Link></li> : null}
            {ventanaPaginas(pag.pagina, pag.paginas).map((n, i) => n === null ? (
              <li key={`h${i}`} aria-hidden="true" className="rv-tl__hueco">…</li>
            ) : (
              <li key={n}>
                <Link className="rv-tl__pag" href={hrefPagina(n)} prefetch={false} scroll={false}
                  aria-current={n === pag.pagina ? 'page' : undefined} aria-label={`Página ${n} de ${pag.paginas}`}>{n}</Link>
              </li>
            ))}
            {pag.pagina < pag.paginas ? <li><Link className="rv-tl__pag" rel="next" href={hrefPagina(pag.pagina + 1)} prefetch={false} scroll={false}>Siguiente</Link></li> : null}
          </ul>
        </nav>
      ) : pag ? <p className="rv-tl__rango rv-tl__rango--solo">{numero(pag.total)} {pag.total === 1 ? 'fila' : 'filas'}</p> : null}
      {p.pie}
    </div>
  );
}
