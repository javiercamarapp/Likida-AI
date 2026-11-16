import { urlRegistro, type PaginaRegistroUI } from './paginar-registro';
import { BuscadorRegistro, ConteoRegistroTexto } from './registro-filtro-cliente';

/**
 * La barra de búsqueda + paginación de los registros del panel (FE-12).
 *
 * Es un `<form method="get">` a propósito (la BarraFiltros de ui-v2 en modo GET): Intro envía, sin estado de
 * cliente y sin server action. El registro es una pantalla de lectura; lo que
 * necesita es que la URL diga qué se está mirando —para poder compartirla y
 * para que "atrás" funcione—, no un componente interactivo.
 *
 * El pie DECLARA lo que se está viendo: "25 de 7,500", y con búsqueda, "12
 * que coinciden de 7,500". Un registro que enseña 25 filas sin decir de
 * cuántas es la forma en que un tope se lee como un total.
 */
export function FiltroRegistro<T>({
  ruta, sufijo, pagina, sustantivo, camposOcultos = [], nombreQ = 'q', nombreP = 'p', nombreEditar = 'editar', conteoEnPie = false,
}: {
  ruta: string;
  /** `?tenant=`/`?vista=`/`?rol=` del superadmin (sufijoTenant). */
  sufijo: string;
  pagina: PaginaRegistroUI<T>;
  /** Cómo se llaman las filas: "unidades", "operadores", "clientes". */
  sustantivo: string;
  /** Los parámetros que el GET debe conservar (los del sufijo) — un `<form>`
   *  reemplaza el query string entero, así que lo que no viaje como campo se
   *  pierde: el superadmin saldría de la flota que estaba viendo. */
  camposOcultos?: Array<[string, string]>;
  /** Los nombres de los parámetros. Dos registros en la misma página
   *  (clientes y tarifas) necesitan los suyos, o buscar en uno mueve al otro. */
  nombreQ?: string;
  nombreP?: string;
  nombreEditar?: string;
  /** El conteo («25 de N») y la paginación se pintan en el pie de la tabla con `PieRegistro` (Rovaq), no arriba a la derecha. */
  conteoEnPie?: boolean;
}) {
  const { q } = pagina;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <BuscadorRegistro ruta={ruta} sustantivo={sustantivo} camposOcultos={camposOcultos} nombreQ={nombreQ} q={q}
        limpiarHref={urlRegistro(ruta, sufijo, { [nombreQ]: null, [nombreP]: null, [nombreEditar]: null })} />

      {conteoEnPie ? null : <ConteoRegistro ruta={ruta} sufijo={sufijo} pagina={pagina} sustantivo={sustantivo} nombreQ={nombreQ} nombreP={nombreP} nombreEditar={nombreEditar} />}
    </div>
  );
}

type PropsConteo<T> = { ruta: string; sufijo: string; pagina: PaginaRegistroUI<T>; sustantivo: string; nombreQ?: string; nombreP?: string; nombreEditar?: string };

/** El texto «25 de N» + la paginación Anterior / Siguiente (el texto vive en `registro-filtro-cliente.tsx`). */
function ConteoRegistro<T>({ ruta, sufijo, pagina, sustantivo, nombreQ = 'q', nombreP = 'p', nombreEditar = 'editar' }: PropsConteo<T>) {
  const { q, paginas } = pagina;
  const enlace = (p: number) => urlRegistro(ruta, sufijo, { [nombreQ]: q || null, [nombreP]: p, [nombreEditar]: null });
  return (
    <ConteoRegistroTexto hayFiltro={q !== ''} filtrados={pagina.filtrados} total={pagina.total} nFilas={pagina.filas.length} sustantivo={sustantivo}
      paginas={paginas} paginaActual={pagina.pagina} hrefAnterior={enlace(pagina.pagina - 1)} hrefSiguiente={enlace(pagina.pagina + 1)} />
  );
}

/** El pie de la tabla maestra (Rovaq): «25 de N» a la izquierda y la paginación a la derecha, dentro de la tarjeta. */
export function PieRegistro<T>(props: PropsConteo<T>) {
  return <div className="rv-reg__pie-tabla"><ConteoRegistro {...props} /></div>;
}
