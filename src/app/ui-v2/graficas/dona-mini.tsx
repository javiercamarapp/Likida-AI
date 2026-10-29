import { type Matiz } from '../metricas';

export interface Gajo { etiqueta: string; valor: number | null }

/** Dona de ≤5 gajos de UN matiz (tonos 100/72/52/34/20 %), 132 px, trazo 10. Más de 5 ⇒ los menores se
 *  agrupan en «Otros» (nunca más de 5 gajos). Valores nulos no suman ni se pintan: aparecen «—» en la
 *  leyenda. El número va impreso (centro y leyenda): el color nunca es la única señal. */
export function DonaMini({ gajos, matiz = 8, etiqueta, centro, formato = (v) => String(v) }: {
  gajos: readonly Gajo[];
  matiz?: Matiz;
  etiqueta: string;
  /** Texto al centro (p. ej. el total ya formateado). */
  centro?: string;
  formato?: (v: number) => string;
}) {
  const validos = gajos.filter((g): g is { etiqueta: string; valor: number } => g.valor !== null && g.valor > 0);
  const ordenados = [...validos].sort((a, b) => b.valor - a.valor);
  const vistos = ordenados.length > 5
    ? [...ordenados.slice(0, 4), { etiqueta: 'Otros', valor: ordenados.slice(4).reduce((s, g) => s + g.valor, 0) }]
    : ordenados;
  const total = vistos.reduce((s, g) => s + g.valor, 0);
  const T = 132, trazo = 10, r = (T - trazo) / 2, c = T / 2;
  let acum = 0;
  return (
    <figure className="rv-gr rv-dona" data-matiz={matiz} aria-label={etiqueta}>
      <div className="rv-dona__lienzo" style={{ width: T, height: T }}>
        <svg width={T} height={T} viewBox={`0 0 ${T} ${T}`} aria-hidden="true">
          <circle className="rv-dona__pista" cx={c} cy={c} r={r} fill="none" strokeWidth={trazo} />
          {total > 0 ? vistos.map((g, i) => {
            const frac = (g.valor / total) * 100;
            const el = (
              <circle key={g.etiqueta} className={`rv-dona__gajo rv-tono-${i}`} cx={c} cy={c} r={r} fill="none" strokeWidth={trazo}
                pathLength={100} strokeDasharray={`${Math.max(0, frac - 1)} ${100 - Math.max(0, frac - 1)}`} strokeDashoffset={-acum}
                transform={`rotate(-90 ${c} ${c})`} />
            );
            acum += frac;
            return el;
          }) : null}
        </svg>
        <span className="rv-dona__centro">{total > 0 ? (centro ?? formato(total)) : '—'}</span>
      </div>
      <ul className="rv-dona__leyenda">
        {(total > 0 ? vistos : gajos.map((g) => ({ etiqueta: g.etiqueta, valor: g.valor }))).map((g, i) => (
          <li key={g.etiqueta}>
            <i className={`rv-dona__marca rv-tono-${i}`} aria-hidden="true" />
            <span className="rv-dona__etq">{g.etiqueta}</span>
            <span className="rv-dona__val">{g.valor === null ? '—' : formato(g.valor)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
