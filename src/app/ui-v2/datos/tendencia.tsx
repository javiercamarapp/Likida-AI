import { numero } from '@/lib/formato';
import { cx } from '../componentes/clases';

export type DirBuena = 'sube' | 'baja';

/** Tono de una variación: depende de si SUBIR o BAJAR es bueno para esa métrica. Sin `bueno` no se juzga (neutral): colorear por el
 *  signo diría «verde» a una subida de horas de deuda. */
export function tonoTendencia(valor: number | null | undefined, bueno?: DirBuena): 'ok' | 'bad' | 'neutral' {
  if (valor === null || valor === undefined || !Number.isFinite(valor) || valor === 0 || !bueno) return 'neutral';
  return (valor > 0 ? 'sube' : 'baja') === bueno ? 'ok' : 'bad';
}

/** Variación contra un periodo anterior. `valor` es el cambio (p. ej. 12.5 = +12.5 %); `null` = no hay periodo comparable (se dice, no
 *  se pinta un 0). `bueno` decide el tono: la flecha y el texto llevan el sentido, el color solo el juicio. */
export function Tendencia({ valor, bueno, unidad = '%', contra, className }: {
  valor: number | null | undefined;
  /** Qué dirección es buena para esta métrica: 'baja' para costos, deuda, incidencias; 'sube' para ingresos, cuadre. */
  bueno?: DirBuena;
  unidad?: string;
  /** «vs mes anterior». */
  contra?: string;
  className?: string;
}) {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) {
    return <span className={cx('rv-tend', className)} data-tono="neutral" data-vacia="">sin periodo comparable</span>;
  }
  const dir = valor > 0 ? 'sube' : valor < 0 ? 'baja' : 'igual';
  const tono = tonoTendencia(valor, bueno);
  const abs = numero(Math.round(Math.abs(valor) * 10) / 10);
  const sentido = dir === 'sube' ? 'sube' : dir === 'baja' ? 'baja' : 'sin cambio';
  const juicio = tono === 'ok' ? 'buena noticia' : tono === 'bad' ? 'mala noticia' : null;
  return (
    <span className={cx('rv-tend', className)} data-tono={tono} data-dir={dir}>
      <span aria-hidden="true">{dir === 'sube' ? '▲' : dir === 'baja' ? '▼' : '■'}</span>{' '}
      {dir === 'sube' ? '+' : dir === 'baja' ? '−' : ''}{abs}{unidad}{contra ? ` ${contra}` : ''}
      <span className="rv-sr"> ({sentido}{juicio ? `; ${juicio}` : ''})</span>
    </span>
  );
}
