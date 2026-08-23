import Link from 'next/link';
import { Search } from 'lucide-react';
import { numero } from '@/lib/formato';
import { urlRegistro, type PaginaRegistroUI } from './paginar-registro';

/**
 * La barra de búsqueda + paginación de los registros del panel (FE-12).
 *
 * Es un `<form method="get">` a propósito: sin JavaScript, sin estado de
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
      <form method="get" action={ruta} className="flex items-center gap-2">
        {camposOcultos.map(([n, v]) => <input key={n} type="hidden" name={n} value={v} />)}
        <div className="relative">
          <Search width={14} height={14} strokeWidth={1.75} aria-hidden
            className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--faint)' }} />
          <input type="search" name={nombreQ} defaultValue={q} maxLength={80}
            aria-label={`Buscar en ${sustantivo}`} placeholder={`Buscar en ${sustantivo}…`}
            className="hairline h-8 w-64 rounded-lg pl-8 pr-3 text-[13px] outline-none focus:border-[var(--muted)] transition-colors"
            style={{ background: 'var(--surface)' }} />
        </div>
        <button type="submit"
          className="hairline h-8 px-3 rounded-lg text-[12.5px] font-medium transition-colors hover:bg-[var(--canvas)]"
          style={{ background: 'var(--surface)' }}>
          Buscar
        </button>
        {hayFiltro && (
          <Link href={urlRegistro(ruta, sufijo, { [nombreQ]: null, [nombreP]: null, [nombreEditar]: null })}
            className="text-[12px] underline hover:opacity-70 transition-opacity" style={{ color: 'var(--muted)' }}>
            Quitar filtro
          </Link>
        )}
      </form>

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
