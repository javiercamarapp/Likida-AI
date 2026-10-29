import { useId } from 'react';
import type { Matiz } from '../metricas';

/** Área mínima de UNA serie (alto 140 por omisión; mín. 128 si llena). Línea 1.75, relleno .12→0,
 *  3 marcas en Y, último punto r 3.25. <2 puntos ⇒ `.mc-vacio` (borde punteado) conservando el alto. */
export function AreaMini({ valores, etiquetas, matiz = 1, etiqueta, formato = (v) => String(v), alto = 140 }: {
  valores: ReadonlyArray<number | null>;
  etiquetas?: readonly string[];
  matiz?: Matiz;
  /** Nombre accesible de la figura. */
  etiqueta: string;
  formato?: (v: number) => string;
  alto?: number;
}) {
  const idg = `rv-ag-${useId().replace(/:/g, '')}`;
  const ok = valores.filter((v): v is number => v !== null && Number.isFinite(v));
  if (ok.length < 2) {
    return <figure className="rv-gr mc-vacio" style={{ height: alto }} aria-label={etiqueta}><span>Sin serie suficiente</span></figure>;
  }
  const W = 320, padL = 4, padR = 6, padT = 8, padB = 8;
  const min = Math.min(0, ...ok), max = Math.max(...ok);
  const rango = max - min || 1;
  const n = valores.length - 1;
  const X = (i: number) => padL + (i / n) * (W - padL - padR);
  const Y = (v: number) => alto - padB - ((v - min) / rango) * (alto - padT - padB);
  // Tramos contiguos de datos: un nulo CORTA la línea y el relleno (jamás se interpola sobre el dato faltante);
  // el hueco se marca con un trazo punteado a la altura de la base.
  const tramos: Array<Array<readonly [number, number]>> = [];
  valores.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) { tramos.push([]); return; }
    if (tramos.length === 0) tramos.push([]);
    tramos[tramos.length - 1].push([i, v]);
  });
  const conDatos = tramos.filter((t) => t.length > 0);
  const lineaDe = (t: ReadonlyArray<readonly [number, number]>) => t.map(([i, v], k) => `${k ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  const d = conDatos.map(lineaDe).join(' ');
  const huecos: Array<[number, number]> = [];
  for (let k = 0; k < conDatos.length - 1; k++) huecos.push([conDatos[k][conDatos[k].length - 1][0], conDatos[k + 1][0][0]]);
  const ult = valores.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null).pop()!;
  const marcas = [min, min + rango / 2, max];
  return (
    <figure className="rv-gr rv-area" data-matiz={matiz} aria-label={etiqueta}>
      <div className="rv-area__ejes" aria-hidden="true">
        {marcas.map((m) => <span key={m} style={{ top: `${(Y(m) / alto) * 100}%` }}>{formato(m)}</span>)}
      </div>
      <div className="rv-area__plot">
      <svg viewBox={`0 0 ${W} ${alto}`} width="100%" height={alto} preserveAspectRatio="none" role="img" aria-label={etiqueta}>
        <defs>
          <linearGradient id={idg} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--cat, currentColor)" stopOpacity=".12" />
            <stop offset="1" stopColor="var(--cat, currentColor)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {marcas.map((m) => (
          <g key={m}>
            <line className="rv-gr__rejilla" x1={padL} x2={W - padR} y1={Y(m)} y2={Y(m)} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {conDatos.map((t) => (
          <path key={t[0][0]} d={`${lineaDe(t)} L${X(t[t.length - 1][0]).toFixed(1)} ${Y(min)} L${X(t[0][0]).toFixed(1)} ${Y(min)} Z`} fill={`url(#${idg})`} stroke="none" />
        ))}
        {huecos.map(([a, b]) => (
          <line key={a} className="rv-area__hueco" x1={X(a)} x2={X(b)} y1={Y(min)} y2={Y(min)} vectorEffect="non-scaling-stroke" />
        ))}
        <path className="rv-area__linea" d={d} fill="none" pathLength={1} vectorEffect="non-scaling-stroke" />
      </svg>
      <i className="rv-area__punto" aria-hidden="true" style={{ left: `${(X(ult[0]) / W) * 100}%`, top: `${(Y(ult[1]) / alto) * 100}%` }} />
      </div>
      <table className="rv-sr">
        <caption>{etiqueta}</caption>
        <tbody>{valores.map((v, i) => <tr key={i}><th scope="row">{etiquetas?.[i] ?? i + 1}</th><td>{v === null ? '—' : formato(v)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
