import Link from 'next/link';
import { BarraFiltros, FiltroBusqueda } from '@/app/ui-v2/componentes';
import { numero } from '@/lib/formato';
import { urlRegistro, type PaginaRegistroUI } from './paginar-registro';

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
  ruta, sufijo, pagina, sustantivo, camposOcultos = [], nombreQ = 'q', nombreP = 'p', nombreEditar = 'editar',
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
}) {
  const { q, paginas } = pagina;
  const hayFiltro = q !== '';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
      <BarraFiltros buscar accion={ruta} enLinea etiqueta={`Buscar en ${sustantivo}`} ocultos={camposOcultos} nActivos={hayFiltro ? 1 : 0}
        limpiarHref={urlRegistro(ruta, sufijo, { [nombreQ]: null, [nombreP]: null, [nombreEditar]: null })}>
        <FiltroBusqueda nombre={nombreQ} valor={q} placeholder={`Buscar en ${sustantivo}…`} etiqueta={`Buscar en ${sustantivo}`} />
      </BarraFiltros>

      <div className="flex items-center gap-3 text-[12px]" style={{ color: 'var(--muted)' }}>
        <span>
          {hayFiltro
            ? `${numero(pagina.filtrados)} ${pagina.filtrados === 1 ? 'coincide' : 'coinciden'} de ${numero(pagina.total)}`
            : `${numero(pagina.filas.length)} de ${numero(pagina.total)} ${sustantivo}`}
        </span>
        {paginas > 1 && (
          <span className="flex items-center gap-2">
            {pagina.pagina > 1 ? (
              <Link href={urlRegistro(ruta, sufijo, { [nombreQ]: q || null, [nombreP]: pagina.pagina - 1, [nombreEditar]: null })}
                className="underline hover:opacity-70 transition-opacity">← Anterior</Link>
            ) : <span style={{ color: 'var(--faint)' }}>← Anterior</span>}
            <span className="tabular">Página {numero(pagina.pagina)} de {numero(paginas)}</span>
            {pagina.pagina < paginas ? (
              <Link href={urlRegistro(ruta, sufijo, { [nombreQ]: q || null, [nombreP]: pagina.pagina + 1, [nombreEditar]: null })}
                className="underline hover:opacity-70 transition-opacity">Siguiente →</Link>
            ) : <span style={{ color: 'var(--faint)' }}>Siguiente →</span>}
          </span>
        )}
      </div>
    </div>
  );
}
