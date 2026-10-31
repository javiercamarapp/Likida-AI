import Link from 'next/link';
import { X } from 'lucide-react';
import { cx } from '../componentes/clases';
import { hrefConParams, type ParamsURL } from './estado-tabla';

export interface DefinicionFiltro {
  /** Nombre del parámetro en la URL (`f`, `q`, `estado`…). */
  param: string;
  /** «Estado», «Operador». */
  etiqueta: string;
  /** Cómo se dice el valor («abiertos» → «Abiertos»). Por omisión, el valor tal cual. */
  rotuloValor?: (valor: string) => string;
  /** Este valor equivale a «sin filtro» (el filtro por omisión): no genera chip. */
  omitir?: readonly string[];
}

export interface ChipActivo { id: string; etiqueta: string; valor: string; quitarHref: string }

/** Los filtros activos de la URL como chips (puro). Al quitar uno se conservan los demás parámetros y se vuelve a la primera página
 *  (se borran `cursor`/`c`/`pag` y los extras de `reiniciar`). */
export function chipsActivos(base: string, params: ParamsURL, filtros: readonly DefinicionFiltro[], reiniciar: readonly string[] = ['c', 'cursor', 'pag', 'p']): ChipActivo[] {
  const reinicio = Object.fromEntries(reiniciar.map((k) => [k, null as string | null]));
  const out: ChipActivo[] = [];
  for (const f of filtros) {
    const crudo = params[f.param];
    const valor = (Array.isArray(crudo) ? crudo[0] : (crudo as string | undefined))?.trim();
    if (!valor || f.omitir?.includes(valor)) continue;
    out.push({ id: f.param, etiqueta: f.etiqueta, valor: f.rotuloValor ? f.rotuloValor(valor) : valor, quitarHref: hrefConParams(base, params, { ...reinicio, [f.param]: null }) });
  }
  return out;
}

/** «Filtros activos»: cada filtro vigente es un chip con su ✕ (enlace; el estado vive en la URL, sin JavaScript). Dos o más suman
 *  «Quitar todos». Sin filtros no pinta nada. El ✕ mide 44 px de toque y su nombre accesible dice qué quita. */
export function ChipsFiltro({ chips, quitarTodosHref, className }: { chips: readonly ChipActivo[]; quitarTodosHref?: string; className?: string }) {
  if (chips.length === 0) return null;
  return (
    <div className={cx('rv-chipsfiltro', className)} role="group" aria-label="Filtros activos">
      <ul className="rv-chipsfiltro__lista">
        {chips.map((c) => (
          <li key={c.id} className="rv-chipsfiltro__chip">
            <span className="rv-chipsfiltro__texto"><span className="rv-chipsfiltro__etq">{c.etiqueta}:</span> {c.valor}</span>
            <Link href={c.quitarHref} className="rv-chipsfiltro__quitar" aria-label={`Quitar el filtro ${c.etiqueta}: ${c.valor}`} prefetch={false} scroll={false}>
              <X width={12} height={12} strokeWidth={2.25} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
      {chips.length > 1 && quitarTodosHref ? <Link href={quitarTodosHref} className="rv-chipsfiltro__todos" prefetch={false} scroll={false}>Quitar todos</Link> : null}
    </div>
  );
}
