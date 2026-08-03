// Componentes de gráfica en SVG plano — sin librería nueva, monocromo
// (--ink para el dato, --muted para lo recesivo), specs de dataviz skill:
// línea de 2px, marcadores ≥8px con anillo de superficie, gridlines
// hairline de 1px. Interactividad con :hover puro en CSS — sin estado de
// React para algo que no lo necesita.

export function Sparkline({ valores, ancho = 96, alto = 28 }: { valores: number[]; ancho?: number; alto?: number }) {
  if (valores.length < 2) return <div style={{ width: ancho, height: alto }} />;
  const max = Math.max(...valores);
  const min = Math.min(...valores);
  const rango = max - min || 1;
  const paso = ancho / (valores.length - 1);
  const puntos = valores.map((v, i) => [i * paso, alto - ((v - min) / rango) * alto] as const);
  const d = puntos.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [ux, uy] = puntos[puntos.length - 1];
  return (
    <svg width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} className="overflow-visible">
      <path d={d} fill="none" stroke="var(--ink)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.55} />
      <circle cx={ux} cy={uy} r={2.5} fill="var(--ink)" />
    </svg>
  );
}

export function Tendencia({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-xs" style={{ color: 'var(--muted)' }}>sin historia suficiente</span>;
  const sube = valor >= 0;
  return (
    <span className="text-xs font-medium inline-flex items-center gap-0.5" style={{ color: sube ? 'var(--color-ok)' : 'var(--color-bad)' }}>
      {sube ? '↑' : '↓'} {Math.abs(valor)}%
      <span style={{ color: 'var(--muted)', fontWeight: 400 }}>&nbsp;vs 7 días previos</span>
    </span>
  );
}

/** Área + línea de una sola métrica en el tiempo. Un solo eje, a propósito
 *  (dataviz skill: nunca doble eje) — costo y tokens se piden por separado. */
export function AreaChartSimple({
  datos, etiquetaValor,
}: {
  datos: Array<{ dia: string; valor: number }>;
  etiquetaValor: (v: number) => string;
}) {
  const ANCHO = 640, ALTO = 200, PAD_IZQ = 8, PAD_DER = 8, PAD_SUP = 16, PAD_INF = 28;
  const w = ANCHO - PAD_IZQ - PAD_DER, h = ALTO - PAD_SUP - PAD_INF;
  const max = Math.max(...datos.map((d) => d.valor), 1);
  const paso = datos.length > 1 ? w / (datos.length - 1) : 0;
  const xy = datos.map((d, i) => [PAD_IZQ + i * paso, PAD_SUP + h - (d.valor / max) * h] as const);
  const linea = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${linea} L${xy[xy.length - 1][0].toFixed(1)},${PAD_SUP + h} L${xy[0][0].toFixed(1)},${PAD_SUP + h} Z`;
  // Cada 1/4 y última — evita amontonar etiquetas en series largas.
  const mostrarEtiqueta = (i: number) => i === 0 || i === datos.length - 1 || i % Math.max(1, Math.ceil(datos.length / 5)) === 0;

  return (
    <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} className="w-full h-auto">
      {[0, 0.5, 1].map((t) => (
        <line key={t} x1={PAD_IZQ} x2={ANCHO - PAD_DER} y1={PAD_SUP + h * t} y2={PAD_SUP + h * t}
          stroke="var(--line)" strokeWidth={1} />
      ))}
      <path d={area} fill="var(--ink)" opacity={0.08} />
      <path d={linea} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {xy.map(([x, y], i) => (
        <g key={i} className="group cursor-default">
          <circle cx={x} cy={y} r={9} fill="transparent" />
          <circle cx={x} cy={y} r={3.5} fill="var(--ink)" stroke="var(--bg)" strokeWidth={2}
            className="opacity-0 group-hover:opacity-100 transition-opacity" />
          {mostrarEtiqueta(i) && (
            <text x={x} y={ALTO - 6} textAnchor="middle" fontSize={10} fill="var(--muted)">
              {datos[i].dia.slice(5)}
            </text>
          )}
          <g className="opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <rect x={x - 34} y={y - 30} width={68} height={20} rx={5} fill="var(--ink)" />
            <text x={x} y={y - 16} textAnchor="middle" fontSize={11} fill="var(--bg)" fontWeight={600}>
              {etiquetaValor(datos[i].valor)}
            </text>
          </g>
        </g>
      ))}
    </svg>
  );
}

const RADIO = 70, GROSOR = 22;
const CIRC = 2 * Math.PI * RADIO;

/** Dona de una categoría — identidad por color (monocromo: por OPACIDAD,
 *  no por hue, ya que la paleta es blanco/negro) + leyenda directa. */
export function Dona({ segmentos }: { segmentos: Array<{ etiqueta: string; valor: number }> }) {
  const total = segmentos.reduce((s, x) => s + x.valor, 0) || 1;
  const pasos = segmentos.length <= 1 ? [1] : segmentos.map((_, i) => 0.35 + (0.65 * i) / (segmentos.length - 1));
  // Offset de cada arco = la suma acumulada de los anteriores — calculado
  // ANTES del render (no mutando una variable dentro del .map) para que un
  // futuro React Compiler no lo confunda con una mutación en el render.
  const acumulados = segmentos.reduce<number[]>((acc, s) => {
    const anterior = acc.length ? acc[acc.length - 1] : 0;
    acc.push(anterior + s.valor / total);
    return acc;
  }, []);
  return (
    <div className="flex items-center gap-6">
      <svg width={160} height={160} viewBox="0 0 160 160" className="shrink-0 -rotate-90">
        <circle cx={80} cy={80} r={RADIO} fill="none" stroke="var(--line)" strokeWidth={GROSOR} />
        {segmentos.map((s, i) => {
          const frac = s.valor / total;
          const dash = frac * CIRC;
          const acumuladoPrevio = i === 0 ? 0 : acumulados[i - 1];
          const offset = -acumuladoPrevio * CIRC;
          return (
            <circle key={s.etiqueta} cx={80} cy={80} r={RADIO} fill="none" stroke="var(--ink)"
              strokeWidth={GROSOR} strokeDasharray={`${dash} ${CIRC - dash}`} strokeDashoffset={offset}
              opacity={pasos[i]} strokeLinecap="butt"
              style={{ transition: 'stroke-dasharray 0.4s ease' }} />
          );
        })}
      </svg>
      <div className="space-y-2">
        {segmentos.map((s, i) => (
          <div key={s.etiqueta} className="flex items-center gap-2 text-sm">
            <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: 'var(--ink)', opacity: pasos[i] }} />
            <span className="font-medium">{s.etiqueta}</span>
            <span style={{ color: 'var(--muted)' }}>{Math.round((s.valor / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
