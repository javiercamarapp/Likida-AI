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
 * CSS/flexbox, NO SVG — la primera versión usaba un `<svg>` con
 * `preserveAspectRatio="none"` para estirarse al ancho real de la
 * tarjeta, pero eso estira TAMBIÉN las curvas Bézier de las esquinas
 * redondeadas de forma no-uniforme (X y Y a factores distintos), y el
 * resultado se ve borroso/mal definido en vez de nítido — es un problema
 * inherente a estirar curvas, no algo que se arregla ajustando números.
 * Barras planas con `border-radius` en CSS no tienen ese problema: no hay
 * viewBox que estirar, cada barra escala limpio a cualquier ancho.
 */
export function BarChartSimple({
  datos, etiquetaValor = (v: number) => String(v), alto = 96,
}: {
  datos: Array<{ dia: string; valor: number }>;
  etiquetaValor?: (v: number) => string;
  alto?: number;
}) {
  const max = Math.max(...datos.map((d) => d.valor), 1);
  const ALTO_BARRAS = alto - 24; // deja lugar a la etiqueta del día abajo
  const n = datos.length;
  // Mismo % que la altura de cada barra — el punto queda EXACTO en su
  // tope, así la línea de verdad seala "cómo se mueve" la barra, no un
  // dato distinto trazado encima.
  const pcts = datos.map((d) => (d.valor > 0 ? Math.max(4, (d.valor / max) * 100) : 0));
  const xPct = (i: number) => ((i + 0.5) / n) * 100;

  return (
    <div style={{ height: alto }}>
      <div className="relative flex items-end gap-2 border-b" style={{ height: ALTO_BARRAS, borderColor: 'var(--line)' }}>
        {datos.map((d, i) => (
          <div key={d.dia} className="flex-1 h-full flex items-end justify-center group relative cursor-default">
            {d.valor > 0 && (
              <div className="w-full max-w-14 rounded-t-[4px]" style={{ height: `${pcts[i]}%`, background: 'var(--ink)', opacity: 0.82, minHeight: 3 }} />
            )}
            <div className="absolute left-1/2 -translate-x-1/2 px-2 py-1 rounded-md text-xs font-semibold opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10"
              style={{ bottom: `calc(${pcts[i]}% + 8px)`, background: 'var(--ink)', color: 'var(--bg)' }}>
              {etiquetaValor(d.valor)}
            </div>
          </div>
        ))}

        {/* Línea + puntos conectados que siguen el tope de cada barra —
            la fluctuación de un vistazo. Solo la polyline (segmentos
            rectos) vive en el SVG que se estira al ancho real: una recta
            estirada sigue siendo recta, no se distorsiona como una curva
            (el mismo problema que rompía las esquinas redondeadas). Los
            puntos son divs reales — círculos de verdad, nunca óvalos —
            posicionados aparte, no dentro del SVG estirado. */}
        <svg width="100%" height="100%" className="absolute inset-0 pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline
            points={pcts.map((p, i) => `${xPct(i)},${100 - p}`).join(' ')}
            fill="none" stroke="var(--ink)" strokeWidth={1.5} strokeOpacity={0.4}
            vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round"
          />
        </svg>
        {pcts.map((p, i) => (
          <div key={i} className="absolute w-[7px] h-[7px] rounded-full pointer-events-none"
            style={{ left: `${xPct(i)}%`, bottom: `${p}%`, transform: 'translate(-50%, 50%)', background: 'var(--ink)', boxShadow: '0 0 0 2px var(--surface)' }} />
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        {datos.map((d) => (
          <div key={d.dia} className="flex-1 text-center text-xs" style={{ color: 'var(--muted)' }}>
            {d.dia.slice(8)}
          </div>
        ))}
      </div>
    </div>
  );
}

const RADIO_OUT = 90, RADIO_IN = 66; // mismo grosor visual que antes (78 ± 24/2)
const CENTRO = 96;
const GAP_DEG = 2.4; // separación angular entre rebanadas — ver nota abajo

/** Punto sobre un círculo de radio `r`, en el ángulo `anguloDeg` medido en
 *  grados con 0° = arriba (12 en punto) y creciendo en sentido horario.
 *  Redondeado a 3 decimales — sin esto, `Math.cos`/`Math.sin` puede
 *  imprimir el último dígito distinto entre el motor JS del servidor y el
 *  del navegador (mismo valor matemático, representación de punto
 *  flotante distinta), y React marca eso como un mismatch de hidratación
 *  aunque la diferencia sea invisible al ojo. */
function puntoEnCirculo(r: number, anguloDeg: number): [number, number] {
  const rad = ((anguloDeg - 90) * Math.PI) / 180;
  return [Math.round((CENTRO + r * Math.cos(rad)) * 1000) / 1000, Math.round((CENTRO + r * Math.sin(rad)) * 1000) / 1000];
}

/** Path de una rebanada de dona (sector anular) entre dos ángulos — UNA
 *  sola figura cerrada por rebanada, no un trazo de círculo con
 *  `stroke-dasharray`. La técnica anterior apilaba círculos completos con
 *  dasharray/dashoffset para simular cada rebanada: matemáticamente cierra
 *  exacto, pero el redondeo de punto flotante en `frac * CIRC` deja un
 *  sub-píxel de desajuste justo en la costura entre rebanadas, que el
 *  navegador antialiasea como una punta/superposición visible (el defecto
 *  que se veía en el reporte). Un `<path>` con las cuatro esquinas de la
 *  rebanada calculadas directo desde el mismo ángulo no tiene ese punto de
 *  falla: no hay costura que desalinear. */
function pathRebanada(anguloIni: number, anguloFin: number): string {
  const largeArc = anguloFin - anguloIni > 180 ? 1 : 0;
  const [xOi, yOi] = puntoEnCirculo(RADIO_OUT, anguloIni);
  const [xOf, yOf] = puntoEnCirculo(RADIO_OUT, anguloFin);
  const [xIf, yIf] = puntoEnCirculo(RADIO_IN, anguloFin);
  const [xIi, yIi] = puntoEnCirculo(RADIO_IN, anguloIni);
  return [
    `M ${xOi} ${yOi}`,
    `A ${RADIO_OUT} ${RADIO_OUT} 0 ${largeArc} 1 ${xOf} ${yOf}`,
    `L ${xIf} ${yIf}`,
    `A ${RADIO_IN} ${RADIO_IN} 0 ${largeArc} 0 ${xIi} ${yIi}`,
    'Z',
  ].join(' ');
}

/**
 * Dona de una categoría — identidad por color (monocromo: por OPACIDAD, no
 * por hue, ya que la paleta es blanco/negro) + leyenda directa.
 *
 * El SVG vive en un `div` de tamaño fijo con `aspect-square` (NO en el
 * `<svg>` mismo con `width`/`height` en px como antes): un tamaño fijo en
 * el propio SVG no cede cuando la tarjeta que lo contiene es más angosta
 * que 192px (p.ej. a la mitad de un grid de 2 columnas), así que se salía
 * de la tarjeta y el padre con `overflow-hidden` le cortaba un pedazo. Con
 * el tamaño en el `div` envolvente y el SVG a `width="100%" height="100%"`,
 * flexbox SÍ puede encogerlo, y como se encoge parejo en X e Y
 * (`aspect-square`) el círculo nunca se deforma en óvalo.
 */
export function Dona({ segmentos }: { segmentos: Array<{ etiqueta: string; valor: number }> }) {
  const total = segmentos.reduce((s, x) => s + x.valor, 0) || 1;
  const pasos = segmentos.length <= 1 ? [1] : segmentos.map((_, i) => 0.35 + (0.65 * i) / (segmentos.length - 1));
  const acumulados = segmentos.reduce<number[]>((acc, s) => {
    const anterior = acc.length ? acc[acc.length - 1] : 0;
    acc.push(anterior + s.valor / total);
    return acc;
  }, []);
  // Gap fijo entre rebanadas (no aplica con una sola, no hay nada que
  // separar) — mismo criterio que la skill de dataviz: un hueco de
  // superficie deliberado entre marcas adyacentes en vez de intentar que
  // toquen exacto.
  const gap = segmentos.length > 1 ? GAP_DEG : 0;
  return (
    <div className="flex items-center gap-6 min-w-0">
      <div className="shrink min-w-0 aspect-square" style={{ width: 160 }}>
        <svg viewBox="0 0 192 192" width="100%" height="100%" className="block">
          <circle cx={CENTRO} cy={CENTRO} r={(RADIO_OUT + RADIO_IN) / 2} fill="none" stroke="var(--line)" strokeWidth={RADIO_OUT - RADIO_IN} />
          {segmentos.map((s, i) => {
            const anguloIniBase = (i === 0 ? 0 : acumulados[i - 1]) * 360;
            const anguloFinBase = acumulados[i] * 360;
            const anguloIni = anguloIniBase + gap / 2;
            const anguloFin = Math.max(anguloIni, anguloFinBase - gap / 2);
            return (
              <path key={s.etiqueta} d={pathRebanada(anguloIni, anguloFin)} fill="var(--ink)" opacity={pasos[i]} />
            );
          })}
        </svg>
      </div>
      <div className="space-y-2 min-w-0">
        {segmentos.map((s, i) => (
          <div key={s.etiqueta} className="flex items-center gap-2 text-sm">
            <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: 'var(--ink)', opacity: pasos[i] }} />
            <span className="font-medium truncate">{s.etiqueta}</span>
            <span className="shrink-0" style={{ color: 'var(--muted)' }}>{Math.round((s.valor / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
