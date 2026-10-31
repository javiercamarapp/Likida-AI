import type { Matiz } from '../metricas';

export interface ColumnaDato { etiqueta: string; valor: number | null; /** semana incompleta: trama 45° */ parcial?: boolean }

const W = 640;
const H = 168;
const TOPE = 10; // aire sobre la columna más alta

/** Columnas de UN matiz (ESTILO §7): radio superior 3, mín. 2 px, parcial con trama 45°, cifra impresa bajo cada columna (el color no
 *  es la única señal). El trazo es SVG (la gráfica); las cifras y fechas son HTML en las mismas ranuras. Todo en cero o sin dato ⇒ celda
 *  punteada que conserva el alto (nunca una gráfica de ceros). Crecen una vez al montar (CSS; con reduced-motion aparecen quietas).
 *  `data-cero-fuente`: los ceros de la serie son medidos (el lector respondió), no desconocidos. */
export function Columnas({ datos, matiz = 1, etiqueta, formato = (v) => String(v), vacio = 'Sin datos en el periodo' }: {
  datos: readonly ColumnaDato[];
  matiz?: Matiz;
  etiqueta: string;
  formato?: (v: number) => string;
  vacio?: string;
}) {
  const max = Math.max(0, ...datos.map((d) => d.valor ?? 0));
  if (max === 0) {
    return <figure className="rv-gr rv-colum rv-colum--vacio" aria-label={etiqueta}><span>{vacio}</span></figure>;
  }
  const n = datos.length;
  const slot = W / n;
  const ancho = Math.min(40, slot * 0.6);
  const util = H - TOPE;
  return (
    <figure className="rv-gr rv-colum" data-matiz={matiz} aria-label={etiqueta} data-cero-fuente="">
      <svg className="rv-colum__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={etiqueta}>
        <defs>
          <pattern id="rv-colum-trama" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--soft-1, transparent)" />
            <rect width="3" height="6" fill="var(--cat, currentColor)" />
          </pattern>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} className="rv-gr__rejilla" x1="0" x2={W} y1={H - f * util} y2={H - f * util} vectorEffect="non-scaling-stroke" />)}
        <line className="rv-colum__base" x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} vectorEffect="non-scaling-stroke" />
        {datos.map((d, i) => {
          if (d.valor === null) return null;
          const h = Math.max(2, (d.valor / max) * util);
          const x = i * slot + (slot - ancho) / 2;
          const y = H - h;
          const r = Math.min(3, h);
          return (
            <path key={d.etiqueta} className="rv-colum__barra" data-parcial={d.parcial || undefined} style={{ ['--i' as string]: i }}
              d={`M${x} ${H}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + ancho - r}Q${x + ancho} ${y} ${x + ancho} ${y + r}V${H}Z`} />
          );
        })}
      </svg>
      <ol className="rv-colum__etqs" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {datos.map((d) => (
          <li key={d.etiqueta}><b>{d.valor === null ? '—' : formato(d.valor)}</b><span>{d.etiqueta}</span></li>
        ))}
      </ol>
    </figure>
  );
}
