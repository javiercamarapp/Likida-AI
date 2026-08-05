'use client';

import { usePrefersReducedMotion } from './prefers-reduced-motion';
import { resolverFormato, type FormatoPreset } from './formato-preset';

/**
 * Librería de gráficas del design system v2 — mismas reglas que
 * `admin/charts.tsx` (SVG/CSS a mano, sin librería nueva, monocromo por
 * OPACIDAD sobre la rampa --g1..--g5, nunca por color). Cada una anima su
 * entrada la PRIMERA vez que cruza el viewport (`useInView`), respeta
 * `prefers-reduced-motion` (`usePrefersReducedMotion` — sin movimiento,
 * muestra el estado final de una vez), y usa SOLO técnicas seguras bajo
 * escalado no-uniforme: rects/divs con % (nunca distorsionan), o un
 * `preserveAspectRatio="none"` reservado exclusivamente para líneas
 * rectas (`ParetoBars`) — la misma lección de `BarChartSimple`: estirar
 * una curva/círculo de forma no-uniforme la deforma, una recta no.
 */

const EASE = 'cubic-bezier(.2,.7,.3,1)';

// ── Gauge ────────────────────────────────────────────────────────────────

/** Arco semicircular 0–100%, identidad por relleno --g5 sobre pista --g1.
 *  Un solo arco de valor (no varios apilados) → sin riesgo de costura. */
export function Gauge({
  valor, etiqueta, formato = 'porcentaje',
}: { valor: number; etiqueta?: string; formato?: FormatoPreset }) {
  const reducido = usePrefersReducedMotion();
  // AUDITORÍA 12, MEDIO (frontend): `animar = enVista || reducido` servía la
  // pista vacía en el HTML (enVista=false en el server y antes de cruzar el
  // viewport) — un 0% leído como medición contra el número real que viaja
  // debajo. La gráfica nace con su valor real; las transiciones CSS animan
  // los cambios de valor posteriores.
  const animar = true;
  const pct = Math.max(0, Math.min(100, valor));
  const fmt = resolverFormato(formato);

  const CX = 100, CY = 100, R = 70, GROSOR = 14;
  const ANGULO_INI = 180, ANGULO_TOTAL = 180;
  // Redondeado a 3 decimales — Math.cos/Math.sin puede imprimir el último
  // dígito distinto entre el motor JS del servidor y el del navegador,
  // que React marca como mismatch de hidratación aunque sea invisible
  // (mismo bug ya corregido en `puntoEnCirculo`, admin/charts.tsx).
  function punto(r: number, angDeg: number): [number, number] {
    const rad = (angDeg * Math.PI) / 180;
    return [Math.round((CX + r * Math.cos(rad)) * 1000) / 1000, Math.round((CY + r * Math.sin(rad)) * 1000) / 1000];
  }
  function arco(angIni: number, angFin: number): string {
    const [x0, y0] = punto(R, angIni);
    const [x1, y1] = punto(R, angFin);
    const large = angFin - angIni > 180 ? 1 : 0;
    return `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1}`;
  }
  const anguloValor = ANGULO_INI + (pct / 100) * ANGULO_TOTAL;
  const largoAprox = Math.PI * R + 20;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 110" className="w-full" style={{ maxWidth: 220 }}>
        <path d={arco(ANGULO_INI, ANGULO_INI + ANGULO_TOTAL)} fill="none" stroke="var(--g1)" strokeWidth={GROSOR} strokeLinecap="round" />
        <path d={arco(ANGULO_INI, anguloValor)} fill="none" stroke="var(--g5)" strokeWidth={GROSOR} strokeLinecap="round"
          style={{
            strokeDasharray: largoAprox,
            strokeDashoffset: animar ? 0 : largoAprox,
            transition: reducido ? 'none' : `stroke-dashoffset 900ms ${EASE}`,
          }} />
      </svg>
      <div className="text-2xl font-semibold tabular -mt-8">{fmt(valor)}</div>
      {etiqueta && <div className="text-xs mt-1 text-center" style={{ color: 'var(--muted)' }}>{etiqueta}</div>}
    </div>
  );
}

// ── HBars ────────────────────────────────────────────────────────────────

