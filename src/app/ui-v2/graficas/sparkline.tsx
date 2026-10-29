import type { Matiz } from '../metricas';

/** Sparkline 60×24 (trazo 1.5, área .06, punto final r 2.25), color = matiz de la MÉTRICA.
 *  Menos de 2 puntos válidos ⇒ no pinta una raya falsa: devuelve null (el padre dice «sin serie»). */
export function Sparkline({ valores, matiz = 8, ancho = 60, alto = 24 }: {
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
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [ux, uy] = xy[xy.length - 1];
  const area = `${d} L${ux.toFixed(1)} ${alto} L${xy[0][0].toFixed(1)} ${alto} Z`;
  return (
    <svg className="rv-spark" data-matiz={matiz} width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} aria-hidden="true">
      <path className="rv-spark__area" d={area} />
      <path className="rv-spark__linea" d={d} fill="none" pathLength={1} />
      <circle className="rv-spark__punto" cx={ux} cy={uy} r={2.25} />
    </svg>
  );
}
