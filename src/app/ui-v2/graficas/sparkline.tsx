import type { Matiz } from '../metricas';

/** Sparkline 60×22 (trazo 1.5, área .06, punto final r 2.25), color = matiz de la MÉTRICA.
 *  Menos de 2 puntos válidos ⇒ no pinta una raya falsa: devuelve null (el padre dice «sin serie»). */
export function Sparkline({ valores, matiz = 8, ancho = 60, alto = 22 }: {
  valores: ReadonlyArray<number | null>;
  matiz?: Matiz;
  ancho?: number;
  alto?: number;
}) {
  const pts = valores.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null && Number.isFinite(p[1]));
  if (pts.length < 2) return null;
  const n = valores.length - 1 || 1;
  const min = Math.min(...pts.map((p) => p[1]));
  const max = Math.max(...pts.map((p) => p[1]));
  const rango = max - min || 1;
  const pad = 3;
  const xy = pts.map(([i, v]) => [pad + (i / n) * (ancho - pad * 2), alto - pad - ((v - min) / rango) * (alto - pad * 2)] as const);
  // Un nulo corta la línea: se une SOLO lo contiguo (índices consecutivos), nunca se interpola sobre el faltante.
  const tramos: Array<Array<readonly [number, number]>> = [];
  pts.forEach(([i], k) => {
    if (k === 0 || i !== pts[k - 1][0] + 1) tramos.push([]);
    tramos[tramos.length - 1].push(xy[k]);
  });
  const trazo = (t: ReadonlyArray<readonly [number, number]>) => t.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const d = tramos.map(trazo).join(' ');
  const [ux, uy] = xy[xy.length - 1];
  const sueltos = tramos.filter((t) => t.length === 1);
  const area = tramos.filter((t) => t.length > 1).map((t) => `${trazo(t)} L${t[t.length - 1][0].toFixed(1)} ${alto} L${t[0][0].toFixed(1)} ${alto} Z`).join(' ');
  return (
    <svg className="rv-spark" data-matiz={matiz} width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} aria-hidden="true">
      <path className="rv-spark__area" d={area} />
      <path className="rv-spark__linea" d={d} fill="none" pathLength={1} />
      {sueltos.map(([[x, y]]) => <circle key={x} className="rv-spark__punto" cx={x} cy={y} r={1.75} />)}
      <circle className="rv-spark__punto" cx={ux} cy={uy} r={2.25} />
    </svg>
  );
}