/** Barras horizontales — comparar categorías (§C). */
export function HBars({
  datos, formato = 'numero',
}: { datos: Array<{ etiqueta: string; valor: number }>; formato?: FormatoPreset }) {
  const reducido = usePrefersReducedMotion();
  // AUDITORÍA 12, MEDIO (frontend): `animar = enVista || reducido` servía la
  // pista vacía en el HTML (enVista=false en el server y antes de cruzar el
  // viewport) — un 0% leído como medición contra el número real que viaja
  // debajo. La gráfica nace con su valor real; las transiciones CSS animan
  // los cambios de valor posteriores.
  const animar = true;
  const max = Math.max(...datos.map((d) => d.valor), 1);
  const fmt = resolverFormato(formato);

  return (
    <div className="space-y-2.5">
      {datos.map((d, i) => (
        <div key={d.etiqueta} className="flex items-center gap-3">
          <div className="w-28 shrink-0 text-xs truncate text-right" style={{ color: 'var(--muted)' }}>{d.etiqueta}</div>
          <div className="flex-1 h-5 rounded-md overflow-hidden" style={{ background: 'var(--g1)' }}>
            <div className="h-full rounded-md" style={{
              width: animar ? `${(d.valor / max) * 100}%` : '0%',
              background: 'var(--g5)',
              transition: reducido ? 'none' : `width 550ms ${EASE} ${i * 70}ms`,
            }} />
          </div>
          <div className="w-16 shrink-0 text-xs tabular text-right font-medium">{fmt(d.valor)}</div>
        </div>
      ))}
    </div>
  );
}

// ── MultiLine ────────────────────────────────────────────────────────────

/** Varias series en el tiempo, un solo eje (nunca doble eje). Identidad
 *  por opacidad — leyenda directa abajo. */
