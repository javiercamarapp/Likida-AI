// Componentes de gráfica en SVG plano — sin librería nueva, monocromo
// (--ink para el dato, --muted para lo recesivo), specs de dataviz skill:
// línea de 2px, marcadores ≥8px con anillo de superficie, gridlines
// hairline de 1px. Interactividad con :hover puro en CSS — sin estado de
// React para algo que no lo necesita.

/**
 * `width="100%"` + viewBox, NUNCA un ancho fijo en px: un ancho fijo dentro
 * de un flex angosto (la tarjeta de stat) fue justo lo que empujó el trazo
 * fuera de la tarjeta la primera vez. El viewBox interno sigue en unidades
 * fijas (100×28) — lo que cambia es que el SVG se ESCALA al contenedor real
 * en vez de reclamar un ancho propio que el contenedor tiene que ceder.
 */
export function Sparkline({ valores, alto = 24 }: { valores: number[]; alto?: number }) {
  const ANCHO_VB = 100;
  if (valores.length < 2) return null;
  const max = Math.max(...valores);
  const min = Math.min(...valores);
  const rango = max - min || 1;
  const paso = ANCHO_VB / (valores.length - 1);
  const puntos = valores.map((v, i) => [i * paso, alto - 2 - ((v - min) / rango) * (alto - 4)] as const);
  const d = puntos.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [ux, uy] = puntos[puntos.length - 1];
  return (
    <svg width="100%" height={alto} viewBox={`0 0 ${ANCHO_VB} ${alto}`} preserveAspectRatio="none" className="block">
      <path d={d} fill="none" stroke="var(--ink)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.5} vectorEffect="non-scaling-stroke" />
      <circle cx={ux} cy={uy} r={2.5} fill="var(--ink)" />
    </svg>
  );
}

export function Tendencia({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-xs block truncate" style={{ color: 'var(--muted)' }}>sin historia suficiente</span>;
  const sube = valor >= 0;
  return (
    <span className="text-xs font-medium block truncate" style={{ color: sube ? 'var(--color-ok)' : 'var(--color-bad)' }}
      title={`${sube ? '+' : ''}${valor}% vs los 7 días previos`}>
      {sube ? '↑' : '↓'} {Math.abs(valor)}%
      <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · 7d</span>
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
  const ANCHO = 640, ALTO = 240, PAD_IZQ = 8, PAD_DER = 8, PAD_SUP = 16, PAD_INF = 28;
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

/** Barras — una magnitud por día (facturas procesadas), no una serie en el
 *  tiempo continua, así que barra en vez de línea (dataviz skill: forma
 *  según el trabajo del dato). Puntas redondeadas de 4px ancladas a la
 *  base, 1 solo eje, tooltip por barra al :hover — mismas specs que
 *  `AreaChartSimple`. */
/**
 * `alto` es un pixel FIJO en pantalla (no solo unidades del viewBox): sin
 * esto, `w-full h-auto` escala la altura junto con el ancho, y en un
 * contenedor angosto (tarjeta) contra uno ancho (junto al saludo) la MISMA
 * gráfica sale 3× más alta — es justo lo que empujó el título fuera de la
 * tarjeta la primera vez. `preserveAspectRatio="none"` deja que el viewBox
 * se estire libremente al contenedor real en vez de pelear por su propia
 * proporción; en un chart de barras (sin curvas) estirar no distorsiona
 * nada que importe.
 */
export function BarChartSimple({
  datos, etiquetaValor = (v: number) => String(v), alto = 96,
}: {
  datos: Array<{ dia: string; valor: number }>;
  etiquetaValor?: (v: number) => string;
  alto?: number;
}) {
  const ANCHO = 320, ALTO = 140, PAD_IZQ = 4, PAD_DER = 4, PAD_SUP = 10, PAD_INF = 20;
  const w = ANCHO - PAD_IZQ - PAD_DER, h = ALTO - PAD_SUP - PAD_INF;
  const max = Math.max(...datos.map((d) => d.valor), 1);
  const paso = w / datos.length;
  const anchoBarra = Math.min(28, paso * 0.55);
  const RADIO_BARRA = 4;

  return (
    <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} width="100%" height={alto} preserveAspectRatio="none" className="block">
      <line x1={PAD_IZQ} x2={ANCHO - PAD_DER} y1={PAD_SUP + h} y2={PAD_SUP + h} stroke="var(--line)" strokeWidth={1} />
      {datos.map((d, i) => {
        const cx = PAD_IZQ + paso * i + paso / 2;
        const altoBarra = d.valor > 0 ? Math.max(3, (d.valor / max) * h) : 0;
        const y = PAD_SUP + h - altoBarra;
        // `path` en vez de `rect` porque solo las esquinas de ARRIBA se
        // redondean — la base tiene que quedar recta sobre la línea base.
        const x0 = cx - anchoBarra / 2, x1 = cx + anchoBarra / 2;
        const r = Math.min(RADIO_BARRA, altoBarra / 2, anchoBarra / 2);
        const d2 = altoBarra > 0
          ? `M${x0},${y + altoBarra} V${y + r} Q${x0},${y} ${x0 + r},${y} H${x1 - r} Q${x1},${y} ${x1},${y + r} V${y + altoBarra} Z`
          : '';
        return (
          <g key={d.dia} className="group cursor-default">
            <rect x={cx - paso / 2} y={PAD_SUP} width={paso} height={h} fill="transparent" />
            {altoBarra > 0 && <path d={d2} fill="var(--ink)" opacity={0.82} />}
            <text x={cx} y={ALTO - 6} textAnchor="middle" fontSize={9} fill="var(--muted)">
              {d.dia.slice(8)}
            </text>
            <g className="opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <rect x={cx - 24} y={y - 24} width={48} height={18} rx={5} fill="var(--ink)" />
              <text x={cx} y={y - 11} textAnchor="middle" fontSize={10} fill="var(--bg)" fontWeight={600}>
                {etiquetaValor(d.valor)}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

const RADIO = 78, GROSOR = 24;
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
      <svg width={192} height={192} viewBox="0 0 192 192" className="shrink-0 -rotate-90">
        <circle cx={96} cy={96} r={RADIO} fill="none" stroke="var(--line)" strokeWidth={GROSOR} />
        {segmentos.map((s, i) => {
          const frac = s.valor / total;
          const dash = frac * CIRC;
          const acumuladoPrevio = i === 0 ? 0 : acumulados[i - 1];
          const offset = -acumuladoPrevio * CIRC;
          return (
            <circle key={s.etiqueta} cx={96} cy={96} r={RADIO} fill="none" stroke="var(--ink)"
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
