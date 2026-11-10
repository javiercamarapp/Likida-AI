import { ChevronLeft, ChevronRight } from 'lucide-react';
import { numero } from '@/lib/formato';
import { BotonEnlace, hrefConParams, type ParamsUrl } from '../ui-v2/componentes';
import './sistema.css';

/**
 * El pie de una lista paginada POR EL SERVIDOR (Bitácora, Corridas): dice qué filas se ven del total REAL y ofrece Anterior y Siguiente
 * conservando los filtros de la URL. Sin enlaces cuando solo hay una página; nunca un total inventado.
 */
export function PiePaginas({ base, params, pagina, paginas, total, tamano, unidad, clave = 'p' }: {
  base: string;
  params: ParamsUrl;
  pagina: number;
  paginas: number;
  total: number;
  tamano: number;
  /** «entradas», «corridas»: en plural. */
  unidad: string;
  /** Nombre del parámetro de la página en la URL. */
  clave?: string;
}) {
  const desde = total === 0 ? 0 : (pagina - 1) * tamano + 1;
  const hasta = Math.min(total, pagina * tamano);
  const href = (n: number) => hrefConParams(base, params, { [clave]: n > 1 ? String(n) : null });
  return (
    <div className="adm-sis-pie">
      <span>{numero(desde)}–{numero(hasta)} de {numero(total)} {unidad}</span>
      {paginas > 1 ? (
        <nav aria-label={`Páginas de ${unidad}`}>
          {pagina > 1 ? (
            <BotonEnlace href={href(pagina - 1)} variante="secondary" tamano="sm" rel="prev" icono={<ChevronLeft width={13} height={13} strokeWidth={1.75} aria-hidden="true" />}>Anterior</BotonEnlace>
          ) : null}
          <span aria-current="page">Página {numero(pagina)} de {numero(paginas)}</span>
          {pagina < paginas ? (
            <BotonEnlace href={href(pagina + 1)} variante="secondary" tamano="sm" rel="next">Siguiente <ChevronRight width={13} height={13} strokeWidth={1.75} aria-hidden="true" /></BotonEnlace>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