export function MultiLine({
  series, categorias,
}: { series: Array<{ nombre: string; valores: number[] }>; categorias: string[] }) {
  const reducido = usePrefersReducedMotion();
  // AUDITORÍA 12, MEDIO (frontend): `animar = enVista || reducido` servía la
  // pista vacía en el HTML (enVista=false en el server y antes de cruzar el
  // viewport) — un 0% leído como medición contra el número real que viaja
  // debajo. La gráfica nace con su valor real; las transiciones CSS animan
  // los cambios de valor posteriores.
  const animar = true;
  const ANCHO = 640, ALTO = 220, PAD = 24;
  const n = categorias.length;
  const max = Math.max(...series.flatMap((s) => s.valores), 1);
  const pasos = series.length <= 1 ? [1] : series.map((_, i) => 0.3 + (0.7 * i) / (series.length - 1));
  const largoAprox = 2 * (ANCHO + ALTO);

  function xy(valores: number[]) {
    return valores.map((v, i) => [PAD + (n > 1 ? i / (n - 1) : 0) * (ANCHO - 2 * PAD), PAD + (1 - v / max) * (ALTO - 2 * PAD)] as const);
  }

  return (
    <div>
      <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} className="w-full h-auto">
        {[0, 0.5, 1].map((t) => (
          <line key={t} x1={PAD} x2={ANCHO - PAD} y1={PAD + t * (ALTO - 2 * PAD)} y2={PAD + t * (ALTO - 2 * PAD)} stroke="var(--line)" strokeWidth={1} />
        ))}
        {series.map((s, si) => {
          const puntos = xy(s.valores);
          const d = puntos.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
          return (
            <path key={s.nombre} d={d} fill="none" stroke="var(--g5)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={pasos[si]}
              style={{
                strokeDasharray: largoAprox,
                strokeDashoffset: animar ? 0 : largoAprox,
                transition: reducido ? 'none' : `stroke-dashoffset 900ms ease-out ${si * 140}ms`,
              }} />
          );
        })}
      </svg>
      {series.length > 1 && (
        <div className="flex flex-wrap gap-3 mt-2">
          {series.map((s, i) => (
            <div key={s.nombre} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
              <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: 'var(--g5)', opacity: pasos[i] }} />
              {s.nombre}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── StackedBars ──────────────────────────────────────────────────────────

/** Composición por categoría — apiladas, identidad por opacidad. */
export function StackedBars({
  categorias, series,
}: { categorias: string[]; series: Array<{ nombre: string; valores: number[] }> }) {
  const reducido = usePrefersReducedMotion();
  // AUDITORÍA 12, MEDIO (frontend): `animar = enVista || reducido` servía la
  // pista vacía en el HTML (enVista=false en el server y antes de cruzar el
  // viewport) — un 0% leído como medición contra el número real que viaja
  // debajo. La gráfica nace con su valor real; las transiciones CSS animan
  // los cambios de valor posteriores.
  const animar = true;
  const totales = categorias.map((_, i) => series.reduce((s, ser) => s + ser.valores[i], 0));
  const max = Math.max(...totales, 1);
  const pasos = series.length <= 1 ? [1] : series.map((_, i) => 0.3 + (0.7 * i) / (series.length - 1));

  return (
    <div>
      <div className="flex items-end gap-3" style={{ height: 160 }}>
        {categorias.map((cat, ci) => {
          const alturaTotalPct = (totales[ci] / max) * 100;
          return (
            <div key={cat} className="flex-1 h-full flex flex-col justify-end items-center">
              <div className="w-full max-w-12 flex flex-col-reverse rounded-t-[4px] overflow-hidden" style={{ height: `${alturaTotalPct}%` }}>
                {series.map((s, si) => {
                  const segPct = totales[ci] > 0 ? (s.valores[ci] / totales[ci]) * 100 : 0;
                  return (
                    <div key={s.nombre} style={{
                      height: animar ? `${segPct}%` : '0%',
                      background: 'var(--g5)',
                      opacity: pasos[si],
                      transition: reducido ? 'none' : `height 480ms ${EASE} ${ci * 60}ms`,
                    }} />
                  );
                })}
              </div>
              <div className="text-xs mt-2 truncate max-w-full" style={{ color: 'var(--muted)' }}>{cat}</div>
            </div>
          );
        })}
      </div>
      {series.length > 1 && (
        <div className="flex flex-wrap gap-3 mt-3">
          {series.map((s, i) => (
            <div key={s.nombre} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
              <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: 'var(--g5)', opacity: pasos[i] }} />{s.nombre}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Funnel ───────────────────────────────────────────────────────────────

/** Pasos secuenciales, cada uno % del primero — conversión con % entre
 *  pasos consecutivos. */
export function Funnel({ pasos }: { pasos: Array<{ etiqueta: string; valor: number }> }) {
  const reducido = usePrefersReducedMotion();
  // AUDITORÍA 12, MEDIO (frontend): `animar = enVista || reducido` servía la
  // pista vacía en el HTML (enVista=false en el server y antes de cruzar el
  // viewport) — un 0% leído como medición contra el número real que viaja
  // debajo. La gráfica nace con su valor real; las transiciones CSS animan
  // los cambios de valor posteriores.
  const animar = true;
  const base = pasos[0]?.valor || 1;

  return (
    <div className="space-y-2.5">
      {pasos.map((p, i) => {
        const pct = Math.max(3, (p.valor / base) * 100);
        const anterior = i > 0 ? pasos[i - 1].valor || 1 : null;
        const conversion = anterior !== null ? Math.round((p.valor / anterior) * 100) : null;
        return (
          <div key={p.etiqueta}>
            <div className="flex items-center justify-between text-xs mb-1" style={{ color: 'var(--muted)' }}>
              <span>{p.etiqueta}</span>
              <span className="tabular">{p.valor}{conversion !== null && ` · ${conversion}%`}</span>
            </div>
            <div className="h-7 rounded-md overflow-hidden" style={{ background: 'var(--g1)' }}>
              <div className="h-full rounded-md" style={{
                width: animar ? `${pct}%` : '0%',
                background: 'var(--g5)',
                opacity: 0.45 + 0.55 * (1 - i / pasos.length),
                transition: reducido ? 'none' : `width 480ms ${EASE} ${i * 130}ms`,
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Waterfall ────────────────────────────────────────────────────────────

/** Movimiento de un saldo (MRR bridge): cada paso flota entre el
 *  acumulado anterior y el nuevo; `esTotal` fija la barra al eje (inicio
 *  o fin), el resto son deltas ± desde el acumulado. */
export function Waterfall({
  pasos, formato = 'numero',
}: { pasos: Array<{ etiqueta: string; delta: number; esTotal?: boolean }>; formato?: FormatoPreset }) {
  const reducido = usePrefersReducedMotion();
  // AUDITORÍA 12, MEDIO (frontend): `animar = enVista || reducido` servía la
  // pista vacía en el HTML (enVista=false en el server y antes de cruzar el
  // viewport) — un 0% leído como medición contra el número real que viaja
  // debajo. La gráfica nace con su valor real; las transiciones CSS animan
  // los cambios de valor posteriores.
  const animar = true;
  const fmt = resolverFormato(formato);

  // Acumulado calculado con `reduce` empujando a un arreglo nuevo (no
  // mutando una variable capturada dentro de `.map`) — el React Compiler
  // rechaza esa mutación por engañosa entre renders (misma lección que la
  // dona en `admin/charts.tsx`).
  const barras = pasos.reduce<Array<{ etiqueta: string; delta: number; esTotal?: boolean; desde: number; hasta: number; positivo: boolean }>>((acc, p) => {
    const acumuladoPrevio = acc.length ? acc[acc.length - 1].hasta : 0;
    const desde = p.esTotal ? 0 : acumuladoPrevio;
    const hasta = p.esTotal ? p.delta : acumuladoPrevio + p.delta;
    acc.push({ ...p, desde: Math.min(desde, hasta), hasta: Math.max(desde, hasta), positivo: p.esTotal ? true : p.delta >= 0 });
    return acc;
  }, []);
  const max = Math.max(...barras.map((b) => b.hasta), 1);

  return (
    <div className="pb-6">
      <div className="flex items-end gap-2" style={{ height: 160 }}>
        {barras.map((b, i) => {
          const topPct = (1 - b.hasta / max) * 100;
          const heightPct = ((b.hasta - b.desde) / max) * 100;
          return (
            <div key={b.etiqueta} className="flex-1 h-full relative">
              <div className="absolute inset-x-0 rounded-[3px]" style={{
                top: animar ? `${topPct}%` : '100%',
                height: animar ? `${Math.max(heightPct, 1)}%` : '0%',
                background: b.esTotal ? 'var(--g5)' : (b.positivo ? 'var(--g4)' : 'var(--g2)'),
                transition: reducido ? 'none' : `top 480ms ${EASE} ${i * 80}ms, height 480ms ${EASE} ${i * 80}ms`,
              }} />
              <div className="absolute inset-x-0 text-center text-xs tabular" style={{ top: `calc(${topPct}% - 18px)`, color: 'var(--muted)' }}>
                {fmt(b.hasta - b.desde)}
              </div>
              <div className="absolute inset-x-0 text-center text-xs truncate px-0.5" style={{ top: '100%', marginTop: 6, color: 'var(--faint)' }}>
                {b.etiqueta}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Histogram ────────────────────────────────────────────────────────────

/** Distribución — barras contiguas (bins), sin huecos entre sí. */
export function Histogram({ buckets }: { buckets: Array<{ rango: string; conteo: number }> }) {
  const reducido = usePrefersReducedMotion();
  // AUDITORÍA 12, MEDIO (frontend): `animar = enVista || reducido` servía la
  // pista vacía en el HTML (enVista=false en el server y antes de cruzar el
  // viewport) — un 0% leído como medición contra el número real que viaja
  // debajo. La gráfica nace con su valor real; las transiciones CSS animan
  // los cambios de valor posteriores.
  const animar = true;
  const max = Math.max(...buckets.map((b) => b.conteo), 1);
  const paso = Math.max(1, Math.ceil(buckets.length / 6));

  return (
    <div>
      <div className="flex items-end gap-px" style={{ height: 160 }}>
        {buckets.map((b, i) => (
          <div key={b.rango} className="flex-1 h-full flex items-end" title={`${b.rango}: ${b.conteo}`}>
            <div className="w-full" style={{
              height: animar ? `${(b.conteo / max) * 100}%` : '0%',
              background: 'var(--g4)',
              transition: reducido ? 'none' : `height 420ms ${EASE} ${i * 25}ms`,
            }} />
          </div>
        ))}
      </div>
      <div className="flex gap-px mt-2">
        {buckets.map((b, i) => (
          <div key={b.rango} className="flex-1 text-[10px] text-center truncate" style={{ color: 'var(--faint)' }}>
            {i % paso === 0 ? b.rango : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Heatmap (también sirve para CohortHeatmap: filas=cohortes,
//    columnas=meses desde alta, valores=% retención) ─────────────────────

export function Heatmap({
  filas, columnas, valores, formato = 'numero',
}: { filas: string[]; columnas: string[]; valores: number[][]; formato?: FormatoPreset }) {
  const reducido = usePrefersReducedMotion();
  // AUDITORÍA 12, MEDIO (frontend): `animar = enVista || reducido` servía la
  // pista vacía en el HTML (enVista=false en el server y antes de cruzar el
  // viewport) — un 0% leído como medición contra el número real que viaja
  // debajo. La gráfica nace con su valor real; las transiciones CSS animan
  // los cambios de valor posteriores.
  const animar = true;
  const max = Math.max(...valores.flat(), 1);
  const fmt = resolverFormato(formato);

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse">
        <thead>
          <tr>
            <th />
            {columnas.map((c) => (
              <th key={c} className="text-[10px] font-normal px-1 pb-1" style={{ color: 'var(--faint)' }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, fi) => (
            <tr key={f}>
              <td className="text-xs pr-2 whitespace-nowrap" style={{ color: 'var(--muted)' }}>{f}</td>
              {columnas.map((c, ci) => {
                const v = valores[fi]?.[ci] ?? 0;
                const idx = fi * columnas.length + ci;
                return (
                  <td key={c} className="p-0.5">
                    <div title={`${f} · ${c}: ${fmt(v)}`} className="w-6 h-6 rounded-[3px]" style={{
                      background: 'var(--g5)',
                      opacity: animar ? Math.max(0.06, v / max) : 0,
                      transition: reducido ? 'none' : `opacity 380ms ease ${idx * 15}ms`,
                    }} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── CalendarHeatmap (tipo GitHub) ────────────────────────────────────────

export function CalendarHeatmap({ dias }: { dias: Array<{ fecha: string; valor: number }> }) {
  const reducido = usePrefersReducedMotion();
  // AUDITORÍA 12, MEDIO (frontend): `animar = enVista || reducido` servía la
  // pista vacía en el HTML (enVista=false en el server y antes de cruzar el
  // viewport) — un 0% leído como medición contra el número real que viaja
  // debajo. La gráfica nace con su valor real; las transiciones CSS animan
  // los cambios de valor posteriores.
  const animar = true;
  const max = Math.max(...dias.map((d) => d.valor), 1);
  const semanas: (typeof dias)[] = [];
  for (let i = 0; i < dias.length; i += 7) semanas.push(dias.slice(i, i + 7));

  return (
    <div className="flex gap-1 overflow-x-auto">
      {semanas.map((semana, si) => (
        <div key={si} className="flex flex-col gap-1">
          {semana.map((d) => (
            <div key={d.fecha} title={`${d.fecha}: ${d.valor}`} className="w-3 h-3 rounded-[2px]" style={{
              background: 'var(--g5)',
              opacity: animar ? Math.max(0.08, d.valor / max) : 0,
              transition: reducido ? 'none' : `opacity 350ms ease ${si * 40}ms`,
            }} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── MarginDivergingBars ──────────────────────────────────────────────────

/** Barras que divergen izq/der de una línea cero según el signo —
 *  rentabilidad ± (§C). */
export function MarginDivergingBars({
  datos, formato = 'porcentajeSigno',
}: { datos: Array<{ etiqueta: string; valor: number }>; formato?: FormatoPreset }) {
  const reducido = usePrefersReducedMotion();
  // AUDITORÍA 12, MEDIO (frontend): `animar = enVista || reducido` servía la
  // pista vacía en el HTML (enVista=false en el server y antes de cruzar el
  // viewport) — un 0% leído como medición contra el número real que viaja
  // debajo. La gráfica nace con su valor real; las transiciones CSS animan
  // los cambios de valor posteriores.
  const animar = true;
  const max = Math.max(...datos.map((d) => Math.abs(d.valor)), 1);
  const fmt = resolverFormato(formato);

  return (
    <div className="space-y-2">
      {datos.map((d, i) => {
        const pct = (Math.abs(d.valor) / max) * 50;
        const positivo = d.valor >= 0;
        return (
          <div key={d.etiqueta} className="flex items-center gap-3 text-xs">
            <div className="w-28 shrink-0 truncate text-right" style={{ color: 'var(--muted)' }}>{d.etiqueta}</div>
            <div className="flex-1 h-5 relative rounded-sm overflow-hidden" style={{ background: 'var(--g1)' }}>
              <div className="absolute left-1/2 top-0 bottom-0 w-px" style={{ background: 'var(--faint)' }} />
              <div className="absolute top-0 bottom-0 rounded-sm" style={{
                [positivo ? 'left' : 'right']: '50%',
                width: animar ? `${pct}%` : '0%',
                background: positivo ? 'var(--g5)' : 'var(--g3)',
                transition: reducido ? 'none' : `width 480ms ${EASE} ${i * 70}ms`,
              }} />
            </div>
            <div className="w-16 shrink-0 tabular text-right font-medium">{fmt(d.valor)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── ParetoBars ───────────────────────────────────────────────────────────

/** Barras ordenadas descendente + línea de % acumulado — priorizar
 *  errores (§C). La polyline (recta) vive en el SVG estirado
 *  `preserveAspectRatio="none"`: seguro, una recta no se distorsiona bajo
 *  escalado no-uniforme (a diferencia de una curva/círculo). */
export function ParetoBars({
  datos, formato = 'numero',
}: { datos: Array<{ etiqueta: string; valor: number }>; formato?: FormatoPreset }) {
  const reducido = usePrefersReducedMotion();
  // AUDITORÍA 12, MEDIO (frontend): `animar = enVista || reducido` servía la
  // pista vacía en el HTML (enVista=false en el server y antes de cruzar el
  // viewport) — un 0% leído como medición contra el número real que viaja
  // debajo. La gráfica nace con su valor real; las transiciones CSS animan
  // los cambios de valor posteriores.
  const animar = true;
  const fmt = resolverFormato(formato);
  const ordenado = [...datos].sort((a, b) => b.valor - a.valor);
  const total = ordenado.reduce((s, d) => s + d.valor, 0) || 1;
  const acumulados = ordenado.reduce<number[]>((acc, d) => {
    const anterior = acc.length ? acc[acc.length - 1] : 0;
    acc.push(anterior + d.valor);
    return acc;
  }, []);
  const conCumulativo = ordenado.map((d, i) => ({ ...d, cumPct: (acumulados[i] / total) * 100 }));
  const max = Math.max(...ordenado.map((d) => d.valor), 1);
  const n = conCumulativo.length;
  const xPct = (i: number) => ((i + 0.5) / n) * 100;
  const largoAprox = 400;

  return (
    <div>
      <div className="relative" style={{ height: 160 }}>
        <div className="absolute inset-0 flex items-end gap-2">
          {conCumulativo.map((d, i) => (
            <div key={d.etiqueta} className="flex-1 h-full flex items-end">
              <div className="w-full rounded-t-[3px]" style={{
                height: animar ? `${(d.valor / max) * 100}%` : '0%',
                background: 'var(--g4)',
                transition: reducido ? 'none' : `height 420ms ${EASE} ${i * 60}ms`,
              }} />
            </div>
          ))}
        </div>
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 pointer-events-none">
          <polyline points={conCumulativo.map((d, i) => `${xPct(i)},${100 - d.cumPct}`).join(' ')}
            fill="none" stroke="var(--g5)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round"
            style={{
              strokeDasharray: largoAprox,
              strokeDashoffset: animar ? 0 : largoAprox,
              transition: reducido ? 'none' : 'stroke-dashoffset 900ms ease-out 200ms',
            }} />
        </svg>
      </div>
      <div className="flex gap-2 mt-2">
        {conCumulativo.map((d) => (
          <div key={d.etiqueta} className="flex-1 text-[10px] text-center truncate" style={{ color: 'var(--faint)' }} title={fmt(d.valor)}>
            {d.etiqueta}
          </div>
        ))}
      </div>
    </div>
  );
}
