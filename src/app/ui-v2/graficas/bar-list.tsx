import type { Matiz } from '../metricas';
import type { TipoDato } from './kind-badge';

export interface ItemBarList {
  clave: string;
  etiqueta: string;
  /** null ⇒ sin dato: pista con trama y «—» (NUNCA una barra en cero). */
  valor: number | null;
  /** Cifra ya formateada (la exacta siempre va impresa). */
  texto?: string;
  tipo?: TipoDato;
  href?: string;
  nota?: string;
}

/** Ranking horizontal (Vexa `BarList`): etiqueta 13/500, cifra exacta 13/600 a la derecha, pista de 4 px (6 con matiz). El ancho es la
 *  parte del mayor (`maximo` por omisión). Estimado/inferido: pista con trama (la clase del dato nunca es solo color). Las barras crecen
 *  una vez (420 ms, escalón de 40 ms); con reduced-motion aparecen quietas. Sin dato ⇒ «—», jamás 0. */
export function BarList({ items, matiz, etiqueta, formato = (v) => String(v), maximo }: {
  items: readonly ItemBarList[];
  matiz?: Matiz;
  etiqueta: string;
  formato?: (v: number) => string;
  maximo?: number;
}) {
  const tope = maximo ?? Math.max(1, ...items.map((i) => i.valor ?? 0));
  return (
    <ul className="rv-barlist" data-matiz={matiz} aria-label={etiqueta}>
      {items.map((it, i) => {
        const cab = (
          <>
            <span className="rv-barlist__etq">{it.etiqueta}</span>
            <span className="rv-barlist__val">{it.valor === null ? '—' : (it.texto ?? formato(it.valor))}</span>
          </>
        );
        return (
          <li key={it.clave} className="rv-barlist__fila">
            {it.href ? <a className="rv-barlist__cab" href={it.href}>{cab}</a> : <div className="rv-barlist__cab">{cab}</div>}
            <svg className="rv-barlist__pista" data-desconocido={it.valor === null || undefined} data-tipo={it.tipo} width="100%" height="100%" aria-hidden="true">
              {it.valor !== null ? <rect className="rv-barlist__relleno" data-r={i} x="0" y="0" height="100%" rx="3" width={`${Math.min(100, Math.max(0, (it.valor / tope) * 100)).toFixed(2)}%`} /> : null}
            </svg>
            {it.nota ? <small className="rv-barlist__nota">{it.nota}</small> : null}
          </li>
        );
      })}
    </ul>
  );
}
