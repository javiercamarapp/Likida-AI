import { cx } from './clases';

const CONECTORES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'the', 'of', 'and']);

/** Iniciales: 2+ palabras útiles -> 1.ª letra de las dos primeras; una palabra -> sus 2 primeras letras. */
export function iniciales(nombre: string): string {
  const palabras = nombre
    .replace(/[()[\]{}.,;:'"“”&/\\|+*#@!?_-]+/g, ' ')
    .split(/\s+/).filter(Boolean)
    .filter((p) => !CONECTORES.has(p.toLowerCase()));
  if (palabras.length === 0) return '·';
  const r = palabras.length >= 2 ? palabras[0][0] + palabras[1][0] : palabras[0].slice(0, 2);
  return r.toLocaleUpperCase('es-MX');
}

/** Hash estable (FNV-1a) del id -> matiz 1..8. El color sale del ID, no del nombre:
 *  renombrar una organización no cambia su color. */
export function matizDeId(id: string): 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ((h % 8) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
}

/** Rectángulo r=8 con iniciales (nunca un círculo con una letra). Decorativo:
 *  el nombre ya está en el texto contiguo. Colores: tinte --soft-N / tinta --ink-N (AA). */
export function Monograma({ id, nombre, tamano = 28, className }: { id: string; nombre: string; tamano?: 28 | 32 | 40; className?: string }) {
  return (
    <span className={cx('rv-mono', className)} data-matiz={matizDeId(id)} data-tamano={tamano} aria-hidden="true">
      {iniciales(nombre)}
    </span>
  );
}
